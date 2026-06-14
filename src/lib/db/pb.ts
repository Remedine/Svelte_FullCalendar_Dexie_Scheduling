// src/lib/pb.ts
import PocketBase from 'pocketbase';
import { db, processSyncQueue, type User } from '$lib/db';
import { setCurrentUser } from '$lib/stores/auth.svelte';

// PocketBase client singleton
import { PUBLIC_POCKETBASE_URL } from '$env/static/public';
console.log('[DEBUG] PUBLIC_POCKETBASE_URL =', PUBLIC_POCKETBASE_URL);

// Fail fast in production if the required public env var is missing (prevents silent localhost fallback)
if (!PUBLIC_POCKETBASE_URL) {
	throw new Error(
		'PUBLIC_POCKETBASE_URL is not defined. ' +
		'This must be set at build time for the client bundle (e.g. via Railway shared variable PUBLIC_POCKETBASE_URL). ' +
		'Falling back to localhost is only for local dev.'
	);
}

export const pb = new PocketBase(PUBLIC_POCKETBASE_URL);

export function isAuthenticated(): boolean {
	return pb.authStore.isValid;
}

// Email Login
export async function loginWithEmail(email: string, password: string) {
	try {
		const normalizedEmail = (email || '').trim().toLowerCase();
		const authData = await pb.collection('users').authWithPassword(normalizedEmail, password);

		const pbUser = authData.record;

		// )=- Find existing local Dexie record (for hybrid admin-created users that have local UUID + pbId).
		// Prefer by email (unique), then firstName/name guess, then by pbId.
		// This prevents duplicate records in Dexie when a locally-created crew (with local UUID id) later does email login.
		// For pure PB users (no prior local), we'll create with PB id as key.
		let existing = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();
		if (!existing) {
			const guess = normalizedEmail.split('@')[0];
			existing =
				(await db.users.where('firstName').equalsIgnoreCase(guess).first()) ||
				(await db.users.where('name').equalsIgnoreCase(guess).first());
		}
		if (!existing && pbUser.id) {
			existing = await db.users.where('pbId').equals(pbUser.id).first();
		}

		let localUser: User;
		if (existing) {
			// Merge into existing local record (preserve local 'id' UUID for hybrid users, update pbId, sync fields from PB).
			// )=- pinHash/forcePinUpdate/verified kept only for backward compat with old Dexie data (PIN login removed).
			localUser = {
				...existing,
				id: existing.id, // keep local key
				pbId: pbUser.id,
				firstName:
					pbUser.firstName ||
					existing.firstName ||
					(pbUser.name ? pbUser.name.split(' ')[0] : email.split('@')[0] || 'Admin'),
				lastName:
					pbUser.lastName ||
					existing.lastName ||
					(pbUser.name ? pbUser.name.split(' ').slice(1).join(' ') : ''),
				name:
					pbUser.name ||
					`${pbUser.firstName || existing.firstName || ''} ${pbUser.lastName || existing.lastName || ''}`.trim() ||
					email.split('@')[0] ||
					'Admin',
				pinHash: existing.pinHash || pbUser.pinHash || '',
				role: pbUser.role || existing.role || 'admin',
				// )=- Prefer local data: URL photo (from camera upload in /profile) over PB file reference for offline <img src> support.
				// Only fall back to PB's photo value if no local data URL.
				photo:
					existing.photo && existing.photo.startsWith('data:')
						? existing.photo
						: pbUser.photo || existing.photo,
				active: pbUser.active ?? existing.active ?? true,
				forcePinUpdate: pbUser.forcePinUpdate ?? existing.forcePinUpdate ?? false,
				forcePhotoUpdate: pbUser.forcePhotoUpdate ?? existing.forcePhotoUpdate ?? false,
				// Preserve local "verified: false" marker from admin creation (hybrid local-UUID record).
				// This keeps the WelcomeModal (temp password → real password) + chained ForcePhoto gate working
				// even though we create the PB record with verified:true (required for authWithPassword to succeed).
				// The local flag is flipped to true only by the WelcomeModal success path (Dexie updateUser).
				verified: existing.verified === false ? false : !!pbUser.verified,
				createdAt: new Date(pbUser.created || pbUser.createdAt || existing.createdAt),
				updatedAt: new Date(pbUser.updated || pbUser.updatedAt || existing.updatedAt)
			};
		} else {
			// Pure PB user: use PB id as Dexie key (original pattern)
			localUser = {
				id: pbUser.id,
				firstName:
					pbUser.firstName ||
					(pbUser.name ? pbUser.name.split(' ')[0] : email.split('@')[0] || 'Admin'),
				lastName: pbUser.lastName || (pbUser.name ? pbUser.name.split(' ').slice(1).join(' ') : ''),
				name:
					pbUser.name ||
					`${pbUser.firstName || ''} ${pbUser.lastName || ''}`.trim() ||
					email.split('@')[0] ||
					'Admin',
				pinHash: pbUser.pinHash || '',
				role: pbUser.role || 'admin',
				photo: pbUser.photo ? pbUser.photo : undefined,
				active: pbUser.active ?? true,
				forcePinUpdate: pbUser.forcePinUpdate ?? false,
				forcePhotoUpdate: pbUser.forcePhotoUpdate ?? false,
				verified: !!pbUser.verified,
				createdAt: new Date(pbUser.created || pbUser.createdAt),
				updatedAt: new Date(pbUser.updated || pbUser.updatedAt)
			};
		}

		await db.users.put(localUser);
		setCurrentUser(localUser);
		console.log(
			'✅ PB user synced to Dexie (merged if hybrid local record existed):',
			localUser.name
		);

		// )=- Cleanup any duplicate records with the same email but different Dexie key (the old loginWithEmail always-put-pb-id logic + prior admin creation could leave a local-UUID record and a PB-id record).
		// This cleans historical dups like the two Joe Poe in Dexie. UI loads also dedup now.
		const dups = await db.users.where('email').equalsIgnoreCase(normalizedEmail).toArray();
		for (const d of dups) {
			if (d.id !== localUser.id) {
				await db.users.delete(d.id!);
				console.log('🧹 Cleaned duplicate user record with same email', d.id);
			}
		}

		// Pull latest data from server first
		await pullJobsFromServer();
		await pullClientsFromServer();
		await pullInvoicesFromServer();
		if (localUser.role === 'admin') {
			await pullUsersFromServer();
		}

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
			// Removed expand: 'client' because the clients collection's rules only allow superusers for expand access (causing "only superusers can view collection \"clients\" records").
			// We fall back to rec.client for the relation id anyway.
			// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
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

		// Additional dedup cleanup: remove any local-UUID record that has a pbId for which we now have the canonical
		// server record (id = pbId). These are the pre-sync local versions left behind by local create + pull.
		// The server record (with Dexie key = pbId) is the one we keep.
		for (const localJob of localJobs) {
			if (localJob.pbId && pbJobIds.has(localJob.pbId) && localJob.id !== localJob.pbId) {
				await db.jobs.delete(localJob.id!);
				console.log(`🗑️ Removed pre-sync local duplicate for job ${localJob.pbId} (title: ${localJob.title})`);
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

export async function pullInvoicesFromServer() {
	if (!pb.authStore.isValid) return;

	try {
		const PAGE_SIZE = 100;
		let page = 1;
		let totalPages = 1;
		const pbInvoiceIds = new Set<string>();
		let totalPulled = 0;
		let totalDeleted = 0;

		while (page <= totalPages) {
			const result = await pb.collection('invoices').getList(page, PAGE_SIZE, {
				// Use system 'updated' field for sort (always present and sortable on any collection).
				// The invoices collection created in PB may not have a custom 'updatedAt' field (unlike the users collection schema).
				// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
				sort: '-updated'
			});

			totalPages = result.totalPages;

			for (const rec of result.items) {
				pbInvoiceIds.add(rec.id);

				const existingLocal = await db.invoices.where('pbId').equals(rec.id).first();

				const serverInvoice = {
					id: existingLocal ? existingLocal.id : rec.id,
					pbId: rec.id,
					jobId: rec.job || rec.jobId,
					clientId: rec.client || rec.clientId,
					status: rec.status || 'draft',
					dueDate: rec.dueDate ? new Date(rec.dueDate) : new Date(),
					paidAt: rec.paidAt ? new Date(rec.paidAt) : undefined,
					amount: Number(rec.amount) || 0,
					billableItems: rec.billableItems || [],
					notes: rec.notes || '',
					importSource: rec.importSource || undefined,
					primaryInvoiceFile: rec.primaryInvoiceFile
						? { filename: rec.primaryInvoiceFile }
						: undefined,
					supportingDocuments: (rec.supportingDocuments || []).map((f: any) => ({
						filename: typeof f === 'string' ? f : f.filename
					})),
					createdAt: new Date(rec.created || rec.createdAt),
					updatedAt: new Date(rec.updated || rec.updatedAt)
				};

				const localInvoice = await db.invoices.get(serverInvoice.id);
				if (localInvoice && localInvoice.updatedAt > serverInvoice.updatedAt) {
					continue;
				}

				await db.invoices.put(serverInvoice);
				totalPulled++;
			}

			page++;
		}

		const localInvoices = await db.invoices.toArray();
		for (const localInvoice of localInvoices) {
			if (localInvoice.pbId && !pbInvoiceIds.has(localInvoice.pbId)) {
				await db.invoices.delete(localInvoice.id!);
				totalDeleted++;
			}
		}

		console.log(
			`✅ Pulled and merged ${totalPulled} invoices. Deleted ${totalDeleted} from Dexie.`
		);
	} catch (err) {
		console.error('❌ Pull invoices failed:', err);
	}
}

// Pull users from PocketBase (for admin management views like Crew).
// Only admins get the full roster pulled into Dexie (safety: regular crew logins intentionally stay minimal and only see self + their local data).
// We always do a best-effort self-sync from the auth token first so the current admin is fresh (photo, role, etc.).
// The full list attempt is best-effort; if the PB List rule on users blocks it we fall back to locally-known users (app-created ones are always in Dexie).
// pinHash (legacy) is only populated for the *current* logged-in admin record; others get '' . force* flags are kept for compat with old rows.
// Email/password is now the only authentication method (PIN login removed entirely).
// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

// Guard to avoid spamming the server on repeated reactive loads in Crew.
let rosterPullAttemptedThisSession = false;

export async function pullUsersFromServer(force = false) {
	if (!pb.authStore.isValid) return;

	if (!force && rosterPullAttemptedThisSession) return;
	rosterPullAttemptedThisSession = true;

	if ((pullUsersFromServer as any)._inFlight) return;
	(pullUsersFromServer as any)._inFlight = true;

	const currentAuth = pb.authStore.model;
	if (!currentAuth || currentAuth.role !== 'admin') {
		(pullUsersFromServer as any)._inFlight = false;
		return;
	}

	// Always ensure the currently authenticated admin is in Dexie with up-to-date server data.
	try {
		const existingSelf =
			(await db.users.where('pbId').equals(currentAuth.id).first()) ||
			(currentAuth.id ? await db.users.get(currentAuth.id) : null);

		const nameForSplit = currentAuth.name || '';
		const computedFirst = currentAuth.firstName || (nameForSplit ? nameForSplit.split(' ')[0] : '');
		const computedLast =
			currentAuth.lastName || (nameForSplit ? nameForSplit.split(' ').slice(1).join(' ') : '');

		const selfUser = {
			id: existingSelf?.id || currentAuth.id,
			pbId: currentAuth.id,
			firstName: computedFirst,
			lastName: computedLast,
			name:
				currentAuth.name ||
				`${computedFirst} ${computedLast}`.trim() ||
				(currentAuth.email ? currentAuth.email.split('@')[0] : 'Admin'),
			pinHash: currentAuth.id ? currentAuth.pinHash || existingSelf?.pinHash || '' : '',
			email: currentAuth.email || '',
			role: currentAuth.role || 'admin',
			photo:
				existingSelf?.photo && existingSelf.photo.startsWith('data:')
					? existingSelf.photo
					: currentAuth.photo || existingSelf?.photo,
			active: currentAuth.active ?? true,
			forcePinUpdate: existingSelf?.forcePinUpdate ?? currentAuth.forcePinUpdate ?? false,
			forcePhotoUpdate: currentAuth.forcePhotoUpdate ?? false,
			// For self (current admin) preserve local false marker if present (defensive).
			verified: existingSelf?.verified === false ? false : !!currentAuth.verified,
			createdAt: new Date(
				currentAuth.created || currentAuth.createdAt || existingSelf?.createdAt || Date.now()
			),
			updatedAt: new Date(
				currentAuth.updated || currentAuth.updatedAt || existingSelf?.updatedAt || Date.now()
			)
		};

		await db.users.put(selfUser);
	} catch (e) {
		console.warn('[pullUsers] Could not upsert current admin self into Dexie', e);
	}

	try {
		const PAGE_SIZE = 100;
		let page = 1;
		let totalPages = 1;
		const pbUserIds = new Set<string>();
		let pulled = 0;

		while (page <= totalPages) {
			const result = await pb.collection('users').getList(page, PAGE_SIZE, {
				sort: '-updatedAt',
				$autoCancel: false
			});

			totalPages = result.totalPages;

			for (const rec of result.items) {
				pbUserIds.add(rec.id);

				const existingLocal = await db.users.where('pbId').equals(rec.id).first();

				const serverUser = {
					id: existingLocal ? existingLocal.id : rec.id,
					pbId: rec.id,
					firstName: rec.firstName || '',
					lastName: rec.lastName || '',
					name: rec.name || `${rec.firstName || ''} ${rec.lastName || ''}`.trim(),
					pinHash: rec.id === currentAuth.id ? rec.pinHash || existingLocal?.pinHash || '' : '',
					email: rec.email || existingLocal?.email || '',
					role: rec.role || 'crew',
					photo: rec.photo || existingLocal?.photo || '',
					active: rec.active ?? true,
					forcePinUpdate: existingLocal?.forcePinUpdate ?? false,
					forcePhotoUpdate: rec.forcePhotoUpdate ?? false,
					// Preserve a local verified:false (from initial admin creation of a temp-password crew member)
					// so the first-login Welcome + ForcePhoto gates still trigger even after roster pulls.
					// PB record is created with verified:true for immediate auth; local flag is the onboarding signal.
					verified:
						existingLocal?.verified === false
							? false
							: typeof rec.verified === 'boolean'
								? rec.verified
								: (existingLocal?.verified ?? false),
					createdAt: new Date(rec.created || rec.createdAt),
					updatedAt: new Date(rec.updated || rec.updatedAt)
				};

				const localUser = await db.users.get(serverUser.id);
				if (localUser && localUser.updatedAt > serverUser.updatedAt) {
					continue;
				}

				await db.users.put(serverUser);
				pulled++;
			}

			page++;
		}

		const localUsers = await db.users.toArray();
		for (const lu of localUsers) {
			if (lu.pbId && !pbUserIds.has(lu.pbId)) {
				await db.users.delete(lu.id!);
				console.log(`🗑️ Removed stale user from Dexie: ${lu.name}`);
			}
		}

		if (pulled > 0) {
			console.log(`✅ Pulled ${pulled} users from PocketBase`);
		}
	} catch (err: any) {
		if (err?.status !== 0) {
			if (err?.status === 400 || err?.status === 403) {
				// List on the users collection is restricted by the PB List rule.
				// We already have the current user via the self-sync above.
			} else {
				console.error('❌ Pull users failed', err);
			}
		}
	} finally {
		(pullUsersFromServer as any)._inFlight = false;
	}
}

export function logout() {
	pb.authStore.clear();
	console.log('👋 Logged out');
}

export function getCurrentUser() {
	return pb.authStore.model;
}
