import { db } from './index';
import { BUSINESS_CONFIG } from '$lib/config';
import type { Client, Job } from './index';

export async function seedSampleData() {
	// Prevent seeding multiple times
	const existingClients = await db.clients.count();
	if (existingClients > 0) {
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
			notes: 'Commercial building - 3 stories',
			createdAt: new Date(),
			updatedAt: new Date()
		},
		{
			name: 'Maria Rodriguez',
			serviceAddressStreet: '789 Back Loop Road',
			serviceAddressCity: 'Juneau',
			serviceAddressState: 'AK',
			serviceAddressZip: '99801',
			areaOfTown: 'back-loop-fritz-cove',
			preferredBillingMethod: 'credit-debit',
			phone: '907-555-0789',
			email: 'maria.r@email.com',
			notes: 'Prefers morning appointments',
			createdAt: new Date(),
			updatedAt: new Date()
		}
	]);

	console.log(`✅ Seeded ${clientIds.length} sample clients`);

	// Sample Jobs
	const sampleJobs: Job[] = [
		{
			clientId: clientIds[0],
			title: 'Full Exterior Window Cleaning',
			start: new Date(2026, 4, 15, 9, 0), // May 15, 2026
			end: new Date(2026, 4, 15, 13, 0),
			assignedCrew: ['Mike', 'Sarah'],
			status: 'scheduled',
			billableItems: [
				{ title: 'Full Exterior Window Cleaning', price: 450, quantity: 1, total: 450 }
			],
			subtotal: 450,
			taxRate: BUSINESS_CONFIG.defaultTaxRate,
			taxAmount: 450 * BUSINESS_CONFIG.defaultTaxRate,
			totalAmount: 450 * (1 + BUSINESS_CONFIG.defaultTaxRate),
			areaOfTown: 'thane',
			createdAt: new Date(),
			updatedAt: new Date()
		},
		{
			clientId: clientIds[1],
			title: 'High Windows + Skylights',
			start: new Date(2026, 4, 16, 10, 0),
			end: new Date(2026, 4, 16, 14, 30),
			assignedCrew: ['Alex'],
			status: 'scheduled',
			billableItems: [
				{ title: 'High Windows / Skylights', price: 125, quantity: 1, total: 125 },
				{ title: 'Siding Cleaning', price: 275, quantity: 1, total: 275 }
			],
			subtotal: 400,
			taxRate: BUSINESS_CONFIG.defaultTaxRate,
			taxAmount: 400 * BUSINESS_CONFIG.defaultTaxRate,
			totalAmount: 400 * (1 + BUSINESS_CONFIG.defaultTaxRate),
			areaOfTown: 'downtown',
			createdAt: new Date(),
			updatedAt: new Date()
		}
	];

	const jobIds = await db.jobs.bulkAdd(sampleJobs);
	console.log(`✅ Seeded ${jobIds.length} sample jobs`);

	return { clientIds, jobIds };
}
