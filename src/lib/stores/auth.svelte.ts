// src/lib/stores/auth.svelte.ts
import { browser } from '$app/environment';

let desktopSessionExpiryInProgress = false;

export const auth = $state({
	currentUser: null as any,
	isAuthenticated: false,
	loading: true,
	/** Quick-unlock gate: session restored but UI locked until PIN/biometric. */
	locked: false
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

async function applyQuickUnlockIfNeeded(userId: string | null | undefined): Promise<void> {
	try {
		const { shouldRequireUnlock } = await import('$lib/auth/deviceUnlock');
		auth.locked = await shouldRequireUnlock(userId);
	} catch {
		auth.locked = false;
	}
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

			void refreshPbAuthIfNeeded();
			await applyQuickUnlockIfNeeded(user.id);
			const { isQuickUnlockDevice } = await import('$lib/utils/device');
			if (!isQuickUnlockDevice()) {
				const { markSessionActivity } = await import('$lib/auth/sessionSecurity');
				markSessionActivity();
				if (await enforceDesktopSessionIfExpired()) return;
			}
		} else {
			auth.currentUser = null;
			auth.isAuthenticated = false;
			auth.locked = false;

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
		auth.locked = false;
	} finally {
		auth.loading = false;
	}
}

export function unlockApp(): void {
	auth.locked = false;
	void import('$lib/auth/deviceUnlock').then(({ clearAppHidden }) => clearAppHidden());
	void import('$lib/auth/sessionSecurity').then(({ markSessionActivity }) => markSessionActivity());
}

export async function enforceDesktopSessionIfExpired(): Promise<boolean> {
	if (desktopSessionExpiryInProgress) return false;
	const { isQuickUnlockDevice } = await import('$lib/utils/device');
	if (isQuickUnlockDevice()) return false;
	if (!auth.isAuthenticated || !auth.currentUser) return false;

	const {
		getDesktopSessionIdleMs,
		isDesktopSessionExpired
	} = await import('$lib/auth/sessionSecurity');
	const idleMs = await getDesktopSessionIdleMs();
	if (!isDesktopSessionExpired(idleMs)) return false;

	desktopSessionExpiryInProgress = true;
	try {
		await logout();
		const { goto } = await import('$app/navigation');
		goto('/login?session=expired', { replaceState: true });
		return true;
	} finally {
		desktopSessionExpiryInProgress = false;
	}
}

export async function lockAppIfQuickUnlockEnabled(): Promise<void> {
	if (!auth.isAuthenticated || !auth.currentUser) return;
	const { isWithinFreshLoginGrace } = await import('$lib/auth/deviceUnlock');
	if (isWithinFreshLoginGrace()) return;
	await applyQuickUnlockIfNeeded(auth.currentUser.id);
}

export async function logout() {
	auth.currentUser = null;
	auth.isAuthenticated = false;
	auth.locked = false;
	localStorage.removeItem('currentUserId');
	void import('$lib/auth/sessionSecurity').then(({ clearSessionActivity }) => clearSessionActivity());

	try {
		const { disconnectJobsRealtime } = await import('$lib/db/realtime');
		disconnectJobsRealtime();
		const { pb } = await import('$lib/db/pb');
		pb.authStore.clear();
	} catch {}

	try {
		const { db, processSyncQueue, persistSessionUserId } = await import('$lib/db');
		const { snapshotDeviceAuth, restoreDeviceAuth } = await import('$lib/auth/deviceUnlock');
		const deviceAuthSnapshot = await snapshotDeviceAuth();
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
		await restoreDeviceAuth(deviceAuthSnapshot);
		await persistSessionUserId(null);
	} catch (err) {
		console.warn('[auth] Failed to clear local Dexie data on logout', err);
	}
}

export function setCurrentUser(user: any | null) {
	auth.currentUser = user;
	auth.isAuthenticated = !!user;
	auth.locked = false;

	if (user?.id) {
		void import('$lib/auth/deviceUnlock').then(({ ensureDeviceAuthMatchesUser, markFreshLogin }) => {
			markFreshLogin();
			ensureDeviceAuthMatchesUser(String(user.id));
		});
		void import('$lib/auth/sessionSecurity').then(({ markSessionActivity }) => markSessionActivity());
		const id = user.id.toString();
		localStorage.setItem('currentUserId', id);
		void import('$lib/db').then(({ persistSessionUserId }) => persistSessionUserId(id));
	} else {
		localStorage.removeItem('currentUserId');
		void import('$lib/db').then(({ persistSessionUserId }) => persistSessionUserId(null));
	}
}

async function handleAppVisible(): Promise<void> {
	const { isQuickUnlockDevice } = await import('$lib/utils/device');
	if (isQuickUnlockDevice()) {
		const { shouldLockAfterReturn, clearAppHidden, getIdleLockMs } = await import(
			'$lib/auth/deviceUnlock'
		);
		const idleMs = await getIdleLockMs();
		if (shouldLockAfterReturn(idleMs)) {
			await lockAppIfQuickUnlockEnabled();
		}
		clearAppHidden();
		return;
	}

	if (await enforceDesktopSessionIfExpired()) return;
	const { markSessionActivity } = await import('$lib/auth/sessionSecurity');
	markSessionActivity();
}

if (browser) {
	void restoreSession();

	// Mobile: quick-unlock after background idle. Desktop: inactivity session timeout.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			void import('$lib/auth/deviceUnlock').then(({ markAppHidden }) => markAppHidden());
		} else if (document.visibilityState === 'visible') {
			void handleAppVisible();
		}
	});

	void import('$lib/auth/sessionSecurity').then(({ initDesktopSessionWatchers }) => {
		initDesktopSessionWatchers(() => enforceDesktopSessionIfExpired());
	});
} else {
	auth.loading = false;
	auth.isAuthenticated = false;
	auth.locked = false;
}