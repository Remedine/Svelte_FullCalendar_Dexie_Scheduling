import Dexie, { type EntityTable } from 'dexie';
import { BUSINESS_CONFIG } from '$lib/config';
import * as bcrypt from 'bcryptjs';
import { pb, pullJobsFromServer } from '$lib/pb'; // )=- Removed processSyncQueue from import

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
	pinHash: string;
	email?: string;
	role: 'admin' | 'crew';
	photo?: string;
	active: boolean;
	forcePinUpdate: boolean;
	forcePhotoUpdate: boolean;
	createdAt: Date;
	updatedAt: Date;
}

// Simple sync queue
export interface SyncQueueItem {
	id?: string;
	type: 'create' | 'update' | 'delete';
	collection: 'jobs' | 'clients' | 'users'; // )=- Fixed: was 'job'
	recordId: string;
	data?: any;
	createdAt: Date;
}

const db = new Dexie('CapitalCityWindows') as Dexie & {
	clients: EntityTable<Client, 'id'>;
	jobs: EntityTable<Job, 'id'>;
	users: EntityTable<User, 'id'>;
	syncQueue: EntityTable<SyncQueueItem, 'id'>;
};

db.version(11).stores({
	clients: 'id, name, areaOfTown, email',
	jobs: 'id, clientId, start, end, status, areaOfTown',
	users: 'id, name, email, role, active, forcePhotoUpdate, forcePinUpdate',
	syncQueue: '++id, type, collection, recordId, createdAt'
});

// ==================== JOB FUNCTIONS ====================

export async function createJob(jobData: any): Promise<string> {
	const billableItems = jobData.billableItems?.length
		? jobData.billableItems.map((item: any) => ({ ...item }))
		: [{ title: String(jobData.title), price: 450, quantity: 1, total: 450 }];

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
	console.log(`✅ Job created locally (optimistic): ${id}`);

	await addToSyncQueue({
		type: 'create',
		collection: 'jobs',
		recordId: String(id),
		data: newJob
	});

	if (navigator.onLine) processSyncQueue();

	return id;
}

export async function updateJob(jobId: string, updates: Partial<Job>) {
	await db.jobs.update(jobId, { ...updates, updatedAt: new Date() });

	const updatedJob = await db.jobs.get(jobId);
	if (updatedJob) {
		await addToSyncQueue({
			type: 'update',
			collection: 'jobs',
			recordId: jobId,
			data: updates
		});
	}

	if (navigator.onLine) processSyncQueue();
	console.log(`✅ Job ${jobId} updated locally (optimistic)`);
}

export async function cancelJob(jobId: string, cancelReason: string, notes?: string) {
	const updates = {
		status: 'cancelled' as const,
		cancelReason,
		cancelledAt: new Date(),
		cancelledBy: 'User',
		notes: notes || undefined,
		updatedAt: new Date()
	};

	await db.jobs.update(jobId, updates);

	await addToSyncQueue({
		type: 'update',
		collection: 'jobs',
		recordId: jobId,
		data: updates
	});

	if (navigator.onLine) processSyncQueue();
	console.log(`✅ Job ${jobId} cancelled locally (optimistic)`);
}

export async function updateJobDates(jobId: string, newStart: Date, newEnd: Date) {
	const updates = {
		start: newStart,
		end: newEnd,
		updatedAt: new Date()
	};

	await db.jobs.update(jobId, updates);

	await addToSyncQueue({
		type: 'update',
		collection: 'jobs',
		recordId: jobId,
		data: updates
	});

	if (navigator.onLine) processSyncQueue();
	console.log(`✅ Job ${jobId} dates updated locally (optimistic)`);
}

export async function getUpcomingJobs(limit = 10): Promise<Job[]> {
	const now = new Date();
	return await db.jobs
		.where('start')
		.aboveOrEqual(now)
		.and((job) => job.status !== 'cancelled')
		.limit(limit)
		.toArray();
}

export async function getJobsForRange(start: Date, end: Date): Promise<Job[]> {
	return await db.jobs
		.where('start')
		.between(start, end, true, true)
		.and((job) => job.status !== 'cancelled')
		.toArray();
}

// ==================== CLIENT FUNCTIONS ====================

export async function createClient(
	clientData: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
	const newClient = { ...clientData, createdAt: new Date(), updatedAt: new Date() };
	const id = await db.clients.add(newClient);

	await addToSyncQueue({
		type: 'create',
		collection: 'clients',
		recordId: String(id),
		data: newClient
	});

	if (navigator.onLine) processSyncQueue();
	console.log(`✅ Client created with ID: ${id}`);
	return id;
}

export async function updateClient(clientId: string, updates: Partial<Client>) {
	await db.clients.update(clientId, { ...updates, updatedAt: new Date() });

	await addToSyncQueue({
		type: 'update',
		collection: 'clients',
		recordId: clientId,
		data: updates
	});

	if (navigator.onLine) processSyncQueue();
	console.log(`✅ Client ${clientId} updated`);
}

// ==================== SYNC QUEUE ====================

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'createdAt'>) {
	await db.syncQueue.add({ ...item, createdAt: new Date() });
}

export async function processSyncQueue() {
	const items = await db.syncQueue.orderBy('createdAt').toArray();

	for (const item of items) {
		try {
			if (item.collection === 'jobs') {
				if (item.type === 'create') {
					await pb.collection('jobs').create(item.data);
				} else if (item.type === 'update') {
					await pb.collection('jobs').update(item.recordId, item.data);
				} else if (item.type === 'delete') {
					await pb.collection('jobs').delete(item.recordId);
				}
			}

			// TODO: Add similiar logic for client and users
			
			await db.syncQueue.delete(item.id!);
			console.log(`✅ Synced ${item.type} ${item.collection} ${item.recordId}`);
		} catch (err) {
			console.error(`Failed to sync queue item ${item.id}`, err);
		}
	}
}

export { db };
export type { Client, Job, User };
export type AreaOfTown = keyof typeof BUSINESS_CONFIG.areasOfTown;
