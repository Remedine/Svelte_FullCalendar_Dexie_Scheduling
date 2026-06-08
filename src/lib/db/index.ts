// src/lib/db/index.ts

import Dexie, { type EntityTable } from 'dexie';
import * as bcrypt from 'bcryptjs';
import { pb, pullJobsFromServer } from '$lib/db/pb';

// Dynamic import to break circular dependency with auth.svelte.ts
let auth: any = null;
import('$lib/stores/auth.svelte').then((module) => {
	auth = module.auth;
});

// SAFE CLONE HELPER
function safeClone<T>(obj: T): T {
	if (!obj) return obj;
	try {
		return JSON.parse(
			JSON.stringify(obj, (key, value) => {
				if (value instanceof Date) return value.toISOString();
				if (typeof value === 'function' || value?.__isSvelteProxy) return undefined;
				return value;
			})
		);
	} catch {
		if (Array.isArray(obj)) return [...obj] as T;
		if (typeof obj === 'object' && obj !== null) return { ...obj } as T;
		return obj;
	}
}


//AREA MAPPING HELPER
const AREA_ID_TO_OLD_VALUE: Record<string, string> = {
	'area-downtown': 'downtown',
	'area-north': 'thane',
	'area-south': 'douglas'
};

function getValidAreaOfTown(area: string | undefined): string {
	if (!area) return 'downtown';
	if (['thane', 'downtown', 'douglas'].includes(area)) return area;
	return AREA_ID_TO_OLD_VALUE[area] || 'downtown';
}


// Interface Types
export interface Client {
	id?: string;
	pbId?: string;
	name: string;
	serviceAddressStreet: string;
	serviceAddressCity: string;
	serviceAddressState: string;
	serviceAddressZip: string;
	areaOfTown: string; // )=- Changed from enum to string (supports dynamic areas from options)
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
	areaOfTown: string; // )=- Changed to string for dynamic areas
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

export interface AppOptions {
	id: string;
	taxRate: number;
	defaultJobDurationHours: number;
	defaultBillableItems: Array<{
		title: string;
		price: number;
		quantity?: number;
		hours?: number;
		isDefault?: boolean;
	}>;
	areasOfTown: Record<
		string,
		{
			label: string;
			color: string;
			sortOrder: number;
		}
	>;
	cancelReasons: string[];
	invoiceDueDays: number;
	lastUpdated: Date;
	updatedBy: string;
}

// Simple sync queue
export interface SyncQueueItem {
	id?: string;
	type: 'create' | 'update' | 'delete';
	collection: 'jobs' | 'clients' | 'users';
	recordId: string;
	data?: any;
	createdAt: Date;
}

const db = new Dexie('CapitalCityWindows') as Dexie & {
	clients: EntityTable<Client, 'id'>;
	jobs: EntityTable<Job, 'id'>;
	users: EntityTable<User, 'id'>;
	syncQueue: EntityTable<SyncQueueItem, 'id'>;
	options: EntityTable<AppOptions, 'id'>;
};

db.version(14).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown',
	users: 'id, name, email, role, active, forcePhotoUpdate, forcePinUpdate',
	syncQueue: '++id, type, collection, recordId, createdAt',
	options: 'id'
});

// ==================== JOB FUNCTIONS ====================

export async function createJob(jobData: any): Promise<string> {
	const billableItems = jobData.billableItems?.length
		? jobData.billableItems.map((item: any) => ({ ...item }))
		: [{ title: String(jobData.title), price: 450, quantity: 1, total: 450 }];

	const newId = jobData.id || crypto.randomUUID();

	const realClientId = await resolveClientPbId(jobData.clientId);

	if (!realClientId) {
		console.error('❌ Could not resolve client ID for job creation');
		throw new Error('Invalid client selected');
	}

	const newJob = safeClone({
		id: newId,
		clientId: realClientId,
		title: String(jobData.title),
		start: new Date(jobData.start),
		end: new Date(jobData.end),
		assignedCrew: [...(jobData.assignedCrew || [])],
		areaOfTown: getValidAreaOfTown(jobData.areaOfTown),
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
	});

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

	const resolvedUpdates = { ...updates };

	if (resolvedUpdates.clientId) {
		resolvedUpdates.clientId = await resolveClientPbId(resolvedUpdates.clientId)
	}
	const safeUpdates = safeClone({ ...updates, updatedAt: new Date() });
	await db.jobs.update(jobId, safeUpdates);

	const updatedJob = await db.jobs.get(jobId);
	if (updatedJob) {
		await addToSyncQueue({
			type: 'update',
			collection: 'jobs',
			recordId: jobId,
			data: safeUpdates
		});
	}

	if (navigator.onLine) await processSyncQueue();
}

export async function cancelJob(jobId: string, cancelReason: string, notes?: string) {
	const currentUser = auth?.currentUser;

	const updates = safeClone({
		status: 'cancelled' as const,
		cancelReason,
		cancelledAt: new Date(),
		cancelledBy: currentUser?.id || null,
		notes: notes || undefined,
		updatedAt: new Date()
	});

	await db.jobs.update(jobId, updates);

	await addToSyncQueue({
		type: 'update',
		collection: 'jobs',
		recordId: jobId,
		data: updates
	});

	if (navigator.onLine) await processSyncQueue();
	console.log(`✅ Job ${jobId} cancelled by ${currentUser?.name || 'Unknown'}`);
}

export async function updateJobDates(jobId: string, newStart: Date | null, newEnd: Date | null) {
	if (!newStart) {
		console.error('updateJobDates: newStart is null');
		return;
	}

	const job = await db.jobs.get(jobId);
	if (!job) {
		console.error('updateJobDates: job not found', jobId);
		return;
	}

	const realId = job.pbId || job.id || jobId;

	// )=- Resolve clientId to real PB ID for consistency (even on date-only updates)
	const resolvedClientId = job.clientId ? await resolveClientPbId(job.clientId) : undefined;

	const finalEnd = newEnd || new Date(newStart.getTime() + 4 * 60 * 60 * 1000);

	const updates = safeClone({
		start: newStart,
		end: finalEnd,
		...(resolvedClientId && { clientId: resolvedClientId }),
		updatedAt: new Date()
	});

	await db.jobs.update(jobId, updates);

	await addToSyncQueue({
		type: 'update',
		collection: 'jobs',
		recordId: realId,
		data: updates
	});

	if (navigator.onLine) await processSyncQueue();
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

export async function getJobsForRange(
	start: Date,
	end: Date,
	includeCancelled = false
): Promise<Job[]> {
	return await db.jobs
		.where('start')
		.between(start, end, true, true)
		.and((job) => {
			if (includeCancelled) return true;
			return job.status !== 'cancelled';
		})
		.toArray();
}

// ==================== CLIENT FUNCTIONS ====================

export async function createClient(
	clientData: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
	const newId = clientData.id || crypto.randomUUID();

	const newClient = safeClone({
		...clientData,
		areaOfTown: getValidAreaOfTown(clientData.areaOfTown),
		id: newId,
		createdAt: new Date(),
		updatedAt: new Date()
	});

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
	// )=- Merge updates with fresh timestamp for both local and queue
	const mergedUpdates = safeClone({
		...updates,
		areaOfTown: getValidAreaOfTown(updates.areaOfTown),
		updatedAt: new Date()
	});

	await db.clients.update(clientId, mergedUpdates);

	await addToSyncQueue({
		type: 'update',
		collection: 'clients',
		recordId: clientId,
		data: mergedUpdates // )=- Queue the merged data (includes updatedAt)
	});

	if (navigator.onLine) await processSyncQueue();
	console.log(`✅ Client ${clientId} updated locally (optimistic)`);
}

export async function deleteClient(clientId: string) {
	const exists = await db.clients.get(clientId);
	if (!exists) return;

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

	let client = await db.clients.get(localClientId);
	if (client?.pbId) return client.pbId;

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
					const data = item.data;
					const realClientId = await resolveClientPbId(data.clientId || data.client);

					const pbPayload = safeClone({
						title: data.title,
						start: data.start instanceof Date ? data.start.toISOString() : data.start,
						end: data.end instanceof Date ? data.end.toISOString() : data.end,
						client: realClientId,
						assignedCrew: data.assignedCrew || [],
						areaOfTown: data.areaOfTown,
						notes: data.notes || undefined,
						billableItems: data.billableItems || [],
						subtotal: Number(data.subtotal) || 0,
						taxRate: Number(data.taxRate) || 0.08,
						taxAmount: Number(data.taxAmount) || 0,
						totalAmount: Number(data.totalAmount) || 0,
						status: data.status || 'scheduled'
					});

					try {
						const record = await pb.collection('jobs').create(pbPayload);
						await db.jobs.update(item.recordId, { pbId: record.id });
						console.log(`✅ Job pushed to PocketBase: ${record.id}`);
					} catch (err: any) {
						console.error('❌ Job create failed:', JSON.stringify(err.response?.data, null, 2));
					}
				} else if (item.type === 'update') {
					const job = await db.jobs.get(item.recordId);
					const realId = job?.pbId || job?.id || item.recordId;

					try {
						await pb.collection('jobs').update(realId, item.data);
						console.log(`✅ Job updated in PocketBase: ${realId}`);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							console.error('❌ Job update failed:', JSON.stringify(err.response?.data, null, 2));
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

					const safeClientData = safeClone({
						...clientData,
						areaOfTown: getValidAreaOfTown(clientData.areaOfTown)
					});

					try {
						const record = await pb.collection('clients').create(safeClientData);

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

						// )=- Clean payload: remove system fields that cause 400 on update
						const { id, pbId, createdAt, updatedAt, ...cleanData } = item.data;

						const safeCleanData = safeClone({
							...cleanData,
							areaOfTown: getValidAreaOfTown(cleanData.areaOfTown)
						});

						await pb.collection('clients').update(realId, safeCleanData);
						console.log(`✅ Client updated in PocketBase: ${realId}`);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							console.error(
								'❌ Client update failed:',
								JSON.stringify(err.response?.data, null, 2)
							);
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
