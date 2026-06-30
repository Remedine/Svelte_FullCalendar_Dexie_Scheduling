import { browser } from '$app/environment';
import type { AppSession, User } from '$lib/db';

const LAST_LOGIN_EMAIL_KEY = 'ccw_last_login_email';

export function getLastLoginEmail(): string {
	if (!browser) return '';
	return (localStorage.getItem(LAST_LOGIN_EMAIL_KEY) || '').trim().toLowerCase();
}

export function setLastLoginEmail(email: string | null | undefined): void {
	if (!browser) return;
	const normalized = (email || '').trim().toLowerCase();
	if (normalized) {
		localStorage.setItem(LAST_LOGIN_EMAIL_KEY, normalized);
	}
}

export async function ensureDbOpen(): Promise<void> {
	const { db } = await import('$lib/db');
	if (!db.isOpen()) {
		await db.open();
	}
}

export async function readAppSession(): Promise<AppSession | undefined> {
	await ensureDbOpen();
	const { db } = await import('$lib/db');
	return (await db.appSession.get('current')) || undefined;
}

export function parsePbModelFromAppSession(row: AppSession): Record<string, unknown> | null {
	if (!row.pbModelJson) return null;
	try {
		return JSON.parse(row.pbModelJson) as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** Rebuild a Dexie user from durable appSession backup when the users row is temporarily missing. */
export function buildUserFromAppSession(row: AppSession): User | null {
	const model = parsePbModelFromAppSession(row);
	const email = (row.email || (model?.email as string) || '').trim().toLowerCase();
	const id = row.currentUserId || (model?.id as string);
	if (!id && !email) return null;

	const name =
		(model?.name as string) ||
		[model?.firstName, model?.lastName].filter(Boolean).join(' ').trim() ||
		email.split('@')[0] ||
		'Crew';

	return {
		id,
		pbId: (model?.id as string) || id,
		email: email || undefined,
		name,
		firstName: (model?.firstName as string) || undefined,
		lastName: (model?.lastName as string) || undefined,
		role: (model?.role as User['role']) || 'crew',
		active: model?.active !== false,
		verified: !!model?.verified,
		forcePhotoUpdate: !!model?.forcePhotoUpdate,
		photo: (model?.photo as string) || undefined,
		pinHash: '',
		forcePinUpdate: false,
		createdAt: new Date(),
		updatedAt: new Date()
	};
}

export async function hasRestorableSession(): Promise<boolean> {
	if (!browser) return false;
	if (localStorage.getItem('currentUserId')) return true;
	const row = await readAppSession().catch(() => undefined);
	return !!(row?.currentUserId || row?.pbToken);
}

export async function persistAppSession(opts: {
	userId: string;
	email?: string | null;
}): Promise<void> {
	if (!browser) return;

	const userId = String(opts.userId);
	const email = (opts.email || '').trim().toLowerCase();
	setLastLoginEmail(email);
	localStorage.setItem('currentUserId', userId);

	await ensureDbOpen();
	const { db } = await import('$lib/db');
	const { pb } = await import('$lib/db/pb');

	const row: AppSession = {
		id: 'current',
		currentUserId: userId,
		email: email || undefined,
		pbToken: pb.authStore.token || undefined,
		pbModelJson: pb.authStore.model ? JSON.stringify(pb.authStore.model) : undefined
	};

	await db.appSession.put(row);
}

/** Clears signed-in markers but keeps last login email for the login form / passkey. */
export async function clearAppSession(): Promise<void> {
	if (!browser) return;
	localStorage.removeItem('currentUserId');
	const { db } = await import('$lib/db');
	await db.appSession.delete('current').catch(() => {});
}

/**
 * Restore PocketBase auth from IndexedDB when localStorage was evicted (common on iOS PWAs).
 * Returns true when a usable PB session is available afterward.
 */
export async function restorePbAuthFromAppSession(): Promise<boolean> {
	const { pb } = await import('$lib/db/pb');
	if (pb.authStore.isValid) return true;

	const row = await readAppSession();
	if (!row?.pbToken || !row.pbModelJson) return false;

	try {
		const model = JSON.parse(row.pbModelJson);
		pb.authStore.save(row.pbToken, model);
	} catch {
		return false;
	}

	if (pb.authStore.isValid) return true;
	if (!navigator.onLine) return !!pb.authStore.token;

	try {
		await pb.collection('users').authRefresh();
	} catch {
		// Offline or expired — local Dexie session can still restore UI; refresh retries later.
	}

	return !!pb.authStore.token;
}

export async function syncAppSessionPbBackup(): Promise<void> {
	const row = await readAppSession();
	if (!row?.currentUserId) return;

	const { pb } = await import('$lib/db/pb');
	if (!pb.authStore.token) return;

	await persistAppSession({
		userId: row.currentUserId,
		email: row.email || pb.authStore.model?.email
	});
}