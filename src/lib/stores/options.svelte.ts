// src/lib/stores/options.svelte.ts
import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

export const optionsStore = $state({
	data: null as any,
	isLoading: false,
	pendingPull: null as Promise<boolean> | null,

	async load() {
		if (this.isLoading) return; // prevent multiple simultaneous calls

		try {
			this.isLoading = true;

			// Try local first
			let options = await db.options.get('1');

			if (!options) {
				const pulled = await this.pullFromPB();
				if (!pulled) {
					// )=- No record in PB and no local: create sensible default in Dexie
					// so the options page always has editingOptions with .id and can save.
					options = {
						id: '1',
						defaultJobDurationHours: 2,
						taxRate: 6.5,
						invoiceDueDays: 30,
						areasOfTown: [],
						defaultBillableItems: [],
						cancelReasons: [],
						lastUpdated: new Date(),
						updatedBy: 'System'
					};
					await db.options.put(options);
					this.data = options;
					console.log('✅ Created default options in Dexie (no PB record found)');
					return;
				}
				// If pulled succeeded, pullFromPB already set this.data
				return;
			}

			if (!this.data) {
				console.log('✅ Options loaded from Dexie');
			}
			this.data = options;
		} catch (err) {
			console.error('Failed to load options:', err);
		} finally {
			this.isLoading = false;
		}
	},

	async pullFromPB() {
		if (!pb?.authStore?.isValid) return false;

		// )=- Guard against concurrent pulls from multiple pages/components (clients, jobs, calendar, etc.).
		// Reuses the same promise so rapid calls don't spam PB and trigger auto-cancellations.
		// The PB SDK auto-cancels overlapping getFirstListItem calls by default; $autoCancel: false helps
		// but a pending guard + error filtering for aborts keeps the console clean.
		// Reference: https://github.com/pocketbase/js-sdk#auto-cancellation
		if (this.pendingPull) return this.pendingPull;

		this.pendingPull = this._doPullFromPB().finally(() => {
			this.pendingPull = null;
		});

		return this.pendingPull;
	},

	async _doPullFromPB() {
		try {
			// )=- Try to find the global options record. We no longer rely on 'key="global"' filter
			// because the options collection schema may not have a 'key' field (old migrations).
			// Fall back to first record, or create a default one on 404.
			let record;
			try {
				record = await pb.collection('options').getFirstListItem('', {
					$autoCancel: false
				});
			} catch (e: any) {
				if (e.status === 404) {
					// Create a sensible default so the page always has data with id:1
					const defaultPayload = {
						defaultJobDurationHours: 2,
						taxRate: 6.5,
						invoiceDueDays: 30,
						areasOfTown: [],
						defaultBillableItems: [],
						cancelReasons: [],
						lastUpdated: new Date().toISOString(),
						updatedBy: 'System'
					};
					record = await pb.collection('options').create(defaultPayload);
					console.log('✅ Created default options record in PocketBase');
				} else {
					throw e;
				}
			}

			// )=- Map PB record to our AppOptions shape. Strip PB's own 'id' (string) and force our stable '1'.
			// PB record may contain collection metadata that doesn't match our Dexie/AppOptions interface.
			const serverOptions = {
				id: '1',
				defaultJobDurationHours: record.defaultJobDurationHours ?? 2,
				taxRate: record.taxRate ?? 0.065,
				invoiceDueDays: record.invoiceDueDays ?? 30,
				areasOfTown: record.areasOfTown ?? [],
				defaultBillableItems: record.defaultBillableItems ?? [],
				cancelReasons: record.cancelReasons ?? [],
				lastUpdated: new Date(record.lastUpdated || record.updated),
				updatedBy: record.updatedBy || 'System'
			};

			await db.options.put(serverOptions);
			this.data = serverOptions;
			// Only log on actual changes or first load to reduce console noise (multiple components trigger load on mount/login/crew/jobs).
			if (!this.data || this.data.lastUpdated !== serverOptions.lastUpdated) {
				console.log('✅ Options pulled from PocketBase');
			}
			return true;
		} catch (err: any) {
			const isAbort =
				err?.status === 0 ||
				err?.name === 'AbortError' ||
				(err?.message || '').toLowerCase().includes('abort') ||
				(err?.message || '').toLowerCase().includes('autocancel');
			if (!isAbort && err.status !== 404) {
				console.error('❌ Failed to pull options from PocketBase:', err);
			}
			return false;
		}
	},

	// ... keep your existing saveToDexie and syncToPB methods unchanged ...
	async saveToDexie(updatedData: any) {
		if (!updatedData) return;
		try {
			const cleanData = JSON.parse(
				JSON.stringify(updatedData, (key, value) => {
					if (value instanceof Date) return value.toISOString();
					return value;
				})
			);

			await db.options.put(cleanData);
			this.data = cleanData;
		} catch (err) {
			console.error('Failed to save to Dexie:', err);
			throw err;
		}
	},

	async syncToPB(updatedData: any) {
		if (!pb?.authStore?.isValid || !updatedData) return;

		try {
			const cleanData = JSON.parse(
				JSON.stringify(updatedData, (key, value) => {
					if (value instanceof Date) return value.toISOString();
					return value;
				})
			);

			const pbPayload = {
				defaultJobDurationHours: Number(cleanData.defaultJobDurationHours) || 2,
				taxRate: Number(cleanData.taxRate) || 6.5,
				invoiceDueDays: Number(cleanData.invoiceDueDays) || 30,
				areasOfTown: cleanData.areasOfTown || [],
				defaultBillableItems: cleanData.defaultBillableItems || [],
				cancelReasons: cleanData.cancelReasons || [],
				lastUpdated: cleanData.lastUpdated,
				updatedBy: cleanData.updatedBy || 'Admin'
			};

			console.log('📤 Sending to PocketBase:', pbPayload);

			try {
				const existing = await pb
					.collection('options')
					.getFirstListItem('key="global"', { $autoCancel: false });
				const record = await pb.collection('options').update(existing.id, pbPayload);
				console.log('✅ Options UPDATED in PocketBase');
				return record;
			} catch (err: any) {
				if (err.status === 404) {
					const record = await pb.collection('options').create(pbPayload);
					console.log('✅ Options CREATED in PocketBase');
					return record;
				} else {
					throw err;
				}
			}
		} catch (err: any) {
			console.error('❌ Failed to sync options to PocketBase:', err);
		}
	}
});
