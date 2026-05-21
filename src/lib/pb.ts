// src/lib/pb.ts
import PocketBase from 'pocketbase';
import { db, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

// PocketBase client singleton (single source of truth for auth + sync)
export const pb = new PocketBase(
    import.meta.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'
);

// Check if user is Authenticated Helper
export function isAuthenticated(): boolean {
    return pb.authStore.isValid;
}

//Email + Password login
export async function loginWithEmail(email: string, password: string) {
	try {
		const authData = await pb.collection('users').authWithPassword(email, password);

		// )=- FIXED: Properly declare and populate localUser
		const pbUser = authData.record;
		const localUser: User = {
			name: pbUser.name || email.split('@')[0] || 'Admin', // or fallback to seeded Admin
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
		console.log('✅ PB super admin cached to Dexie:', localUser.name);
		
		//  Pull jobs immediately so Dexie has fresh data
		await pullJobsFromServer();

		return authData;
	} catch (err) {
		console.error('Email login failed:', err);
		throw err;
	}
}

//Pin Login (local/offline fallback - checks Dexie first)
export async function loginWithPin(name: string, pin: string) {
	try {
		// First try local Dexie (works offline)
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

		console.log('✅ PIN login successful (offline):', name);
		return { record: user }; // mimic PocketBase shape for consistency
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
			const job = {
				id: Number(rec.id),
				clientId: Number(rec.client),
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

			await db.jobs.put(job); // upsert into dexie
			}

			console.log(`✅ Pulled and cached ${records.length} jobs from PocketBase`);
	} catch (err) {
		console.error('Pull failed', err);
	}
}
//push local changes to PocketBase
export async function syncJobToServer(job: any) {
	if (!pb.authStore.isValid) return;
	
	try {
		const data = {
			client: job.clientId,
			title: job.title,
			start: job.start.toISOString(),
			end: job.end.toISOString(),
			assignedCrew: job.assignedCrew,
			status: job.status,
			billableItems: job.billableItems,
			subtotal: job.subtotal,
			taxRate: job.taxRate,
			taxAmount: job.taxAmount,
			totalAmount: job.totalAmount,
			areaOfTown: job.areaOfTown,
			notes: job.notes,
			updatedAt: new Date().toISOString()
		};
		if (job.id) {
			await pb.collection('jobs').update(String(job.id), data);
		} else {
			const record = await pb.collection('jobs').create(data);
			//update local dexie with server generated ID
			await db.jobs.update(job.id || record.id, { id: Number(record.id) });
		}
		console.log('✅ Job synced to server');
  		} catch (err) {
    	console.warn('⚠️ Sync to server failed (offline ok)', err);
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