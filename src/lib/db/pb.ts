// src/lib/pb.ts
import PocketBase from 'pocketbase';
import { db, processSyncQueue, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';
import { setCurrentUser } from '$lib/stores/auth.svelte';

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

		// )=- Find existing local Dexie record (for hybrid admin-created users that have local UUID + pbId).
		// Prefer by email (unique), then firstName/name guess, then by pbId.
		// This prevents duplicate records in Dexie when a locally-created crew (with local UUID id) later does email login.
		// For pure PB users (no prior local), we'll create with PB id as key.
		let existing = await db.users.where('email').equalsIgnoreCase(email).first();
		if (!existing) {
			const guess = email.split('@')[0];
			existing = await db.users.where('firstName').equalsIgnoreCase(guess).first()
				|| await db.users.where('name').equalsIgnoreCase(guess).first();
		}
		if (!existing && pbUser.id) {
			existing = await db.users.where('pbId').equals(pbUser.id).first();
		}

		let localUser: User;
		if (existing) {
			// Merge into existing local record (preserve local 'id' UUID for hybrid users, update pbId, sync fields from PB, prefer local pinHash if user has set it).
			localUser = {
				...existing,
				id: existing.id,  // keep local key
				pbId: pbUser.id,
				firstName: pbUser.firstName || existing.firstName || (pbUser.name ? pbUser.name.split(' ')[0] : email.split('@')[0] || 'Admin'),
				lastName: pbUser.lastName || existing.lastName || (pbUser.name ? pbUser.name.split(' ').slice(1).join(' ') : ''),
				name: pbUser.name || `${pbUser.firstName || existing.firstName || ''} ${pbUser.lastName || existing.lastName || ''}`.trim() || email.split('@')[0] || 'Admin',
				pinHash: existing.pinHash || pbUser.pinHash || '',
				role: pbUser.role || existing.role || 'admin',
				// )=- Prefer local data: URL photo (from camera upload in /profile) over PB file reference for offline <img src> support.
				// Only fall back to PB's photo value if no local data URL.
				photo: (existing.photo && existing.photo.startsWith('data:')) ? existing.photo : (pbUser.photo || existing.photo),
				active: pbUser.active ?? existing.active ?? true,
				forcePinUpdate: pbUser.forcePinUpdate ?? existing.forcePinUpdate ?? false,
				forcePhotoUpdate: pbUser.forcePhotoUpdate ?? existing.forcePhotoUpdate ?? false,
				verified: !!pbUser.verified,
				createdAt: new Date(pbUser.created || pbUser.createdAt || existing.createdAt),
				updatedAt: new Date(pbUser.updated || pbUser.updatedAt || existing.updatedAt),
			};
		} else {
			// Pure PB user: use PB id as Dexie key (original pattern)
			localUser = {
				id: pbUser.id,
				firstName: pbUser.firstName || (pbUser.name ? pbUser.name.split(' ')[0] : email.split('@')[0] || 'Admin'),
				lastName: pbUser.lastName || (pbUser.name ? pbUser.name.split(' ').slice(1).join(' ') : ''),
				name: pbUser.name || `${pbUser.firstName || ''} ${pbUser.lastName || ''}`.trim() || email.split('@')[0] || 'Admin',
				pinHash: pbUser.pinHash || '',
				role: pbUser.role || 'admin',
				photo: pbUser.photo ? pbUser.photo : undefined,
				active: pbUser.active ?? true,
				forcePinUpdate: pbUser.forcePinUpdate ?? false,
				forcePhotoUpdate: pbUser.forcePhotoUpdate ?? false,
				verified: !!pbUser.verified,
				createdAt: new Date(pbUser.created || pbUser.createdAt),
				updatedAt: new Date(pbUser.updated || pbUser.updatedAt),
			};
		}

		await db.users.put(localUser);
		setCurrentUser(localUser);
		console.log('✅ PB user synced to Dexie (merged if hybrid local record existed):', localUser.name);

		// )=- Cleanup any duplicate records with the same email but different Dexie key (the old loginWithEmail always-put-pb-id logic + prior admin creation could leave a local-UUID record and a PB-id record).
		// This cleans historical dups like the two Joe Poe in Dexie. UI loads also dedup now.
		const dups = await db.users.where('email').equalsIgnoreCase(email).toArray();
		for (const d of dups) {
			if (d.id !== localUser.id) {
				await db.users.delete(d.id!);
				console.log('🧹 Cleaned duplicate user record with same email', d.id);
			}
		}

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
export async function loginWithPin(firstName: string, pin: string) {
	try {
		// )=- Support first-name collisions for quick login: fetch candidates by firstName, then find the one whose PIN hash matches the entered PIN.
		// (PIN is the distinguisher; admin should ensure unique PINs per first name.)
		const candidates = await db.users.where('firstName').equalsIgnoreCase(firstName).toArray();
		let user = null;
		for (const c of candidates) {
			if (await bcrypt.compare(pin, c.pinHash)) {
				user = c;
				break;
			}
		}

		if (!user || !user.pinHash) {
			throw new Error('User not found or no PIN set');
		}

		// )=- Gate quick PIN only for users that have an email (validated creation) and verified flag.
		if (user.email && user.verified !== true) {
			throw new Error('Account not verified yet. Please login with email/password first to activate quick PIN access.');
		}

		if (!user.active) {
			throw new Error('Account is inactive');
		}

		setCurrentUser(user);

		// Pull latest data from server
		await pullClientsFromServer();
		await pullJobsFromServer();

		// Then push any pending local changes
		if (navigator.onLine) {
			await processSyncQueue();
		}

		console.log('✅ PIN login successful (offline + sync queue processed):', firstName);
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

  // )=- Debounce to prevent log spam and excessive server calls from repeated effect triggers.
  const now = Date.now();
  if (now - (pullJobsFromServer as any)._lastCall < 800) return;
  (pullJobsFromServer as any)._lastCall = now;

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
			// Only delete if this job was previously synced (has pbId) AND its pbId is no longer on the server
			if (localJob.pbId && !pbJobIds.has(localJob.pbId)) {
				await db.jobs.delete(localJob.id!);
				console.log(`🗑️ Removed stale job from Dexie: ${localJob.title}`);
			}
		}

		if (records.length > 0) {
			console.log(`✅ Pulled, merged, and cleaned ${records.length} jobs`);
		}
		// )=- Reduced log noise: only log when there are actual records. 0-job case was spamming console.
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
