import { browser } from '$app/environment';

/** Matches the app layout mobile breakpoint (bottom tab bar / portrait phones). */
export const MOBILE_MAX_WIDTH_PX = 768;

/**
 * Phone landscape uses width > 768 on many devices (e.g. iPhone landscape ~844px).
 * Treat short landscape viewports as mobile so rotate keeps the mobile shell + calendar gestures.
 */
export const MOBILE_LANDSCAPE_MAX_HEIGHT_PX = 500;

/** Shared CSS/JS media query: portrait phone OR short landscape phone. */
export function mobileViewportMediaQuery(): string {
	return `(max-width: ${MOBILE_MAX_WIDTH_PX}px), (orientation: landscape) and (max-height: ${MOBILE_LANDSCAPE_MAX_HEIGHT_PX}px)`;
}

/** True on viewports that use the mobile shell (quick unlock / PIN layer / bottom tabs). */
export function isMobileViewport(): boolean {
	if (!browser || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia(mobileViewportMediaQuery()).matches;
}

/** Mobile calendar in landscape: show multi-day time grid instead of single day. */
export function isMobileLandscapeViewport(): boolean {
	if (!browser || typeof window.matchMedia !== 'function') return false;
	return isMobileViewport() && window.matchMedia('(orientation: landscape)').matches;
}

/** Mobile idle timer (background re-lock); desktop uses desktopSecurityIdleMinutes instead. */
export function isQuickUnlockDevice(): boolean {
	return isMobileViewport();
}
