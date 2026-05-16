import { db } from './index';
import type { Job } from './index';
import seedData from './seed-data.json';

let isSeeding = false; // )=- NEW: Prevent multiple simultaneous seeds

export async function seedSampleData(force = false) {
	// )=- ADDED: Guard against multiple calls (common during hot reload / SSR hydration)
	if (isSeeding) {
		console.log('⏳ Seed already in progress, skipping duplicate call');
		return;
	}
	isSeeding = true;

	try {
		const clientCount = await db.clients.count();

		// )=- IMPROVED: More reliable check
		if (clientCount > 0 && !force) {
			console.log(`✅ Sample data already exists (${clientCount} clients)`);
			return;
		}

		console.log('🌱 Seeding sample data for Capital City Windows...');

		if (force) {
			await Promise.all([db.clients.clear(), db.jobs.clear()]);
			console.log('🧹 Cleared previous data');
		}

		const clientIds = await db.clients.bulkAdd(seedData.clients, { allKeys: true });
		console.log(`✅ Inserted ${clientIds.length} clients`);

		const jobsToSeed: Job[] = seedData.jobs.map((job, index) => {
			const originalClientIndex = job.clientId - 1;
			const realClientId = clientIds[originalClientIndex] ?? clientIds[0];

			// )=- Keep dates stable unless forcing
			return {
				...job,
				clientId: realClientId,
				start: new Date(job.start),
				end: new Date(job.end),
				createdAt: new Date(),
				updatedAt: new Date()
			};
		});

		await db.jobs.bulkAdd(jobsToSeed);
		console.log(`✅ Successfully seeded ${clientIds.length} clients and ${jobsToSeed.length} jobs`);
	} finally {
		isSeeding = false; // )=- Always reset the guard
	}
}

// )=- Only force when you really want to reset
export async function forceSeed() {
	await seedSampleData(true);
}
