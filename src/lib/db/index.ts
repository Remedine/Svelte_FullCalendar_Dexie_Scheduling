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

// )=- Helper to convert data URL (from camera FileReader) back to Blob for proper PocketBase file field upload.
// PB file fields (like 'photo' on users) expect Blob/File in the update payload, not raw base64 data URLs.
// Without this, we get "validation_invalid_file" 400 on photo updates from profile page.
function dataUrlToBlob(dataUrl: string): Blob {
	const arr = dataUrl.split(',');
	const mimeMatch = arr[0].match(/:(.*?);/);
	const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
	const bstr = atob(arr[1]);
	let n = bstr.length;
	const u8arr = new Uint8Array(n);
	while (n--) {
		u8arr[n] = bstr.charCodeAt(n);
	}
	return new Blob([u8arr], { type: mime });
}

// ==================== AREA HELPER (simplified for fresh start) ====================
// )=- Removed legacy mapping. We now trust area IDs coming directly from options table.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
function getValidAreaOfTown(area: string | undefined): string {
	return area || '';
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
	areaOfTown: string;
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
	areaOfTown: string;
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
	pbId?: string;
	firstName?: string;  // )=- Optional for backward compat with existing data. New records always set via createUser/edit.
	lastName?: string;
	name: string;  // derived or legacy full name for compat with assignedCrew arrays and old displays
	pinHash: string;
	email?: string;
	role: 'admin' | 'crew';
	photo?: string;
	active: boolean;
	forcePinUpdate: boolean;
	forcePhotoUpdate: boolean;
	verified?: boolean;  // )=- Optional/undefined for old data; treat as false for quick PIN gating. Set true on email verification.
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
	// )=- Using array to match how ClientForm and clients page consume the data
	areasOfTown: Array<{
		id: string;
		label: string;
		color: string;
		sortOrder?: number;
	}>;
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

db.version(16).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown',
	users: 'id, firstName, lastName, name, email, role, active, forcePhotoUpdate, forcePinUpdate, pbId, verified',  // )=- Bumped to v16 for firstName, lastName, verified fields. Indexed for lookups (PIN login by firstName, etc.).
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

	// )=- Pull tax rate from options table instead of hardcoded value
	const optionsRecord = await db.options.get(1);
	const taxRate = optionsRecord?.taxRate ?? 0.08;

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
		taxRate,
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
		resolvedUpdates.clientId = await resolveClientPbId(resolvedUpdates.clientId);
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
		data: mergedUpdates
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

// )=- Updated createUser for new auth flow: requires firstName, lastName, email, password (for PB verified auth record).
// Sets derived 'name', verified: false initially (PIN quick-login only after email verification sets it true).
// Password is passed only in queue data for PB create (not stored in local Dexie user).
// Follows clients/jobs pattern exactly for local id vs PB id.
export async function createUser(
	userData: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'pbId' | 'name' | 'verified'> & { password: string }
): Promise<string> {
	const { password, firstName, lastName, ...rest } = userData;
	const newId = crypto.randomUUID();
	const fullName = `${firstName} ${lastName}`.trim();

	const newUser = safeClone({
		...rest,
		id: newId,
		firstName,
		lastName,
		name: fullName,
		verified: false,  // )=- New users start unverified for quick PIN; set true on successful email/password login.
		createdAt: new Date(),
		updatedAt: new Date()
	});

	const id = await db.users.add(newUser);

	// Queue data includes password only for the PB side create (not persisted locally).
	const queueData = {
		...newUser,
		password,
	};

	await addToSyncQueue({
		type: 'create',
		collection: 'users',
		recordId: String(id),
		data: queueData
	});

	if (navigator.onLine) await processSyncQueue();

	return id;
}

export async function updateUser(userId: string, updates: Partial<User>) {
	const safeUpdates = safeClone({ ...updates, updatedAt: new Date() });
	await db.users.update(userId, safeUpdates);

	await addToSyncQueue({
		type: 'update',
		collection: 'users',
		recordId: userId,
		data: safeUpdates
	});

	if (navigator.onLine) await processSyncQueue();
}

export async function deleteUser(userId: string) {
	const exists = await db.users.get(userId);
	if (!exists) return;

	const idToDelete = exists.pbId || userId;

	await db.users.delete(userId);

	await addToSyncQueue({
		type: 'delete',
		collection: 'users',
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

			// )=- users handling inserted here (inside the per-item try, before the shared delete).
			// This ensures every queued users item gets processed like jobs/clients.
			if (item.collection === 'users') {
				if (item.type === 'create') {
					const { id, password: providedPassword, ...userData } = item.data;

					// )=- Use the real password provided at creation (from admin modal) instead of random.
					// firstName/lastName now sent to PB (assume collection has these fields or map to 'name' if needed).
					// PB still requires password + passwordConfirm for auth record creation.
					const password = providedPassword || crypto.randomUUID().slice(0, 16) + 'Aa1!';
					const email = userData.email || `${(userData.firstName || userData.name || 'user').toLowerCase().replace(/\s+/g, '')}@crew.local`;

					const safeUserData = safeClone({
						...userData,
						email,
						password,
						passwordConfirm: password,
						// If your PB users collection doesn't have firstName/lastName yet, you can map:
						// name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
					});

					// )=- Also convert photo for create path (defensive).
					if (typeof safeUserData.photo === 'string' && safeUserData.photo.startsWith('data:')) {
						safeUserData.photo = dataUrlToBlob(safeUserData.photo);
					}

					try {
						const record = await pb.collection('users').create(safeUserData);

						const existing = await db.users.get(item.recordId);
						if (existing) {
							await db.users.put({ ...existing, pbId: record.id });
						} else {
							await db.users.update(item.recordId, { pbId: record.id });
						}

						console.log(`✅ User synced to PocketBase: ${record.id}`);

						const pendingDeletes = await db.syncQueue
							.where('recordId')
							.equals(item.recordId)
							.and((q) => q.type === 'delete' && q.collection === 'users')
							.toArray();

						for (const q of pendingDeletes) {
							await db.syncQueue.update(q.id!, { recordId: record.id });
						}
					} catch (err: any) {
						console.error('❌ User sync failed with 400:', err.response?.data);
						throw err;
					}
				} else if (item.type === 'update') {
					try {
						const currentUser = await db.users.get(item.recordId);
						const realId = currentUser?.pbId || currentUser?.id || item.recordId;

						const { id, pbId, createdAt, updatedAt, ...cleanData } = item.data;

						let pbPayload = safeClone(cleanData);

						// )=- Convert any data URL photo to Blob so PB accepts it as a valid file upload.
						// This fixes the 400 "validation_invalid_file" when crew uploads photo from /profile.
						if (typeof pbPayload.photo === 'string' && pbPayload.photo.startsWith('data:')) {
							pbPayload.photo = dataUrlToBlob(pbPayload.photo);
						}

						// )=- Never send 'email' in a generic users update payload.
						// Direct { email: 'new@...' } on an auth collection while authenticated as that user
						// triggers "validation_values_mismatch" (because email change confirmation is enabled by default).
						// Email changes are handled via pb.collection('users').requestEmailChange() in the profile UI
						// (the secure flow that sends a confirmation to the new address).
						// We still update the email locally in Dexie for immediate app use (PIN login etc.).
						if ('email' in pbPayload) {
							delete (pbPayload as any).email;
						}

						// Avoid sending an empty (or only-meta) payload which can happen for email-only changes.
						const keys = Object.keys(pbPayload);
						if (keys.length === 0 || keys.every(k => k === 'updatedAt')) {
							console.log(`ℹ️ Skipping empty PB user update for ${realId} (email change handled via requestEmailChange)`);
						} else {
							await pb.collection('users').update(realId, pbPayload);
							console.log(`✅ User updated in PocketBase: ${realId}`);
						}
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							console.error(
								'❌ User update failed:',
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

					const realId = item.recordId;

					try {
						await pb.collection('users').delete(realId);
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

export async function cleanupDuplicateUsers() {
  // )=- General dedup for users by email to handle cases where loginWithEmail created a shadow record (PB id as key) alongside a local UUID record from admin creation.
  // Prefers keeping a record with firstName/lastName (from creation), ensures pbId is on kept, deletes others.
  // Called from user list loads and login to keep Dexie clean. UI also has per-list dedup.
  const allUsers = await db.users.toArray();
  const byEmail: { [k: string]: any[] } = {};
  for (const u of allUsers) {
    if (u.email) {
      (byEmail[u.email] ||= []).push(u);
    }
  }
  for (const email in byEmail) {
    const group = byEmail[email];
    if (group.length > 1) {
      const keep = group.find(g => g.firstName && g.lastName) || group[0];
      console.log(`🧹 cleanupDuplicateUsers: keeping ${keep.id} for ${email}, removing ${group.length - 1} dup(s)`);
      for (const g of group) {
        if (g.id !== keep.id) {
          await db.users.delete(g.id!);
        }
      }
      const pbIdCandidate = group.find(g => g.pbId)?.pbId;
      if (pbIdCandidate && !keep.pbId) {
        await db.users.update(keep.id!, { pbId: pbIdCandidate });
      }
    }
  }
}

export { db };
export type { Client, Job, User };
