// src/lib/pb.ts
import PocketBase from 'pocketbase';
import { db, processSyncQueue, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

// PocketBase client singleton (single source of truth for auth + sync)
export const pb = new PocketBase(import.meta.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090');

// Check if user is Authenticated Helper
export function isAuthenticated(): boolean {
	return pb.authStore.isValid;
}

//Email + Password login 
export async function loginWithEmail(email: string, password: string) {
	try {
		const authData = await pb.collection('users').authWithPassword(email, password);

		const pbUser = authData.record;

		const localUser: User = {
			id: pbUser.id,
			name: pbUser.name || email.split('@')[0] || 'Admin',
			pinHash: pbUser.pinHash || '',
			role: pbUser.role || 'admin',
			photo: pbUser.photo ? pbUser.photo : undefined,
			active: pbUser.active ?? true,
			forcePinUpdate: pbUser.forcePinUpdate ?? false,
			forcePhotoUpdate: pbUser.forcePhotoUpdate ?? false,
			createdAt: new Date(pbUser.created || pbUser.createdAt),
			updatedAt: new Date(pbUser.updated || pbUser.updatedAt)
		};

		await db.users.put(localUser);
		console.log('✅ PB super admin synced to Dexie:', localUser.name);

		await pullJobsFromServer();

		// Process any pending offline changes
		if (navigator.onLine) {
			await processSyncQueue();
		}

		console.log('✅ Login complete + sync queue processed');
		return authData;
	} catch (err) {
		console.error('Email login failed:', err);
		throw err;
	}
}

//Pin Login (local/offline fallback)
export async function loginWithPin(name: string, pin: string) {
	try {
		const localUsers = await db.users.where('name').equals(name).toArray();
		const user = localUsers[0];

		if (!user || !user.pinHash) {
			throw new Error('User not found or no PIN set');
		}

		const isValid = await bcrypt.compare(pin, user.pinHash);
		if (!isValid) {
			throw new Error('Invalid PIN');
		}

		if (!user.active) {
			throw new Error('Account is inactive');
		}

		// )=- Set current user in auth store
		auth.currentUser = user;
		localStorage.setItem('currentUserId', user.id!);

		// )=- NEW: Process any pending offline changes on PIN login too
		if (navigator.onLine) {
			await processSyncQueue();
		}

		console.log('✅ PIN login successful (offline + sync queue processed):', name);
		return { record: user };
	} catch (err) {
		console.error('PIN login failed:', err);
		throw err;
	}
}

//pull latest jobs from PocketBase into Dexie
export async function pullJobsFromServer() {
	if (!pb.authStore.isValid) return;

	try {
		const records = await pb.collection('jobs').getFullList({
			sort: '-updatedAt',
			expand: 'client'
		});

		for (const rec of records) {
			const serverJob = {
				id: rec.id,
				clientId: rec.expand?.client?.id || rec.client,
				title: rec.title,
				start: new Date(rec.start),
				end: new Date(rec.end),
				assignedCrew: rec.assignedCrew || [],
				status: rec.status,
				billableItems: rec.billableItems || [],
				subtotal: rec.subtotal || 0,
				taxRate: rec.taxRate || 0.08,
				taxAmount: rec.taxAmount || 0,
				totalAmount: rec.totalAmount || 0,
				areaOfTown: rec.areaOfTown,
				notes: rec.notes,
				cancelReason: rec.cancelReason,
				cancelNotes: rec.cancelNotes,
				cancelledAt: rec.cancelledAt ? new Date(rec.cancelledAt) : undefined,
				cancelledBy: rec.cancelledBy,
				createdAt: new Date(rec.created),
				updatedAt: new Date(rec.updated)
			};

			// )=- CONFLICT RESOLUTION: Last-write-wins
			const localJob = await db.jobs.get(rec.id);

			if (localJob) {
				// If local version is newer, skip this record
				if (localJob.updatedAt > serverJob.updatedAt) {
					console.log(`⏭️ Skipping job ${rec.id} — local version is newer`);
					continue;
				}
			}

			// Otherwise, update local with server version
			await db.jobs.put(serverJob);
		}

		console.log(`✅ Pulled and merged ${records.length} jobs from PocketBase`);
	} catch (err) {
		console.error('Pull failed', err);
	}
}

//push local changes to PocketBase (jobs)
export async function syncJobToServer(job: any) {
	if (!pb.authStore.isValid) {
		console.warn('⚠️ Cannot sync job — not authenticated');
		return;
	}

	console.log('🔄 Attempting to push job to PocketBase. Has ID?', !!job.id);

	try {
		const data = {
			client: job.clientId,               
			title: job.title,
			start: job.start.toISOString(),
			end: job.end.toISOString(),
			assignedCrew: job.assignedCrew || [],
			status: job.status,
			billableItems: job.billableItems || [],
			subtotal: Number(job.subtotal) || 0,
			taxRate: job.taxRate || 0.08,
			taxAmount: Number(job.taxAmount) || 0,
			totalAmount: Number(job.totalAmount) || 0,
			areaOfTown: job.areaOfTown,
			notes: job.notes || '',
			updatedAt: new Date().toISOString()
		};

		if (job.id) {
			//  Always update if we have an ID (string)
			await pb.collection('jobs').update(job.id, data);
			console.log('✅ Job UPDATED in PocketBase:', job.id);
		} else {
			const record = await pb.collection('jobs').create(data);
			// Update local record with the new PB ID
			await db.jobs.put({ ...job, id: record.id });
			console.log('✅ Job CREATED in PocketBase:', record.id);
		}
	} catch (err: any) {
		console.error('❌ Job sync to PocketBase FAILED:', err);
		if (err.response?.data) {
			console.error('📋 PocketBase validation errors:', err.response.data);
		}
	}
}

// NEW: Dexie clients → PocketBase
export async function syncClientToServer(client: any) {
	if (!pb.authStore.isValid) {
		console.warn('⚠️ Cannot sync client — not authenticated');
		return;
	}

	try {
		const data = {
			name: client.name,
			serviceAddressStreet: client.serviceAddressStreet,
			serviceAddressCity: client.serviceAddressCity,
			serviceAddressState: client.serviceAddressState,
			serviceAddressZip: client.serviceAddressZip,
			areaOfTown: client.areaOfTown,
			preferredBillingMethod: client.preferredBillingMethod,
			phone: client.phone,
			email: client.email || '',
			notes: client.notes || '',
			updatedAt: new Date().toISOString()
		};

		if (client.id) {
			await pb.collection('clients').update(client.id, data);
			console.log('✅ Client UPDATED in PocketBase:', client.id);
		} else {
			const record = await pb.collection('clients').create(data);
			await db.clients.put({ ...client, id: record.id });
			console.log('✅ Client CREATED in PocketBase:', record.id);
		}
	} catch (err: any) {
		console.error('❌ Client sync to PocketBase FAILED:', err);
	}
}

export function logout() {
	pb.authStore.clear();
	console.log('👋 Logged out');
}

//Get current logged-in user record
export function getCurrentUser() {
	return pb.authStore.model;
}
