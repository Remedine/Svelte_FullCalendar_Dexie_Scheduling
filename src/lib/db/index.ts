import Dexie, { type EntityTable } from 'dexie';
import { BUSINESS_CONFIG } from '$lib/config';
import * as bcrypt from 'bcryptjs';
import { pb, syncJobToServer, syncClientToServer, pullJobsFromServer } from '$lib/pb';

export interface Client {
	id?: string;
	name: string;
	serviceAddressStreet: string;
	serviceAddressCity: string;
	serviceAddressState: string;
	serviceAddressZip: string;
	areaOfTown: 'thane' | 'downtown' | 'douglas';
	preferredBillingMethod: 'email' | 'check' | 'invoice';
	phone: string;
	email: string;
	notes?: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}

export interface Job {
	id?: string;
	pbId?: string;
	clientId: string;
	title: string;
	start: Date;
	end: Date;
	assignedCrew: string[];
	status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
	billableItems: Array<{
		title: string;
		price: number;
		quantity: number;
		total: number;
	}>;
	subtotal: number;
	taxRate: number;
	taxAmount: number;
	totalAmount: number;
	areaOfTown: 'thane' | 'downtown' | 'douglas';
	notes?: string;
	cancelReason?: string;
	cancelNotes?: string;
	cancelledAt?: Date;
	cancelledBy: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface User {
	id?: string;
	name: string;
	pinHash: string; // hashed 4-digit PIN
	email?: string;
	role: 'admin' | 'crew';
	photo?: string; // base64 string
	active: boolean;
	forcePinUpdate: boolean;
	forcePhotoUpdate: boolean;
	createdAt: Date;
	updatedAt: Date;
}

const db = new Dexie('CapitalCityWindows') as Dexie & {
	clients: EntityTable<Client, 'id'>;
	jobs: EntityTable<Job, 'id'>;
};

db.version(10).stores({
	clients: 'id, name, areaOfTown, email',
	jobs: 'id, clientId, start, end, status, areaOfTown',
	users: 'id, name, email, role, active, forcePhotoUpdate, forcePinUpdate'
});

export async function getJobsForRange(start: Date, end: Date): Promise<Job[]> {
	return await db.jobs
		.where('start')
		.between(start, end, true, true)
		.and(job => job.status !== 'cancelled')
		.toArray();
}

// Update Jobs on change
export async function updateJob(jobId: string, updates: Partial<Job>) {
	await db.jobs.update(jobId, {
		...updates,
		updatedAt: new Date()
	});

	const updatedJob = await db.jobs.get(jobId);
	if (updatedJob) {
		await syncJobToServer(updatedJob);
	}

	console.log(`✅ Job ${jobId} updated and synced`);
}

// Cancel Job
export async function cancelJob(jobId: string, cancelReason: string, notes?: string) {
	await db.jobs.update(jobId, {
		status: 'cancelled',
		cancelReason,
		cancelledAt: new Date(),
		cancelledBy: 'User',
		notes: notes || undefined,
		updatedAt: new Date()
	});

	const updatedJob = await db.jobs.get(jobId);
	if (updatedJob) {
		await syncJobToServer(updatedJob);
	}

	console.log(`✅ Job ${jobId} cancelled and synced`);
}

// Used by drag & drop
export async function updateJobDates(jobId: string, newStart: Date, newEnd: Date) {
	await db.jobs.update(jobId, {
		start: newStart,
		end: newEnd,
		updatedAt: new Date()
	});

	const updatedJob = await db.jobs.get(jobId);
	if (updatedJob) {
		await syncJobToServer(updatedJob);
	}

	console.log(`✅ Job ${jobId} dates updated and synced`);
}

// )=- NEW: Create new job 
export async function createJob(jobData: any): Promise<string> {
	const billableItems = jobData.billableItems?.length
		? jobData.billableItems.map((item: any) => ({ ...item }))
		: [
				{
					title: String(jobData.title),
					price: 450,
					quantity: 1,
					total: 450
				}
			];

	const newJob = {
		clientId: String(jobData.clientId), 
		title: String(jobData.title),
		start: new Date(jobData.start),
		end: new Date(jobData.end),
		assignedCrew: [...jobData.assignedCrew],
		areaOfTown: jobData.areaOfTown,
		status: 'scheduled' as const,
		notes: jobData.notes || undefined,
		createdAt: new Date(),
		updatedAt: new Date(),
		billableItems,
		subtotal:
			jobData.subtotal ||
			billableItems.reduce((sum: number, item: any) => sum + (item.total || 0), 0),
		taxRate: BUSINESS_CONFIG.defaultTaxRate,
		taxAmount: jobData.taxAmount || 0,
		totalAmount: jobData.totalAmount || 0
	};

	const id = await db.jobs.add(newJob); 
	await syncJobToServer({ ...newJob, id: String(id) });

	console.log(`✅ New job created with ID: ${id}`);
	return id;
}

// Added back for your +page.svelte
export async function getUpcomingJobs(limit = 10): Promise<Job[]> {
	const now = new Date();
	return await db.jobs
		.where('start').aboveOrEqual(now)
		.and(job => job.status !== 'cancelled')
		.limit(limit)
		.toArray();
}

// )=- NEW: Create client + push to PocketBase
export async function createClient(
	clientData: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
	const newClient = {
		...clientData,
		createdAt: new Date(),
		updatedAt: new Date()
	};

	const id = await db.clients.add(newClient);
	const savedClient = await db.clients.get(id);
	if (savedClient) {
		await syncClientToServer(savedClient);
	}
	console.log(`✅ Client created with ID: ${id} and synced to PocketBase`);
	return id;
}

//  Update client + push to PocketBase
export async function updateClient(clientId: string, updates: Partial<Client>) {
	await db.clients.update(clientId, {
		...updates,
		updatedAt: new Date()
	});

	const updatedClient = await db.clients.get(clientId);
	if (updatedClient) {
		await syncClientToServer(updatedClient);
	}
	console.log(`✅ Client ${clientId} updated and synced to PocketBase`);
}

export { db };
export type { Client, Job, User };
export type AreaOfTown = keyof typeof BUSINESS_CONFIG.areasOfTown;

