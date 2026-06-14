/**
 * theme.svelte.ts — Dark-by-default theme management (Svelte 5 runes)
 * 
 * - Default: 'dark' (per approved plan / user decision).
 * - Persists explicit choice to localStorage.
 * - Listens to system changes (only while in 'system' mode, but we default hard to dark).
 * - Applies 'dark' class to <html> for CSS vars in globals.css + all components/FC.
 * - Exposes simple API for ThemeToggle and anywhere else that needs to react.
 * 
 * Reference: Look & Feel Overhaul Plan (locked decisions 2026-06-13)
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ccw-theme';

let currentTheme = $state<Theme>('dark'); // dark by default

// Initialize from storage or default (dark). Runs once on module load.
function init() {
	if (typeof window === 'undefined') return;

	const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;

	if (saved === 'light' || saved === 'dark') {
		currentTheme = saved;
	} else {
		// No saved preference → dark by default (product decision)
		currentTheme = 'dark';
		localStorage.setItem(STORAGE_KEY, currentTheme);
	}

	apply();
}

// Apply the class to root element (works for :root + .dark rules)
function apply() {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;

	if (currentTheme === 'dark') {
		// Apply both 'dark' (for baseline) and 'test-apple-dark' (Apple HIG dark mode test on all pages)
		root.classList.add('dark', 'test-apple-dark');
	} else {
		root.classList.remove('dark', 'test-apple-dark');
	}
}

export const theme = {
	get current(): Theme {
		return currentTheme;
	},
	get isDark(): boolean {
		return currentTheme === 'dark';
	},
	/** Toggle between light and dark. Persists choice. */
	toggle() {
		currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
		if (typeof window !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, currentTheme);
		}
		apply();
	},
	/** Force a specific theme (used by future "system" or debug UI if needed). */
	set(newTheme: Theme) {
		currentTheme = newTheme;
		if (typeof window !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, currentTheme);
		}
		apply();
	}
};

// Boot the store as soon as this module is imported (layouts import it early).
init();

// Optional: if user ever wants to respect system changes while no explicit choice,
// we could add a listener here. For now we hard-default to dark and only react to
// explicit toggles (keeps behavior predictable after the user chooses).

// Re-apply on visibility change (in case another tab toggled it).
if (typeof window !== 'undefined') {
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden) {
			const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
			if (saved && saved !== currentTheme) {
				currentTheme = saved;
				apply();
			}
		}
	});
}

export default theme;