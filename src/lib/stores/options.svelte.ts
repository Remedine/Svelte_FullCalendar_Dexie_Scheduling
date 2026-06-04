// src/lib/stores/options.svelte.ts
// )=- Fixed logic bug in load() + kept the working Svelte 5 $state pattern
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

export let optionsStore = $state({
	data: null as any,

	async load() {
		try {
			// 1. Try local Dexie first
			let options = await db.options.get(1);

			if (!options) {
				// 2. Nothing local → pull from PocketBase (pullFromPB already sets this.data)
				await this.pullFromPB();
				return; // ← important: exit here so we don't overwrite good data
			}

			// 3. We have local data
			this.data = options;
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
			this.data = serverOptions; // )=- This triggers all $derived values
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

			try {
				const existing = await pb.collection('options').getFirstListItem('key="global"');
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
