// src/lib/pb.ts
import PocketBase from 'pocketbase';
import { db, processSyncQueue, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

// PocketBase client singleton
export const pb = new PocketBase(import.meta.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090');

export function isAuthenticated(): boolean {
	return pb.authStore.isValid;
}

// Email Login
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

		// Pull latest data from server first
		await pullJobsFromServer();
		await pullClientsFromServer();

		// Then push any pending local changes
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

// Pin Login
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

		auth.currentUser = user;
		localStorage.setItem('currentUserId', user.id!);

		// Pull latest data from server
		await pullClientsFromServer();
		await pullJobsFromServer();

		// Then push any pending local changes
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

// Pull jobs from PocketBase (with conflict resolution)
// line 79
export async function pullJobsFromServer() {
  if (!pb.authStore.isValid) return;

  try {
    const records = await pb.collection('jobs').getFullList({
      sort: '-updatedAt',
      expand: 'client',
      // line 84 - FIX: disable auto-cancellation to prevent aborted requests
      $autoCancel: false
    });

    const pbJobIds = new Set<string>();

    for (const rec of records) {
      pbJobIds.add(rec.id);

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

      const localJob = await db.jobs.get(rec.id);

      if (localJob && localJob.updatedAt > serverJob.updatedAt) {
        console.log(`⏭️ Skipping job ${rec.id} — local version is newer`);
        continue;
      }

      await db.jobs.put(serverJob);
    }

    // Delete stale local jobs
    const localJobs = await db.jobs.toArray();
    for (const localJob of localJobs) {
      if (localJob.id && !pbJobIds.has(localJob.id)) {
        await db.jobs.delete(localJob.id);
        console.log(`🗑️ Removed stale job from Dexie: ${localJob.title}`);
      }
    }

    console.log(`✅ Pulled, merged, and cleaned ${records.length} jobs`);
  } catch (err: any) {
    // Only log real errors, not auto-cancellations
    if (err?.status !== 0) {
      console.error('Pull jobs failed', err);
    }
  }
}

// Pull clients from PocketBase and merge into Dexie
export async function pullClientsFromServer() {
	if (!pb.authStore.isValid) return;

	const PAGE_SIZE = 100;
	let page = 1;
	let totalPages = 1;
	let totalPulled = 0;
	let totalDeleted = 0;

	console.log('🔄 Starting client sync from PocketBase...');

	try {
		// Step 1: Collect all PB client IDs
		const pbClientIds = new Set<string>();

		while (page <= totalPages) {
			const result = await pb.collection('clients').getList(page, PAGE_SIZE, {
				sort: '-updatedAt'
			});

			totalPages = result.totalPages;

			for (const rec of result.items) {
				pbClientIds.add(rec.id);

				const existingLocal = await db.clients.where('pbId').equals(rec.id).first();

				const serverClient = {
					id: existingLocal ? existingLocal.id : rec.id,
					pbId: rec.id,
					name: rec.name,
					serviceAddressStreet: rec.serviceAddressStreet || '',
					serviceAddressCity: rec.serviceAddressCity || '',
					serviceAddressState: rec.serviceAddressState || '',
					serviceAddressZip: rec.serviceAddressZip || '',
					areaOfTown: rec.areaOfTown,
					preferredBillingMethod: rec.preferredBillingMethod || 'email',
					phone: rec.phone || '',
					email: rec.email || '',
					notes: rec.notes || '',
					createdAt: new Date(rec.created),
					updatedAt: new Date(rec.updated)
				};

				const localClient = await db.clients.get(serverClient.id);

				if (localClient && localClient.updatedAt > serverClient.updatedAt) {
					continue;
				}

				await db.clients.put(serverClient);
				totalPulled++;
			}

			page++;
		}

		// Step 2: Find and delete clients that exist in Dexie but not in PB
		const localClients = await db.clients.toArray();

		for (const localClient of localClients) {
			if (localClient.pbId && !pbClientIds.has(localClient.pbId)) {
				await db.clients.delete(localClient.id!);
				totalDeleted++;
				console.log(`🗑️ Deleted client from Dexie (no longer in PB): ${localClient.name}`);
			}
		}

		console.log(`✅ Pulled and merged ${totalPulled} clients. Deleted ${totalDeleted} from Dexie.`);
	} catch (err) {
		console.error('❌ Pull clients failed:', err);
	}
}

export function logout() {
	pb.authStore.clear();
	console.log('👋 Logged out');
}

export function getCurrentUser() {
	return pb.authStore.model;
}
