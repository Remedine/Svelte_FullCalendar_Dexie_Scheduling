import Dexie, { type EntityTable } from 'dexie';
import { BUSINESS_CONFIG } from '$lib/config';
import * as bcrypt from 'bcryptjs';

export interface Client {
	id?: number;
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
	id?: number;
	clientId: number;
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
	id?: number;
	name: string;
	pinHash: string; // hashed 4-digit PIN
	role: 'admin' | 'crew';
	photo?: string; // base64 string
	active: boolean;
	forcePhotoUpdate: boolean;
	createdAt: Date;
	updatedAt: Date;
}

const db = new Dexie('CapitalCityWindows') as Dexie & {
	clients: EntityTable<Client, 'id'>;
	jobs: EntityTable<Job, 'id'>;
};

db.version(4).stores({
	clients: '++id, name, areaOfTown, email',
	jobs: '++id, clientId, start, end, status, areaOfTown',
	users: '++id, name, role, active'
});

export async function getJobsForRange(start: Date, end: Date): Promise<Job[]> {
	return await db.jobs
	.where('start')
	.between(start, end, true, true)
	.and(job => job.status !== 'cancelled')
	.toArray();
}

// Helper Editing and cancelling jobs
export async function updateJob(jobId: number, updates: Partial<Job>) {
	await db.jobs.update(jobId, {
		...updates,
		updatedAt: new Date()
	});
	console.log(`✅ Job ${jobId} updated`);
}

// Cancel Job
export async function cancelJob(jobId: number, cancelReason: string, notes?: string) {
	await db.jobs.update(jobId, {
		status: 'cancelled',
		cancelReason,
		cancelledAt: new Date(),
		cancelledBy: 'User', // TODO: replace with real user later
		notes: notes || undefined,
		updatedAt: new Date() 
	});
	console.log(`❌ Job ${jobId} cancelled with reason: ${cancelReason}`);
}

// Used by drag & drop
export async function updateJobDates(jobId: number, newStart: Date, newEnd: Date) {
	await db.jobs.update(jobId, {
		start: newStart,
		end: newEnd,
		updatedAt: new Date()
	});
	console.log(`✅ Job ${jobId} rescheduled`);
}

// )=- NEW: Create new job 
export async function createJob(jobData: any): Promise<number> {
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
		clientId: Number(jobData.clientId),
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

export { db };
export type { Client, Job, User };
export type AreaOfTown = keyof typeof BUSINESS_CONFIG.areasOfTown;

