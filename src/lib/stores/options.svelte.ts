import { db } from '$lib/db';

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
					areasOfTown: {
						'area-north': { label: 'North Side', color: '#3b82f6' },
						'area-downtown': { label: 'Downtown', color: '#10b981' },
						'area-south': { label: 'South End', color: '#f59e0b' }
					},
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
		console.log('🔄 PocketBase sync placeholder - coming next');
	}
});
