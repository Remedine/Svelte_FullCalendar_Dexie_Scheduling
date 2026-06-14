/**
 * Color utilities for the design system.
 * 
 * Primarily for adapting user-defined area colors to light/dark themes
 * (per look-and-feel overhaul: automatic subtle adaptation requested).
 * 
 * All BEM + Svelte 5 runes compliant.
 */

import { theme } from '$lib/stores/theme.svelte.ts';

/**
 * Lightens (or darkens) a hex color by a percentage.
 * Simple implementation without external deps.
 */
function adjustColor(hex: string, percent: number): string {
	const num = parseInt(hex.replace('#', ''), 16);
	const amt = Math.round(2.55 * percent * 100);
	const R = (num >> 16) + amt;
	const G = ((num >> 8) & 0x00ff) + amt;
	const B = (num & 0x0000ff) + amt;

	return (
		'#' +
		(
			0x1000000 +
			(R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
			(G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
			(B < 255 ? (B < 1 ? 0 : B) : 255)
		)
			.toString(16)
			.slice(1)
	);
}

/**
 * Returns a display-ready version of an area color.
 * In light mode: returns the original (admin-chosen) color.
 * In dark mode: returns a subtly brightened version so it pops nicely
 * on dark surfaces while keeping the semantic identity.
 */
export function getDisplayAreaColor(originalColor: string | undefined | null): string {
	if (!originalColor) return '#64748b'; // fallback muted

	if (!theme.isDark) {
		return originalColor;
	}

	// Subtle brightening for dark mode (about 15-20%)
	// Keeps the hue/saturation identity but makes backgrounds and borders readable.
	return adjustColor(originalColor, 0.18);
}

/**
 * For cases where we want the "pure" accent (e.g. borders that should stay vibrant)
 * even in dark mode.
 */
export function getAccentAreaColor(originalColor: string | undefined | null): string {
	return originalColor || '#64748b';
}
