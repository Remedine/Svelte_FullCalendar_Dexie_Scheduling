// src/lib/db/seed.ts
import { db } from './index';
import type { Job, User } from './index';
import seedData from './seed-data.json';
import * as bcrypt from 'bcryptjs';

let isSeeding = false;

export async function seedSampleData(force = false) {
	if (isSeeding) {
		console.log('⏳ Seed already in progress, skipping duplicate call');
		return;
	}
	isSeeding = true;

	try {
		const clientCount = await db.clients.count();
		const userCount = await db.users.count();

		if (clientCount > 0 && userCount > 0 && !force) {
			console.log(`✅ Sample data already exists (${clientCount} clients, ${userCount} users)`);
			return;
		}

		console.log('🌱 Seeding sample data for Capital City Windows...');

		if (force) {
			await Promise.all([db.clients.clear(), db.jobs.clear(), db.users.clear()]);
			console.log('🧹 Cleared previous data');
		}

		// === Existing client + job seeding (unchanged) ===
		const clientIds = await db.clients.bulkAdd(seedData.clients, { allKeys: true });
		console.log(`✅ Inserted ${clientIds.length} clients`);

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

		await db.jobs.bulkAdd(jobsToSeed);
		console.log(`✅ Seeded ${jobsToSeed.length} jobs`);

		// )=- NEW: Seed 1 Admin + 5 Crew members with hashed PINs
		const usersToSeed: Omit<User, 'id'>[] = [
			{
				name: 'Admin',
				pinHash: await bcrypt.hash('1234', 10),
				role: 'admin',
				active: true,
				forcePhotoUpdate: false,
				createdAt: new Date(),
				updatedAt: new Date()
			},
			{
				name: 'Mike Thompson',
				pinHash: await bcrypt.hash('5678', 10),
				role: 'crew',
				active: true,
				forcePhotoUpdate: true,
				createdAt: new Date(),
				updatedAt: new Date()
			},
			{
				name: 'John Ramirez',
				pinHash: await bcrypt.hash('4321', 10),
				role: 'crew',
				active: true,
				forcePhotoUpdate: true,
				createdAt: new Date(),
				updatedAt: new Date()
			},
			{
				name: 'Sarah Chen',
				pinHash: await bcrypt.hash('9876', 10),
				role: 'crew',
				active: true,
				forcePhotoUpdate: true,
				createdAt: new Date(),
				updatedAt: new Date()
			},
			{
				name: 'David Okon',
				pinHash: await bcrypt.hash('2468', 10),
				role: 'crew',
				active: true,
				forcePhotoUpdate: true,
				createdAt: new Date(),
				updatedAt: new Date()
			},
			{
				name: 'Lisa Morales',
				pinHash: await bcrypt.hash('1357', 10),
				role: 'crew',
				active: true,
				forcePhotoUpdate: true,
				createdAt: new Date(),
				updatedAt: new Date()
			}
		];

		await db.users.bulkAdd(usersToSeed);
		console.log(`✅ Seeded 1 admin + 5 crew members with secure PINs`);
	} finally {
		isSeeding = false;
	}
}

export async function forceSeed() {
	await seedSampleData(true);
}
