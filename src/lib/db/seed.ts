// src/lib/db/seed.ts
import { db } from './index';
import * as bcrypt from 'bcryptjs';

export async function seedSampleData() {

	const adminExists = await db.users.where('role').equals('admin').first();

	if (!adminExists) {
		const hashedPin = await bcrypt.hash('1234', 10); // Default admin PIN

		await db.users.add({
			id: 'admin-default',
			name: 'Admin',
			pinHash: hashedPin,
			role: 'admin',
			active: true,
			forcePinUpdate: false,
			forcePhotoUpdate: false,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		console.log('✅ Default admin user created (PIN: 1234)');
	}
}
