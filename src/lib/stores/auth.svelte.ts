// src/lib/stores/auth.svelte.ts
import { browser } from '$app/environment';
import * as bcrypt from 'bcryptjs';

export const auth = $state({
	currentUser: null as any,
	isAuthenticated: false,
	loading: true
});

// We'll import db only when needed (inside functions) to avoid circular dependency
export async function login(
	firstName: string,
	pin: string
): Promise<{ success: boolean; user?: any; message?: string }> {
	const { db } = await import('$lib/db'); // )=- Dynamic import here

	// )=- Updated for firstName + verified quick login flow.
	// Only users with verified=true (set after email/password verification) can use the fast first-name + PIN method.
	// )=- Lookup by firstName (case-insens). To support first-name collisions (e.g. two "Johns"), fetch candidates and match the entered PIN hash.
	// The correct user's hash will match; wrong one won't. (If same firstName + same PIN, ambiguous - admin should avoid.)
	const candidates = await db.users.where('firstName').equalsIgnoreCase(firstName).toArray();
	let user = null;
	for (const c of candidates) {
		if (await bcrypt.compare(pin, c.pinHash)) {
			user = c;
			break;
		}
	}

	if (!user || !user.active) {
		return { success: false, message: 'User not found or inactive' };
	}
	// )=- Gate quick PIN only for users that have an email (validated creation) and verified flag (set on email login success).
	// Old pure-PIN users (no email) still allowed for compat. New flow enforces verification.
	if (user.email && user.verified !== true) {
		return { success: false, message: 'Account not verified yet. Please login with email/password first to activate quick PIN access.' };
	}

	auth.currentUser = user;
	auth.isAuthenticated = true;
	localStorage.setItem('currentUserId', user.id!.toString());

	return { success: true, user };
}

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
		import('$lib/db').then(({ db }) => {
			// )=- Dynamic import
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

export async function setInitialPin(userId: string, newPin: string) {
	const { db, updateUser } = await import('$lib/db'); // )=- Dynamic import + use updateUser for PB sync consistency
	const bcryptModule = await import('bcryptjs');
	const hashed = await bcryptModule.hash(newPin, 10);

	await updateUser(userId, {
		pinHash: hashed,
		forcePinUpdate: false,
		updatedAt: new Date()
	});

	const updatedUser = await db.users.get(userId);
	if (updatedUser) {
		auth.currentUser = updatedUser;
		auth.isAuthenticated = true;
	}
}
