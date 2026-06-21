// src/lib/stores/auth.svelte.ts
import { browser } from '$app/environment';

export const auth = $state({
	currentUser: null as any,
	isAuthenticated: false,
	loading: true
});

async function resolveUserFromPbSession(db: typeof import('$lib/db').db): Promise<any | null> {
	const { pb, refreshPbAuthIfNeeded } = await import('$lib/db/pb');

	if (!pb.authStore.token) return null;

	await refreshPbAuthIfNeeded();

	const m = pb.authStore.model;
	if (!m?.id && !m?.email) return null;

	let user =
		(m.id && (await db.users.where('pbId').equals(m.id).first())) ||
		(m.id && (await db.users.get(m.id))) ||
		null;

	if (!user && m.email) {
		user = await db.users.where('email').equalsIgnoreCase(m.email).first();
	}

	if (!user && m) {
		user = {
			id: m.id,
			pbId: m.id,
			email: m.email || '',
			name: m.name || '',
			firstName: m.firstName || '',
			lastName: m.lastName || '',
			role: m.role || 'crew',
			active: m.active ?? true,
			verified: !!m.verified,
			forcePhotoUpdate: !!m.forcePhotoUpdate,
			photo: m.photo || undefined,
			createdAt: new Date(m.created || Date.now()),
			updatedAt: new Date(m.updated || Date.now())
		};
		await db.users.put(user);
	}

	return user;
}

/** Restore session from Dexie + PocketBase (called once on client startup). */
export async function restoreSession(): Promise<void> {
	let user: any = null;

	try {
		const { db, persistSessionUserId, readPersistedSessionUserId } = await import('$lib/db');
		const { refreshPbAuthIfNeeded, registerAuthRefreshOnVisibility } = await import('$lib/db/pb');

		registerAuthRefreshOnVisibility();

		const savedId =
			localStorage.getItem('currentUserId') || (await readPersistedSessionUserId());

		if (savedId) {
			user = await db.users.get(savedId);
		}

		if (!user) {
			try {
				user = await resolveUserFromPbSession(db);
			} catch (pbErr) {
				console.warn('[auth] PB fallback during restore failed', pbErr);
			}
		}

		if (user && user.active !== false) {
			auth.currentUser = user;
			auth.isAuthenticated = true;

			if (user.id) {
				const id = String(user.id);
				localStorage.setItem('currentUserId', id);
				await persistSessionUserId(id);
			}

			// Keep API/realtime working after a cold PWA open with an expired JWT.
			void refreshPbAuthIfNeeded();
		} else {
			auth.currentUser = null;
			auth.isAuthenticated = false;

			try {
				const { pb } = await import('$lib/db/pb');
				if (pb.authStore.isValid) {
					pb.authStore.clear();
				}
				localStorage.removeItem('currentUserId');
				await persistSessionUserId(null);
			} catch {
				localStorage.removeItem('currentUserId');
			}
		}
	} catch (e) {
		console.warn('[auth] restore failed', e);
		auth.currentUser = null;
		auth.isAuthenticated = false;
	} finally {
		auth.loading = false;
	}
}

export async function logout() {
	// )=- Unified logout: clears central store (used by UI/guards) + localStorage.
	// Also clears PocketBase authStore and wipes local Dexie data (jobs, clients, invoices, queue).
	auth.currentUser = null;
	auth.isAuthenticated = false;
	localStorage.removeItem('currentUserId');

	try {
		const { disconnectJobsRealtime } = await import('$lib/db/realtime');
		disconnectJobsRealtime();
		const { pb } = await import('$lib/db/pb');
		pb.authStore.clear();
	} catch {}

	try {
		const { db, processSyncQueue, persistSessionUserId } = await import('$lib/db');
		if (navigator.onLine) {
			try {
				await processSyncQueue();
			} catch (syncErr) {
				console.warn('[auth] Sync flush before logout failed', syncErr);
			}
		}
		const pending = await db.syncQueue.count();
		if (pending > 0) {
			console.warn(
				`[auth] Logging out with ${pending} unsynced queue item(s) — local data will still be cleared`
			);
		}
		await db.delete();
		await db.open();
		await persistSessionUserId(null);
	} catch (err) {
		console.warn('[auth] Failed to clear local Dexie data on logout', err);
	}
}

export function setCurrentUser(user: any | null) {
	auth.currentUser = user;
	auth.isAuthenticated = !!user;

	if (user?.id) {
		const id = user.id.toString();
		localStorage.setItem('currentUserId', id);
		void import('$lib/db').then(({ persistSessionUserId }) => persistSessionUserId(id));
	} else {
		localStorage.removeItem('currentUserId');
		void import('$lib/db').then(({ persistSessionUserId }) => persistSessionUserId(null));
	}
}

// Auto-restore session (robust to Dexie dedup/cleanup and hybrid PB/local records).
// On hard refresh of protected pages (e.g. /calendar) the previous logic could fail to
// find the exact savedId after pullUsersFromServer / cleanupDuplicateUsers deleted a
// duplicate record, causing loading=false + !authenticated → unwanted redirect to login.
if (browser) {
	void restoreSession();
} else {
	auth.loading = false;
	auth.isAuthenticated = false;
}