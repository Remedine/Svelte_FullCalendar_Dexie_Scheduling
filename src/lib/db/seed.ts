import { db } from './index';
import type { Job } from './index';

// )=- Seed data imported from JSON for easy editing
import seedData from './seed-data.json';

export async function seedSampleData(force = false) {
	const clientCount = await db.clients.count();
	if (clientCount > 0 && !force) {
		console.log('✅ Sample data already exists (use seedSampleData(true) to force)');
		return;
	}

	console.log('🌱 Seeding sample data for Capital City Windows...');

	if (force) {
		await Promise.all([db.clients.clear(), db.jobs.clear()]);
		console.log('🧹 Cleared previous sample data');
	}

	// )=- FIXED: More reliable bulkAdd with explicit options
	console.log('Adding clients...');
	const clientIds = await db.clients.bulkAdd(seedData.clients as any[], { allKeys: true });

	console.log('Raw clientIds returned from Dexie:', clientIds);

	if (!clientIds || clientIds.length === 0) {
		console.error('❌ No client IDs returned from bulkAdd');
		throw new Error('Failed to insert clients');
	}

	console.log(`✅ Inserted ${clientIds.length} clients with IDs:`, clientIds);

	// )=- FIXED: Proper mapping
	const jobsToSeed: Job[] = seedData.jobs.map((job, index) => {
		const originalClientIndex = job.clientId - 1;
		const realClientId = clientIds[originalClientIndex] ?? clientIds[0];

		return {
			...job,
			clientId: realClientId,
			start: new Date(job.start),
			end: new Date(job.end),
			createdAt: new Date(),
			updatedAt: new Date()
		};
	});

	console.log('Adding jobs...');
	await db.jobs.bulkAdd(jobsToSeed);

	console.log(`✅ Successfully seeded ${clientIds.length} clients and ${jobsToSeed.length} jobs`);
}

// )=- Quick helper
export async function forceSeed() {
	await seedSampleData(true);
}
