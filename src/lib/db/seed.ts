import { db } from './index';
import { BUSINESS_CONFIG } from '$lib/config';
import type { Job } from './index';

export async function seedSampleData() {
	// Only seed if no clients exist yet
	const clientCount = await db.clients.count();
	if (clientCount > 0) {
		console.log('✅ Sample data already exists');
		return;
	}

	console.log('🌱 Seeding sample data for CapitalCity Windows...');

	// Sample Clients
	const clientIds = await db.clients.bulkAdd([
		{
			name: 'John & Sarah Thompson',
			serviceAddressStreet: '123 Thane Road',
			serviceAddressCity: 'Juneau',
			serviceAddressState: 'AK',
			serviceAddressZip: '99801',
			areaOfTown: 'thane',
			preferredBillingMethod: 'email',
			phone: '907-555-0123',
			email: 'thompsonfamily@gmail.com',
			notes: 'Tall ladder needed on back side. Watch for dog.',
			createdAt: new Date(),
			updatedAt: new Date()
		},
		{
			name: 'Alaska Coastal Property Management',
			serviceAddressStreet: '456 Egan Drive',
			serviceAddressCity: 'Juneau',
			serviceAddressState: 'AK',
			serviceAddressZip: '99801',
			areaOfTown: 'downtown',
			preferredBillingMethod: 'check',
			phone: '907-555-0456',
			email: 'maintenance@alaskacoastal.com',
			notes: 'Commercial 3-story building',
			createdAt: new Date(),
			updatedAt: new Date()
		}
	]);

	// Sample Jobs
	const sampleJobs: Job[] = [
		{
			clientId: clientIds[0],
			title: 'Full Exterior Window Cleaning',
			start: new Date(2026, 4, 15, 9, 0),
			end: new Date(2026, 4, 15, 13, 0),
			assignedCrew: ['Mike', 'Sarah'],
			status: 'scheduled',
			billableItems: [{ title: 'Full Exterior', price: 450, quantity: 1, total: 450 }],
			subtotal: 450,
			taxRate: BUSINESS_CONFIG.defaultTaxRate,
			taxAmount: 450 * BUSINESS_CONFIG.defaultTaxRate,
			totalAmount: 450 * (1 + BUSINESS_CONFIG.defaultTaxRate),
			areaOfTown: 'thane',
			createdAt: new Date(),
			updatedAt: new Date()
		}
		
	];

	await db.jobs.bulkAdd(sampleJobs);

	console.log(`✅ Seeded ${clientIds.length} clients and ${sampleJobs.length} jobs`);
}
