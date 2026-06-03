// src/lib/stores/options.svelte.ts

import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

export const optionsStore = $state({
	data: null as any,

	async load() {
		try {
			// First try local Dexie
			let options = await db.options.get(1);

			if (!options) {
				// If nothing local, try pulling from PocketBase
				options = await this.pullFromPB();
			}

			if (options) {
				this.data = options;
			} else {
				console.warn('⚠️ No options data found in Dexie or PocketBase');
				this.data = {
					id: 1,
					areasOfTown: [],
					defaultBillableItems: [],
					cancelReasons: [],
					defaultJobDurationHours: 2,
					taxRate: 6.5,
					invoiceDueDays: 30
				};
			}
		} catch (err) {
			console.error('Failed to load options:', err);
		}
	},

	async pullFromPB() {
		if (!pb?.authStore?.isValid) return false;

		try {
			const record = await pb.collection('options').getFirstListItem('key="global"');

			const serverOptions = {
				id: 1,
				...record,
				lastUpdated: new Date(record.lastUpdated || record.updated),
				updatedBy: record.updatedBy || 'System'
			};

			await db.options.put(serverOptions);
			this.data = serverOptions;
			console.log('✅ Options pulled from PocketBase');
			return true;
		} catch (err: any) {
			if (err.status !== 404) {
				console.error('❌ Failed to pull options from PocketBase:', err);
			}
			return false;
		}
	},

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
				key: 'global',
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

			// Try to update existing record by key
			try {
				const existing = await pb.collection('options').getFirstListItem('key="global"');
				const record = await pb.collection('options').update(existing.id, pbPayload);
				console.log('✅ Options UPDATED in PocketBase');
				return record;
			} catch (err: any) {
				if (err.status === 404) {
					// Create new record
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
