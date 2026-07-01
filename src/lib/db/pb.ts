// src/lib/pb.ts
import PocketBase from 'pocketbase';
import { db, processSyncQueue, type User } from '$lib/db';
import { normalizeTaxRateToPercent } from '$lib/utils/tax';
import { setCurrentUser } from '$lib/stores/auth.svelte';
import {
	buildUserFromPbRecord,
	canRunStaleUserDelete,
	cleanupDuplicateUsers,
	deleteDuplicateUserRows,
	findLocalUserForPbRecord,
	mergeAuthUserIntoLocal,
	mergeServerUserOverLocal,
	type PbUserRecord
} from '$lib/db/userSync';

// PocketBase client singleton
import { PUBLIC_POCKETBASE_URL } from '$env/static/public';
if (import.meta.env.DEV) {
	console.log('[DEBUG] PUBLIC_POCKETBASE_URL =', PUBLIC_POCKETBASE_URL);
}

// Fail fast in production if the required public env var is missing (prevents silent localhost fallback)
if (!PUBLIC_POCKETBASE_URL) {
	throw new Error(
		'PUBLIC_POCKETBASE_URL is not defined. ' +
		'This must be set at build time for the client bundle (e.g. via Railway shared variable PUBLIC_POCKETBASE_URL). ' +
		'Falling back to localhost is only for local dev.'
	);
}

export const pb = new PocketBase(PUBLIC_POCKETBASE_URL);

const AUTH_TIMEOUT_MS = 30_000;
const DEXIE_OP_TIMEOUT_MS = 8_000;

let visibilityRefreshBound = false;
let postLoginSyncInFlight: Promise<void> | null = null;

async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** Best-effort Dexie cleanup — never block login if IndexedDB is blocked (e.g. another tab). */
async function safeLoginUserDedup(keepId: string, opts: { pbId?: string; email?: string }): Promise<void> {
	try {
		await withTimeout(
			(async () => {
				await deleteDuplicateUserRows(keepId, opts);
				await cleanupDuplicateUsers();
			})(),
			DEXIE_OP_TIMEOUT_MS,
			'Local profile cleanup timed out'
		);
	} catch (err) {
		console.warn('[login] Skipping user dedup (non-fatal):', err);
	}
}

async function runPostLoginSync(localUser: User): Promise<void> {
	try {
		const { repairJobDateFields } = await import('$lib/db');
		await repairJobDateFields();
		await pullJobsFromServer();
		await pullClientsFromServer();
		await pullInvoicesFromServer();
		if (localUser.role === 'admin') {
			await pullUsersFromServer();
		}
		if (navigator.onLine) {
			await processSyncQueue();
		}

		const fresh = (await db.users.get(localUser.id!)) || localUser;
		setCurrentUser(fresh);
		console.log('✅ Background login sync complete');

		const { disconnectJobsRealtime, scheduleJobsRealtimeReconnect } = await import(
			'$lib/db/realtime'
		);
		disconnectJobsRealtime();
		scheduleJobsRealtimeReconnect(400);
	} catch (err) {
		console.warn('[login] Background sync failed (will retry on next page load):', err);
	}
}

function schedulePostLoginSync(localUser: User): void {
	if (postLoginSyncInFlight) return;
	postLoginSyncInFlight = runPostLoginSync(localUser).finally(() => {
		postLoginSyncInFlight = null;
	});
}

/** Force auth-refresh to sync role/active from PocketBase (e.g. after fresh staging boot). */
export async function syncPbAuthRecord(): Promise<PbUserRecord | null> {
	if (!pb.authStore.token || !navigator.onLine) return null;
	try {
		const data = await pb.collection('users').authRefresh();
		return (data?.record as PbUserRecord) ?? null;
	} catch (err) {
		console.warn('[auth] syncPbAuthRecord failed', err);
		return null;
	}
}

/** Refresh an expired JWT using the stored token (PocketBase auth-refresh). */
export async function refreshPbAuthIfNeeded(): Promise<boolean> {
	if (!pb.authStore.token) return false;
	if (pb.authStore.isValid) return true;
	if (!navigator.onLine) return false;

	try {
		await pb.collection('users').authRefresh();
		if (pb.authStore.isValid) {
			const { syncAppSessionPbBackup } = await import('$lib/auth/sessionPersist');
			await syncAppSessionPbBackup();
		}
		return pb.authStore.isValid;
	} catch (err) {
		console.warn('[auth] PocketBase token refresh failed', err);
		return false;
	}
}

/** Re-validate the PB session when the PWA returns to the foreground. */
export function registerAuthRefreshOnVisibility(): void {
	if (visibilityRefreshBound || typeof document === 'undefined') return;
	visibilityRefreshBound = true;

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState !== 'visible' || !navigator.onLine) return;
		void refreshPbAuthIfNeeded();
	});
}

export function isAuthenticated(): boolean {
	return pb.authStore.isValid;
}

/** Request a password-reset email via the app server (Brevo + PB internal token). */
export async function requestPasswordReset(email: string): Promise<void> {
	const normalizedEmail = (email || '').trim().toLowerCase();
	if (!normalizedEmail) {
		throw new Error('Email is required');
	}

	const res = await fetch('/api/auth/request-password-reset', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: normalizedEmail })
	});

	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data.error || 'Failed to send reset email');
	}
}

async function completeLoginFromPbRecord(
	pbUser: PbUserRecord,
	normalizedEmail: string,
	token: string
): Promise<{ authData: { record: PbUserRecord; token: string }; localUser: User }> {
	if (pbUser.active === false) {
		pb.authStore.clear();
		throw new Error('Your account has been deactivated. Please contact an administrator.');
	}

	pb.authStore.save(token, pbUser as Parameters<typeof pb.authStore.save>[1]);

	// Always refresh so role/active match the server (critical after fresh staging spin-up / boot promotion).
	try {
		const refreshed = await pb.collection('users').authRefresh();
		if (refreshed?.record) {
			pbUser = refreshed.record as PbUserRecord;
		}
	} catch (refreshErr) {
		console.warn('[auth] post-login authRefresh failed', refreshErr);
	}

	let existing = await findLocalUserForPbRecord({ ...pbUser, email: normalizedEmail });
	if (!existing) {
		const guess = normalizedEmail.split('@')[0];
		existing =
			(await db.users.where('firstName').equalsIgnoreCase(guess).first()) ||
			(await db.users.where('name').equalsIgnoreCase(guess).first());
	}

	const localUser = mergeAuthUserIntoLocal(pbUser, normalizedEmail, existing);
	await db.users.put(localUser);
	await safeLoginUserDedup(localUser.id!, {
		pbId: localUser.pbId,
		email: localUser.email
	});

	setCurrentUser(localUser);
	console.log('✅ PB user synced to Dexie:', localUser.name, 'pbId:', localUser.pbId);

	// Do not block the login UI on full roster sync — especially slow on mobile networks.
	schedulePostLoginSync(localUser);

	return { authData: { record: pbUser, token }, localUser };
}

// Email Login — returns merged Dexie user (PB is source of truth for auth fields).
export async function loginWithEmail(
	email: string,
	password: string
): Promise<{ authData: { record: PbUserRecord; token: string }; localUser: User }> {
	try {
		const normalizedEmail = (email || '').trim().toLowerCase();
		const authData = await withTimeout(
			pb.collection('users').authWithPassword(normalizedEmail, password),
			AUTH_TIMEOUT_MS,
			'Sign-in timed out. Check your connection and try again.'
		);
		return completeLoginFromPbRecord(
			authData.record as PbUserRecord,
			normalizedEmail,
			authData.token
		);
	} catch (err) {
		console.error('Email login failed:', err);
		throw err;
	}
}

/** Passkey / biometric login — returns merged Dexie user after WebAuthn verification. */
export async function loginWithPasskey(
	email: string
): Promise<{ authData: { record: PbUserRecord; token: string }; localUser: User }> {
	const { startAuthentication } = await import('@simplewebauthn/browser');
	const normalizedEmail = (email || '').trim().toLowerCase();
	if (!normalizedEmail) throw new Error('Email is required for passkey sign-in');

	const optionsRes = await fetch('/api/auth/webauthn/login/options', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: normalizedEmail })
	});
	if (!optionsRes.ok) {
		const data = await optionsRes.json().catch(() => ({}));
		throw new Error(data.error || 'Could not start passkey sign-in');
	}

	const { options, challengeToken } = await optionsRes.json();
	const assertion = await startAuthentication({ optionsJSON: options });

	const verifyRes = await fetch('/api/auth/webauthn/login/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email: normalizedEmail,
			response: assertion,
			challengeToken
		})
	});

	if (!verifyRes.ok) {
		const data = await verifyRes.json().catch(() => ({}));
		throw new Error(data.error || 'Passkey sign-in failed');
	}

	const { token, record } = await verifyRes.json();
	return completeLoginFromPbRecord(record as PbUserRecord, normalizedEmail, token);
}

// )=- Batch A (PLAN.md): normalize updatedAt for last-write-wins merge (Date vs ISO string).
function timestampMs(value: Date | string | number | undefined): number {
	if (value == null) return 0;
	if (value instanceof Date) return value.getTime();
	const n = new Date(value).getTime();
	return Number.isNaN(n) ? 0 : n;
}

/** Merge one PocketBase job record into Dexie with updatedAt conflict check. */
export async function applyServerJobRecord(rec: any): Promise<'applied' | 'skipped'> {
	const existingLocal = await db.jobs.where('pbId').equals(rec.id).first();

	const serverJob = {
		id: existingLocal ? existingLocal.id : rec.id,
		pbId: rec.id,
		clientId: rec.expand?.client?.id || rec.client,
		title: rec.title,
		start: new Date(rec.start),
		end: new Date(rec.end),
		assignedCrew: rec.assignedCrew || [],
		status: rec.status,
		billableItems: rec.billableItems || [],
		subtotal: rec.subtotal || 0,
		taxRate: normalizeTaxRateToPercent(rec.taxRate, 8),
		taxAmount: rec.taxAmount || 0,
		totalAmount: rec.totalAmount || 0,
		areaOfTown: rec.areaOfTown,
		notes: rec.notes,
		cancelReason: rec.cancelReason,
		cancelNotes: rec.cancelNotes,
		cancelledAt: rec.cancelledAt ? new Date(rec.cancelledAt) : undefined,
		cancelledBy: rec.cancelledBy,
		importSource: rec.importSource || undefined,
		// Jobs collection uses custom createdAt/updatedAt autodate fields (not system created/updated).
		createdAt: new Date(rec.createdAt || rec.created),
		updatedAt: new Date(rec.updatedAt || rec.updated)
	};

	const localJob = await db.jobs.get(serverJob.id);

	if (localJob && timestampMs(localJob.updatedAt) > timestampMs(serverJob.updatedAt)) {
		return 'skipped';
	}

	await db.jobs.put(serverJob);
	return 'applied';
}

// Pull jobs from PocketBase (with conflict resolution)
export async function pullJobsFromServer() {
	if (!pb.authStore.isValid) return;

	// )=- Debounce to prevent log spam and excessive server calls from repeated effect triggers.
	const now = Date.now();
	if (now - (pullJobsFromServer as any)._lastCall < 800) return;
	(pullJobsFromServer as any)._lastCall = now;

	const PAGE_SIZE = 100;
	let page = 1;
	let totalPages = 1;
	let totalPulled = 0;
	let totalDeleted = 0;

	try {
		const pbJobIds = new Set<string>();

		while (page <= totalPages) {
			const result = await pb.collection('jobs').getList(page, PAGE_SIZE, {
				// )=- Jobs schema has updatedAt (custom autodate), not sortable as -updated — caused 400 after Batch A pagination.
				sort: '-updatedAt',
				$autoCancel: false
			});

			totalPages = result.totalPages;

			for (const rec of result.items) {
				pbJobIds.add(rec.id);
				const outcome = await applyServerJobRecord(rec);
				if (outcome === 'applied') totalPulled++;
			}

			page++;
		}

		if (pbJobIds.size > 0) {
			const localJobs = await db.jobs.toArray();
			for (const localJob of localJobs) {
				if (localJob.pbId && !pbJobIds.has(localJob.pbId)) {
					await db.jobs.delete(localJob.id!);
					totalDeleted++;
					console.log(`🗑️ Removed stale job from Dexie: ${localJob.title}`);
				}
			}
		} else {
			console.warn('[pullJobs] Skipping stale delete — empty PocketBase job roster');
		}

		const { cleanupDuplicateJobs } = await import('$lib/db');
		const dupesRemoved = await cleanupDuplicateJobs();

		if (totalPulled > 0 || totalDeleted > 0 || dupesRemoved > 0) {
			console.log(
				`✅ Pulled ${totalPulled} jobs, deleted ${totalDeleted} stale, removed ${dupesRemoved} duplicate row(s)`
			);
		}
	} catch (err: any) {
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
					useBillingAddress: !!rec.useBillingAddress,
					billingAddressStreet: rec.billingAddressStreet || '',
					billingAddressCity: rec.billingAddressCity || '',
					billingAddressState: rec.billingAddressState || '',
					billingAddressZip: rec.billingAddressZip || '',
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

		if (pbClientIds.size > 0) {
			const localClients = await db.clients.toArray();
			for (const localClient of localClients) {
				if (localClient.pbId && !pbClientIds.has(localClient.pbId)) {
					await db.clients.delete(localClient.id!);
					totalDeleted++;
					console.log(`🗑️ Deleted client from Dexie (no longer in PB): ${localClient.name}`);
				}
			}
		} else {
			console.warn('[pullClients] Skipping stale delete — empty PocketBase client roster');
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
					subtotal: rec.subtotal != null ? Number(rec.subtotal) : undefined,
					taxAmount: rec.taxAmount != null ? Number(rec.taxAmount) : undefined,
					billableItems: rec.billableItems || [],
					clientSnapshot: rec.clientSnapshot || undefined,
					invoiceDiscount: rec.invoiceDiscount || undefined,
					invoiceDate: rec.invoiceDate ? new Date(rec.invoiceDate) : undefined,
					version: rec.version != null ? Number(rec.version) : undefined,
					lastGeneratedAt: rec.lastGeneratedAt ? new Date(rec.lastGeneratedAt) : undefined,
					notes: rec.notes || '',
					invoiceNumber: rec.invoiceNumber || undefined,
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

/** Admin-only: fetch full roster (with emails) via Svelte server + internal PB secret. */
async function fetchAdminRosterFromServer(): Promise<{
	items: PbUserRecord[];
	totalItems: number;
} | null> {
	if (!navigator.onLine || !pb.authStore.isValid || !pb.authStore.token) return null;
	try {
		const res = await fetch('/api/admin/users-roster', {
			headers: { Authorization: pb.authStore.token }
		});
		if (!res.ok) {
			console.warn('[pullUsers] Admin roster API failed:', res.status);
			return null;
		}
		const data = await res.json();
		return {
			items: (data.items || []) as PbUserRecord[],
			totalItems: data.totalItems ?? data.items?.length ?? 0
		};
	} catch (e) {
		console.warn('[pullUsers] Admin roster API error:', e);
		return null;
	}
}

async function mergeRosterItemsIntoDexie(
	items: PbUserRecord[],
	currentAuthId: string
): Promise<{ pbUserIds: Set<string>; pulled: number }> {
	const pbUserIds = new Set<string>();
	let pulled = 0;

	for (const rec of items) {
		pbUserIds.add(rec.id);

		const existingLocal = await findLocalUserForPbRecord(rec);
		const serverUser = buildUserFromPbRecord(rec, existingLocal, {
			isCurrentAuth: rec.id === currentAuthId,
			authEmail: rec.id === currentAuthId ? pb.authStore.model?.email : undefined
		});

		const localUser = await db.users.get(serverUser.id!);
		const merged = mergeServerUserOverLocal(localUser, serverUser);
		const hadEmail = !!(localUser?.email || '').trim();
		const hasEmail = !!(merged.email || '').trim();

		await db.users.put(merged);
		pulled++;

		if (!hadEmail && hasEmail) {
			console.log(`📧 Patched email for ${merged.name}: ${merged.email}`);
		}
	}

	return { pbUserIds, pulled };
}

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
		const existingSelf = await findLocalUserForPbRecord(currentAuth as PbUserRecord);
		const selfUser = buildUserFromPbRecord(currentAuth as PbUserRecord, existingSelf, {
			isCurrentAuth: true,
			authEmail: currentAuth.email
		});

		await db.users.put(selfUser);
	} catch (e) {
		console.warn('[pullUsers] Could not upsert current admin self into Dexie', e);
	}

	let serverTotalItems = 0;

	try {
		const pbUserIds = new Set<string>();
		let pulled = 0;

		const adminRoster = await fetchAdminRosterFromServer();
		if (adminRoster && adminRoster.items.length > 0) {
			serverTotalItems = adminRoster.totalItems;
			const merged = await mergeRosterItemsIntoDexie(adminRoster.items, currentAuth.id);
			merged.pbUserIds.forEach((id) => pbUserIds.add(id));
			pulled = merged.pulled;
			console.log(`✅ Pulled ${pulled} users via admin roster API (emails included)`);
		} else {
			const PAGE_SIZE = 100;
			let page = 1;
			let totalPages = 1;

			while (page <= totalPages) {
				const result = await pb.collection('users').getList(page, PAGE_SIZE, {
					sort: '-updatedAt',
					$autoCancel: false
				});

				totalPages = result.totalPages;
				serverTotalItems = result.totalItems;

				const merged = await mergeRosterItemsIntoDexie(
					result.items as PbUserRecord[],
					currentAuth.id
				);
				merged.pbUserIds.forEach((id) => pbUserIds.add(id));
				pulled += merged.pulled;

				page++;
			}
		}

		if (canRunStaleUserDelete(pbUserIds, serverTotalItems)) {
			const localUsers = await db.users.toArray();
			for (const lu of localUsers) {
				if (!lu.pbId || lu.pbId === currentAuth.id) continue;
				if (!pbUserIds.has(lu.pbId)) {
					await db.users.delete(lu.id!);
					console.log(`🗑️ Removed stale user from Dexie: ${lu.name}`);
				}
			}
		} else {
			console.warn(
				`[pullUsers] Skipping stale delete — roster incomplete (pulled ${pbUserIds.size}/${serverTotalItems} PB ids)`
			);
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
	import('$lib/db/realtime').then(({ disconnectJobsRealtime }) => disconnectJobsRealtime());
	pb.authStore.clear();
	console.log('👋 Logged out');
}

export function getCurrentUser() {
	return pb.authStore.model;
}