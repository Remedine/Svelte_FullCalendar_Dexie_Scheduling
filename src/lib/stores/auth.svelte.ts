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
		const { disconnectJobsRealtime } = await import('$lib/db/realtime');
		disconnectJobsRealtime();
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

// Auto-restore session (robust to Dexie dedup/cleanup and hybrid PB/local records).
// On hard refresh of protected pages (e.g. /calendar) the previous logic could fail to
// find the exact savedId after pullUsersFromServer / cleanupDuplicateUsers deleted a
// duplicate record, causing loading=false + !authenticated → unwanted redirect to login.
if (browser) {
	(async () => {
		let user: any = null;
		const savedId = localStorage.getItem('currentUserId');

		try {
			const { db } = await import('$lib/db');

			if (savedId) {
				user = await db.users.get(savedId);
			}

			if (!user) {
				// Fallback: use PocketBase session (cookie/auth token is the real source of "logged in")
				// as the truth on refresh. Lookup by pbId or email so we survive id changes from dedup.
				try {
					const { pb } = await import('$lib/db/pb');
					if (pb.authStore.isValid) {
						const m = pb.authStore.model;
						if (m?.id) {
							user =
								(await db.users.where('pbId').equals(m.id).first()) ||
								(await db.users.get(m.id));
						}
						if (!user && m?.email) {
							user = await db.users.where('email').equalsIgnoreCase(m.email).first();
						}
						// As last resort, synthesize a minimal user from PB so guard doesn't redirect.
						// The next pull on calendar load will enrich the Dexie record.
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
							// Persist it so future restores and UI have a Dexie record
							await db.users.put(user);
						}
					}
				} catch (pbErr) {
					// PB not available yet or error — fall through
					console.warn('[auth] PB fallback during restore failed', pbErr);
				}
			}

			if (user && user.active !== false) {
				auth.currentUser = user;
				auth.isAuthenticated = true;
				// Ensure localStorage points at the surviving Dexie id (important after dedups)
				if (user.id) {
					localStorage.setItem('currentUserId', String(user.id));
				}
			} else {
				auth.currentUser = null;
				auth.isAuthenticated = false;

				// When we reach here it means either no user record was found, or the record has active=false
				// (deactivated via PB admin or the app's Crew management).
				// In the inactive case we must clear any lingering PB token so the account is fully unusable
				// until reactivated. We also remove the currentUserId to avoid the restore loop.
				try {
					const { pb } = await import('$lib/db/pb');
					if (pb.authStore.isValid) {
						pb.authStore.clear();
					}
					localStorage.removeItem('currentUserId');
				} catch {
					localStorage.removeItem('currentUserId');
				}
			}
		} catch (e) {
			console.warn('[auth] restore failed', e);
			auth.currentUser = null;
			auth.isAuthenticated = false;
		} finally {
			auth.loading = false;
		}
	})();
} else {
	auth.loading = false;
	auth.isAuthenticated = false;
}
