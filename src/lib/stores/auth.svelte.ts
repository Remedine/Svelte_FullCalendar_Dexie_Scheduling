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

async function resolveSessionUser(
	db: typeof import('$lib/db').db,
	appSession: import('$lib/db').AppSession | undefined
): Promise<any | null> {
	const { readPersistedSessionUserId } = await import('$lib/db');
	const { buildUserFromAppSession } = await import('$lib/auth/sessionPersist');

	const savedId =
		localStorage.getItem('currentUserId') ||
		appSession?.currentUserId ||
		(await readPersistedSessionUserId());

	let user = savedId ? await db.users.get(savedId) : null;

	if (!user && appSession?.email) {
		user = await db.users.where('email').equalsIgnoreCase(appSession.email).first();
	}

	if (!user) {
		try {
			user = await resolveUserFromPbSession(db);
		} catch (pbErr) {
			console.warn('[auth] PB fallback during restore failed', pbErr);
		}
	}

	if (!user && appSession) {
		const rebuilt = buildUserFromAppSession(appSession);
		if (rebuilt?.id) {
			await db.users.put(rebuilt);
			user = rebuilt;
		}
	}

	return user;
}

async function completeSessionRestore(user: any, appSessionEmail?: string): Promise<boolean> {
	const { persistAppSession, syncAppSessionPbBackup } = await import('$lib/auth/sessionPersist');
	const { refreshPbAuthIfNeeded } = await import('$lib/db/pb');

	auth.currentUser = user;
	auth.isAuthenticated = true;

	if (user.id) {
		await persistAppSession({
			userId: String(user.id),
			email: user.email || appSessionEmail
		});
	}

	void refreshPbAuthIfNeeded().then(() => syncAppSessionPbBackup());
	await applyQuickUnlockIfNeeded(user.id);

	const { isQuickUnlockDevice } = await import('$lib/utils/device');
	if (!isQuickUnlockDevice()) {
		const { markSessionActivity } = await import('$lib/auth/sessionSecurity');
		markSessionActivity();
		return !(await enforceDesktopSessionIfExpired());
	}

	return true;
}

async function attemptRestoreSession(): Promise<boolean> {
	const { db } = await import('$lib/db');
	const { registerAuthRefreshOnVisibility } = await import('$lib/db/pb');
	const {
		clearAppSession,
		ensureDbOpen,
		hasRestorableSession,
		readAppSession,
		restorePbAuthFromAppSession,
		setLastLoginEmail
	} = await import('$lib/auth/sessionPersist');

	registerAuthRefreshOnVisibility();
	await ensureDbOpen();
	await restorePbAuthFromAppSession();

	const appSession = await readAppSession();
	const user = await resolveSessionUser(db, appSession);

	if (user && user.active !== false) {
		return completeSessionRestore(user, appSession?.email);
	}

	auth.currentUser = null;
	auth.isAuthenticated = false;
	auth.locked = false;

	const restorable = await hasRestorableSession();
	if (restorable) {
		if (appSession?.email) setLastLoginEmail(appSession.email);
		return false;
	}

	try {
		const { pb } = await import('$lib/db/pb');
		if (pb.authStore.isValid || pb.authStore.token) {
			pb.authStore.clear();
		}
		await clearAppSession();
		if (appSession?.email) {
			setLastLoginEmail(appSession.email);
		}
	} catch {
		await clearAppSession();
	}

	return false;
}

/** Restore session from Dexie + PocketBase (startup and PWA foreground retries). */
export async function restoreSession(opts: { retry?: boolean } = {}): Promise<boolean> {
	if (!opts.retry) {
		auth.loading = true;
	}

	const delays = opts.retry ? [0, 120, 350] : [0];
	let restored = false;

	for (const delay of delays) {
		if (delay > 0) {
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
		try {
			if (await attemptRestoreSession()) {
				restored = true;
				break;
			}
		} catch (e) {
			console.warn('[auth] restore attempt failed', e);
		}

		const { hasRestorableSession } = await import('$lib/auth/sessionPersist');
		if (!(await hasRestorableSession())) break;
	}

	if (!restored && !opts.retry) {
		auth.currentUser = null;
		auth.isAuthenticated = false;
		auth.locked = false;
	}

	if (!opts.retry) {
		auth.loading = false;
	}

	return restored;
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
		await expireSessionToLogin('expired');
		return true;
	} finally {
		desktopSessionExpiryInProgress = false;
	}
}

/** Sign out to login without wiping offline Dexie data; keeps last email for passkey. */
export async function expireSessionToLogin(
	reason: 'expired' | 'default' = 'default'
): Promise<void> {
	const email = auth.currentUser?.email;
	auth.currentUser = null;
	auth.isAuthenticated = false;
	auth.locked = false;

	try {
		const { pb } = await import('$lib/db/pb');
		pb.authStore.clear();
	} catch {}

	const { clearAppSession, setLastLoginEmail } = await import('$lib/auth/sessionPersist');
	const { clearSessionActivity } = await import('$lib/auth/sessionSecurity');
	clearSessionActivity();
	await clearAppSession();
	if (email) setLastLoginEmail(email);

	const { goto } = await import('$app/navigation');
	const query = reason === 'expired' ? '?session=expired' : '';
	goto(`/login${query}`, { replaceState: true });
}

export async function lockAppIfQuickUnlockEnabled(): Promise<void> {
	if (!auth.isAuthenticated || !auth.currentUser) return;
	const { isWithinFreshLoginGrace } = await import('$lib/auth/deviceUnlock');
	if (isWithinFreshLoginGrace()) return;
	await applyQuickUnlockIfNeeded(auth.currentUser.id);
}

export async function logout() {
	const rememberedEmail = auth.currentUser?.email;
	auth.currentUser = null;
	auth.isAuthenticated = false;
	auth.locked = false;
	void import('$lib/auth/sessionSecurity').then(({ clearSessionActivity }) => clearSessionActivity());
	void import('$lib/auth/sessionPersist').then(({ clearAppSession, setLastLoginEmail }) => {
		void clearAppSession().then(() => {
			if (rememberedEmail) setLastLoginEmail(rememberedEmail);
		});
	});

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
		void import('$lib/auth/sessionPersist').then(({ persistAppSession, syncAppSessionPbBackup }) => {
			void persistAppSession({ userId: String(user.id), email: user.email }).then(() =>
				syncAppSessionPbBackup()
			);
		});
	} else {
		void import('$lib/auth/sessionPersist').then(({ clearAppSession }) => clearAppSession());
	}
}

async function handleAppVisible(): Promise<void> {
	if (!auth.isAuthenticated) {
		const { hasRestorableSession } = await import('$lib/auth/sessionPersist');
		if (await hasRestorableSession()) {
			await restoreSession({ retry: true });
		}
	}

	if (!auth.isAuthenticated) return;

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

	window.addEventListener('pageshow', (event) => {
		if (event.persisted) {
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