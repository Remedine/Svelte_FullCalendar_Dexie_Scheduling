// src/lib/stores/options.svelte.ts
import { db, type AppOptions } from '$lib/db';
import { liveQuery } from 'dexie';

export const optionsStore = $state({
	data: null as AppOptions | null,
	loading: true
});

// Live query for global options
export const options$ = liveQuery(async () => {
	let opts = await db.options.get('global');

	if (!opts) {
		// )=- Default options with all areas from config.ts
		const defaultOptions: AppOptions = {
			id: 'global',
			taxRate: 0.05,
			defaultJobDurationHours: 4,
			defaultBillableItems: [
				{
					title: 'Window Cleaning', // )=- As requested
					price: 100,
					hours: 1,
					isDefault: true
				}
			],
			areasOfTown: {
				thane: { label: 'Thane', color: '#22c55e', sortOrder: 1 },
				'south-douglas': { label: 'South Douglas', color: '#eab308', sortOrder: 2 },
				'north-douglas': { label: 'North Douglas', color: '#f97316', sortOrder: 3 },
				downtown: { label: 'Downtown Juneau', color: '#60a5fa', sortOrder: 4 },
				'twin-lakes-lemon-creek': {
					label: 'Twin Lakes / Lemon Crk',
					color: '#2563eb',
					sortOrder: 5
				},
				valley: { label: 'Valley', color: '#1d4ed8', sortOrder: 6 },
				'back-loop-fritz-cove': { label: 'Back Loop / Fritz Cove', color: '#1e40af', sortOrder: 7 },
				deharts: { label: "DeHart's", color: '#1e3a8a', sortOrder: 8 }
			},
			cancelReasons: [
				'Customer cancelled',
				'Scheduling conflict',
				'Weather / No access',
				'Crew unavailable',
				'Other'
			],
			invoiceDueDays: 30,
			currency: 'USD',
			lastUpdated: new Date(),
			updatedBy: 'System'
		};

		await db.options.put(defaultOptions);
		opts = defaultOptions;
	}

	optionsStore.data = opts;
	optionsStore.loading = false;
	return opts;
});
