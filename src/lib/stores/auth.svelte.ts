// src/lib/stores/auth.svelte.ts
import { browser } from '$app/environment';

export const auth = $state({
	currentUser: null as any,
	isAuthenticated: false,
	loading: true
});

export async function logout() {
	// )=- Unified logout: clears central store (used by UI/guards) + localStorage.
	// Also clears PocketBase authStore for consistency when email login was used.
	// (Future: can expand to wipe sensitive Dexie data per security TODO.)
	auth.currentUser = null;
	auth.isAuthenticated = false;
	localStorage.removeItem('currentUserId');

	// Clear PB side if it was used
	try {
		const { pb } = await import('$lib/db/pb');
		pb.authStore.clear();
	} catch {}
}

export function setCurrentUser(user: any | null) {
	auth.currentUser = user;
	auth.isAuthenticated = !!user;

	if (user?.id) {
		localStorage.setItem('currentUserId', user.id.toString());
	} else {
		localStorage.removeItem('currentUserId');
	}
}

// Auto-restore session
if (browser) {
	const savedId = localStorage.getItem('currentUserId');

	if (savedId) {
		// Dynamic import to break circular dependency with $lib/db
		import('$lib/db').then(({ db }) => {
			db.users.get(savedId).then((user) => {
				if (user && user.active) {
					auth.currentUser = user;
					auth.isAuthenticated = true;
				}
				auth.loading = false;
			});
		});
	} else {
		auth.loading = false;
		auth.isAuthenticated = false;
	}
} else {
	auth.loading = false;
	auth.isAuthenticated = false;
}
