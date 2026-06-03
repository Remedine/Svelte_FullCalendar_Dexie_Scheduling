// src/lib/stores/options.svelte.ts

import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

export const optionsStore = $state({
	data: null as any,

	async load() {
		try {
			const options = await db.options.get(1);

			if (options) {
				this.data = options;
			} else {
				const defaultOptions = {
					id: 1,
					defaultJobDurationHours: 2,
					taxRate: 6.5,
					invoiceDueDays: 30,
					areasOfTown: [
						{ id: 'area-north', label: 'North Side', color: '#3b82f6' },
						{ id: 'area-downtown', label: 'Downtown', color: '#10b981' },
						{ id: 'area-south', label: 'South End', color: '#f59e0b' }
					],
					defaultBillableItems: [
						{ title: 'Window Cleaning', price: 250, hours: 2 },
						{ title: 'Gutter Guard Install', price: 450, hours: 3 }
					],
					cancelReasons: ['Weather', 'Customer Cancelled', 'Scheduling Conflict'],
					lastUpdated: new Date().toISOString(),
					updatedBy: 'System'
				};

				await db.options.put(defaultOptions);
				this.data = defaultOptions;
			}
		} catch (err) {
			console.error('Failed to load options from Dexie:', err);
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
