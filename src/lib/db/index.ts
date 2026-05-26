import Dexie, { type EntityTable } from 'dexie';
import { BUSINESS_CONFIG } from '$lib/config';
import * as bcrypt from 'bcryptjs';
import { pb, pullJobsFromServer } from '$lib/db/pb'; 

export interface Client {
	id?: string;
	pbId?: string;
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

db.version(12).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown',
	users: 'id, name, email, role, active, forcePhotoUpdate, forcePinUpdate',
	syncQueue: '++id, type, collection, recordId, createdAt'
});

// ==================== JOB FUNCTIONS ====================

// line 90
export async function createJob(jobData: any): Promise<string> {
  const billableItems = jobData.billableItems?.length
    ? jobData.billableItems.map((item: any) => ({ ...item }))
    : [{ title: String(jobData.title), price: 450, quantity: 1, total: 450 }];

  const newId = jobData.id || crypto.randomUUID();

  const newJob = {
    id: newId,
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

  // line 116
  const id = await db.jobs.add(newJob);
  console.log(`✅ Job created locally (optimistic): ${id}`);

  await addToSyncQueue({
    type: 'create',
    collection: 'jobs',
    recordId: String(id),
    data: newJob
  });

  if (navigator.onLine) await processSyncQueue();

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

	if (navigator.onLine) await processSyncQueue();
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

	if (navigator.onLine) await processSyncQueue();
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

	if (navigator.onLine) await processSyncQueue();
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
	const newId = clientData.id || crypto.randomUUID();

	const newClient = {
		...clientData,
		id: newId,
		createdAt: new Date(),
		updatedAt: new Date()
	};

	const id = await db.clients.add(newClient);

	await addToSyncQueue({
		type: 'create',
		collection: 'clients',
		recordId: String(id),
		data: newClient
	});

	if (navigator.onLine) await processSyncQueue();

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

	if (navigator.onLine) await processSyncQueue();
	console.log(`✅ Client ${clientId} updated locally (optimistic)`);
}

export async function deleteClient(clientId: string) {
	const exists = await db.clients.get(clientId);
	if (!exists) return; // Already deleted

	const idToDelete = await resolveClientPbId(clientId);

	await db.clients.delete(clientId);

	await addToSyncQueue({
		type: 'delete',
		collection: 'clients',
		recordId: idToDelete
	});

	if (navigator.onLine) await processSyncQueue();
}

export async function resolveClientPbId(localClientId: string): Promise<string> {
	if (!localClientId) return localClientId;

	// First try
	let client = await db.clients.get(localClientId);
	if (client?.pbId) return client.pbId;

	// One quick retry (covers the Dexie timing edge case)
	await new Promise((r) => setTimeout(r, 60));
	client = await db.clients.get(localClientId);
	return client?.pbId || client?.id || localClientId;
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
					const { id, createdAt, updatedAt, clientId, ...rest } = item.data;

					const pbPayload = {
						...rest,
						client: clientId,
						start: new Date(item.data.start).toISOString(),
						end: new Date(item.data.end).toISOString(),
						createdAt: new Date(item.data.createdAt || Date.now()).toISOString(),
						updatedAt: new Date(item.data.updatedAt || Date.now()).toISOString()
					};

					try {
						const record = await pb.collection('jobs').create(pbPayload);
						await db.jobs.update(item.recordId, { pbId: record.id });
						console.log(`✅ Job pushed to PocketBase: ${record.id}`);
					} catch (err: any) {
						console.error('❌ Job create failed:', err.response?.data);
						throw err;
					}
				} else if (item.type === 'update') {
					const job = await db.jobs.get(item.recordId);
					const realId = job?.pbId || job?.id || item.recordId;

					try {
						await pb.collection('jobs').update(realId, item.data);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				} else if (item.type === 'delete') {
					const job = await db.jobs.get(item.recordId);
					const realId = job?.pbId || job?.id || item.recordId;

					try {
						await pb.collection('jobs').delete(realId);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				}
			}

			if (item.collection === 'clients') {
				if (item.type === 'create') {
					const { id, ...clientData } = item.data;

					try {
						const record = await pb.collection('clients').create(clientData);

						const existing = await db.clients.get(item.recordId);
						if (existing) {
							await db.clients.put({ ...existing, pbId: record.id });
						} else {
							await db.clients.update(item.recordId, { pbId: record.id });
						}

						console.log(`✅ Client synced to PocketBase: ${record.id}`);

						const pendingDeletes = await db.syncQueue
							.where('recordId')
							.equals(item.recordId)
							.and((q) => q.type === 'delete' && q.collection === 'clients')
							.toArray();

						for (const q of pendingDeletes) {
							await db.syncQueue.update(q.id!, { recordId: record.id });
						}
					} catch (err: any) {
						console.error('❌ Client sync failed with 400:', err.response?.data);
						throw err;
					}
				} else if (item.type === 'update') {
					try {
						const currentClient = await db.clients.get(item.recordId);
						const realId = currentClient?.pbId || currentClient?.id || item.recordId;
						await pb.collection('clients').update(realId, item.data);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				} else if (item.type === 'delete') {
					if (!item.recordId) {
						await db.syncQueue.delete(item.id!);
						continue;
					}

					const realId = await resolveClientPbId(item.recordId);

					try {
						await pb.collection('clients').delete(realId);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				}
			}

			// TODO: Add similar logic for users

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
