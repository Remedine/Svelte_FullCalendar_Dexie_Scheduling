// src/lib/stores/options.svelte.ts
import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

export const optionsStore = $state({
	data: null as any,
	isLoading: false,
	pendingLoad: null as Promise<void> | null,
	pendingPull: null as Promise<boolean> | null,

	async load() {
		if (this.pendingLoad) return this.pendingLoad;

		this.pendingLoad = this._doLoad().finally(() => {
			this.pendingLoad = null;
		});
		return this.pendingLoad;
	},

	async _doLoad() {
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
						taxRate: 5,
						invoiceDueDays: 30,
						businessName: 'Capital City Windows',
						businessCity: 'Juneau',
						businessState: 'AK',
						salesTaxJurisdiction: 'City and Borough of Juneau sales tax',
						invoiceNumberPrefix: 'CCW',
						nextInvoiceNumber: 1,
						crewAssignmentDaysBefore: 1,
						crewAssignmentHour: 7,
						calendarDayStartHour: 6,
						calendarDayEndHour: 22,
						quickUnlockIdleMinutes: 120,
						desktopSecurityIdleMinutes: 30,
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
			// Fall back to first record (list/view rules allow any authenticated user per 1780477923_updated_options_rules.js).
			// Only admins may create the initial record (createRule: @request.auth.role = "admin").
			let record;
			try {
				record = await pb.collection('options').getFirstListItem('', {
					$autoCancel: false
				});
			} catch (e: any) {
				if (e.status === 404) {
					// )=- Guard create: only attempt if the current auth user has role exactly "admin".
					// This prevents 400 "Failed to create record." when the logged-in user's users.role
					// is not set (or "crew"), or before the initial global record is seeded by main.go OnServe.
					// Non-admins (or pre-role admins) fall back to Dexie local copy (or the default created in load()).
					// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
					const currentRole = pb.authStore.model?.role;
					if (currentRole !== 'admin') {
						console.warn('[options] No options record in PB and current user is not admin (role=', currentRole, ') — using local Dexie only. Set role="admin" on your user record in PB admin UI to allow seeding.');
						return false;
					}

					// Create a sensible default so the page always has data with id:1
					const defaultPayload = {
						defaultJobDurationHours: 2,
						taxRate: 5,
						invoiceDueDays: 30,
						businessName: 'Capital City Windows',
						businessCity: 'Juneau',
						businessState: 'AK',
						salesTaxJurisdiction: 'City and Borough of Juneau sales tax',
						invoiceNumberPrefix: 'CCW',
						nextInvoiceNumber: 1,
						crewAssignmentDaysBefore: 1,
						crewAssignmentHour: 7,
						calendarDayStartHour: 6,
						calendarDayEndHour: 22,
						quickUnlockIdleMinutes: 120,
						desktopSecurityIdleMinutes: 30,
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
				taxRate: record.taxRate ?? 5,
				invoiceDueDays: record.invoiceDueDays ?? 30,
				crewAssignmentDaysBefore: Number(record.crewAssignmentDaysBefore ?? 1),
				crewAssignmentHour: Number(record.crewAssignmentHour ?? 7),
				calendarDayStartHour: Number(record.calendarDayStartHour ?? 6),
				calendarDayEndHour: Number(record.calendarDayEndHour ?? 22),
				quickUnlockIdleMinutes: Number(record.quickUnlockIdleMinutes ?? 120),
				desktopSecurityIdleMinutes: Number(record.desktopSecurityIdleMinutes ?? 30),
				businessName: record.businessName ?? 'Capital City Windows',
				businessStreet: record.businessStreet ?? '',
				businessCity: record.businessCity ?? 'Juneau',
				businessState: record.businessState ?? 'AK',
				businessZip: record.businessZip ?? '',
				businessPhone: record.businessPhone ?? '',
				businessEmail: record.businessEmail ?? '',
				businessWebsite: record.businessWebsite ?? '',
				businessMailingStreet: record.businessMailingStreet ?? '',
				businessMailingCity: record.businessMailingCity ?? '',
				businessMailingState: record.businessMailingState ?? '',
				businessMailingZip: record.businessMailingZip ?? '',
				businessSalesTaxAccount: record.businessSalesTaxAccount ?? '',
				salesTaxJurisdiction:
					record.salesTaxJurisdiction ?? 'City and Borough of Juneau sales tax',
				invoiceNumberPrefix: record.invoiceNumberPrefix ?? 'CCW',
				nextInvoiceNumber: Number(record.nextInvoiceNumber ?? 1),
				invoiceNumberYear: Number(record.invoiceNumberYear ?? new Date().getFullYear()),
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
			// )=- Treat permission denials (403) and create-rule 400s as non-fatal.
			// These are expected until the user's role is set to "admin" in PB or the initial record exists.
			// Avoids spamming the exact "ClientResponseError 400: Failed to create record." you are seeing.
			const status = err?.status;
			const msg = (err?.message || '').toLowerCase();
			const isPermissionOrCreateFail =
				status === 403 ||
				(status === 400 && (msg.includes('create') || msg.includes('permission') || msg.includes('rule')));
			if (!isAbort && status !== 404 && !isPermissionOrCreateFail) {
				console.error('❌ Failed to pull options from PocketBase:', err);
			} else if (isPermissionOrCreateFail) {
				// Quiet one-time hint in dev; remove or downgrade after role is confirmed admin.
				console.warn('[options] Pull/create blocked by PB rules (role not admin or no record yet). Using Dexie fallback.');
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

		// )=- Only admins can write options (per collection create/updateRule). Guard here too
		// so a misconfigured role never attempts the write that produces 400.
		// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + pb_migrations/1780477923_updated_options_rules.js
		const currentRole = pb.authStore.model?.role;
		if (currentRole !== 'admin') {
			console.warn('[options] syncToPB skipped — current auth role is not "admin":', currentRole);
			return;
		}

		try {
			const cleanData = JSON.parse(
				JSON.stringify(updatedData, (key, value) => {
					if (value instanceof Date) return value.toISOString();
					return value;
				})
			);

			const pbPayload = {
				defaultJobDurationHours: Number(cleanData.defaultJobDurationHours) || 2,
				taxRate: Number(cleanData.taxRate) || 5,
				invoiceDueDays: Number(cleanData.invoiceDueDays) || 30,
				crewAssignmentDaysBefore: Number(cleanData.crewAssignmentDaysBefore ?? 1),
				crewAssignmentHour: Number(cleanData.crewAssignmentHour ?? 7),
				calendarDayStartHour: Number(cleanData.calendarDayStartHour ?? 6),
				calendarDayEndHour: Number(cleanData.calendarDayEndHour ?? 22),
				quickUnlockIdleMinutes: Number(cleanData.quickUnlockIdleMinutes ?? 120),
				desktopSecurityIdleMinutes: Number(cleanData.desktopSecurityIdleMinutes ?? 30),
				businessName: cleanData.businessName || 'Capital City Windows',
				businessStreet: cleanData.businessStreet || '',
				businessCity: cleanData.businessCity || '',
				businessState: cleanData.businessState || '',
				businessZip: cleanData.businessZip || '',
				businessPhone: cleanData.businessPhone || '',
				businessEmail: cleanData.businessEmail || '',
				businessWebsite: cleanData.businessWebsite || '',
				businessMailingStreet: cleanData.businessMailingStreet || '',
				businessMailingCity: cleanData.businessMailingCity || '',
				businessMailingState: cleanData.businessMailingState || '',
				businessMailingZip: cleanData.businessMailingZip || '',
				businessSalesTaxAccount: cleanData.businessSalesTaxAccount || '',
				salesTaxJurisdiction:
					cleanData.salesTaxJurisdiction || 'City and Borough of Juneau sales tax',
				invoiceNumberPrefix: cleanData.invoiceNumberPrefix || 'CCW',
				nextInvoiceNumber: Number(cleanData.nextInvoiceNumber ?? 1),
				invoiceNumberYear: Number(cleanData.invoiceNumberYear ?? new Date().getFullYear()),
				areasOfTown: cleanData.areasOfTown || [],
				defaultBillableItems: cleanData.defaultBillableItems || [],
				cancelReasons: cleanData.cancelReasons || [],
				lastUpdated: cleanData.lastUpdated,
				updatedBy: cleanData.updatedBy || 'Admin'
			};

			console.log('📤 Sending to PocketBase:', pbPayload);

			// )=- Use the same first-record strategy as pull (getFirstListItem('')) instead of the legacy
			// 'key="global"' filter. The current options schema (Go OnServe creation + rule migrations)
			// does not rely on a "key" field. This avoids an extra 404 + failed create path.
			try {
				const existing = await pb
					.collection('options')
					.getFirstListItem('', { $autoCancel: false });
				const record = await pb.collection('options').update(existing.id, pbPayload);
				console.log('✅ Options UPDATED in PocketBase');
				return record;
			} catch (err: any) {
				if (err.status === 404) {
					// Admin-only create (we already guarded above).
					const record = await pb.collection('options').create(pbPayload);
					console.log('✅ Options CREATED in PocketBase');
					return record;
				} else {
					throw err;
				}
			}
		} catch (err: any) {
			// )=- Swallow permission/create errors here too (e.g. transient rule mismatch after login before role claim settles).
			// Real validation errors will still surface via the toast in the options page caller.
			const status = err?.status;
			if (status !== 403 && !(status === 400 && (err?.message || '').toLowerCase().includes('create'))) {
				console.error('❌ Failed to sync options to PocketBase:', err);
			}
		}
	}
});
