import { browser } from '$app/environment';

const LAST_ACTIVITY_KEY = 'ccw_last_activity_at';

/** Default desktop inactivity re-lock: 30 minutes (overridable in Admin → Options). */
export const DEFAULT_DESKTOP_SESSION_IDLE_MINUTES = 30;

export function markSessionActivity(): void {
	if (!browser) return;
	sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function clearSessionActivity(): void {
	if (!browser) return;
	sessionStorage.removeItem(LAST_ACTIVITY_KEY);
}

export async function getDesktopSessionIdleMs(): Promise<number> {
	try {
		const { db } = await import('$lib/db');
		const opts = await db.options.get('1');
		const minutes = Number(opts?.desktopSecurityIdleMinutes);
		if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60) {
			return minutes * 60 * 1000;
		}
	} catch {
		// Dexie may be unavailable during teardown
	}
	return DEFAULT_DESKTOP_SESSION_IDLE_MINUTES * 60 * 1000;
}

/** True when desktop session has been inactive longer than the configured limit. */
export function isDesktopSessionExpired(idleMs: number): boolean {
	if (!browser) return false;
	const raw = sessionStorage.getItem(LAST_ACTIVITY_KEY);
	if (!raw) return false;
	const last = Number(raw);
	if (!Number.isFinite(last)) return false;
	return Date.now() - last >= idleMs;
}

/**
 * Track pointer/keyboard activity and poll for desktop inactivity re-lock.
 * Returns a teardown function (for tests).
 */
export function initDesktopSessionWatchers(onInactive: () => void | Promise<void>): () => void {
	if (!browser) return () => {};

	let throttleTimer: ReturnType<typeof setTimeout> | null = null;
	const onActivity = () => {
		if (throttleTimer) return;
		markSessionActivity();
		throttleTimer = setTimeout(() => {
			throttleTimer = null;
		}, 1000);
	};

	const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
	for (const eventName of events) {
		document.addEventListener(eventName, onActivity, { passive: true });
	}

	const interval = window.setInterval(() => {
		void (async () => {
			const { isQuickUnlockDevice } = await import('$lib/utils/device');
			if (isQuickUnlockDevice()) return;
			const idleMs = await getDesktopSessionIdleMs();
			if (isDesktopSessionExpired(idleMs)) {
				await onInactive();
			}
		})();
	}, 30_000);

	markSessionActivity();

	return () => {
		for (const eventName of events) {
			document.removeEventListener(eventName, onActivity);
		}
		window.clearInterval(interval);
		if (throttleTimer) clearTimeout(throttleTimer);
	};
}