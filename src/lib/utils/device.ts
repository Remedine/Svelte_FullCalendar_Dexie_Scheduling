import { browser } from '$app/environment';

/** Matches the app layout mobile breakpoint (bottom tab bar). */
export const MOBILE_MAX_WIDTH_PX = 768;

/** True on viewports that use the mobile shell (quick unlock / PIN layer). */
export function isMobileViewport(): boolean {
	if (!browser || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
}

/** Mobile idle timer (background re-lock); desktop uses desktopSecurityIdleMinutes instead. */
export function isQuickUnlockDevice(): boolean {
	return isMobileViewport();
}