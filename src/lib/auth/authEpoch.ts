import { browser } from '$app/environment';

export const AUTH_EPOCH_STORAGE_KEY = 'ccw_auth_epoch';

export function getLocalAuthEpoch(): number {
	if (!browser) return 0;
	const raw = localStorage.getItem(AUTH_EPOCH_STORAGE_KEY);
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function setLocalAuthEpoch(epoch: number): void {
	if (!browser) return;
	const safe = Number.isFinite(epoch) && epoch >= 0 ? Math.floor(epoch) : 0;
	localStorage.setItem(AUTH_EPOCH_STORAGE_KEY, String(safe));
}

export async function fetchServerAuthEpoch(): Promise<number | null> {
	if (!browser || !navigator.onLine) return null;
	try {
		const res = await fetch('/api/auth/epoch', { cache: 'no-store' });
		if (!res.ok) return null;
		const data = await res.json();
		const epoch = Number(data?.authEpoch);
		return Number.isFinite(epoch) && epoch >= 0 ? epoch : 0;
	} catch {
		return null;
	}
}

/**
 * After a backup restore the server bumps authEpoch. Any device whose local epoch
 * is behind must wipe local CRM data and re-login (even on cold start before
 * session flags are set — otherwise we advance local epoch and keep stale data).
 */
export async function checkAuthEpochAndForceLogoutIfNeeded(): Promise<boolean> {
	if (!browser || !navigator.onLine) return false;

	const serverEpoch = await fetchServerAuthEpoch();
	if (serverEpoch == null || serverEpoch <= 0) return false;

	const localEpoch = getLocalAuthEpoch();
	if (serverEpoch <= localEpoch) return false;

	console.info(
		`[auth] Server auth epoch ${serverEpoch} > local ${localEpoch} — forcing app logout after restore`
	);

	const { logout } = await import('$lib/stores/auth.svelte');
	// Discard queue: post-restore local mutations must not push into rolled-back server data.
	await logout({ discardQueue: true });
	// Advance local epoch only after wipe so a failed wipe does not skip future checks.
	setLocalAuthEpoch(serverEpoch);

	const { goto } = await import('$app/navigation');
	goto('/login?session=restored', { replaceState: true });
	return true;
}

export async function syncAuthEpochFromServer(): Promise<void> {
	const serverEpoch = await fetchServerAuthEpoch();
	if (serverEpoch != null) {
		setLocalAuthEpoch(serverEpoch);
	}
}