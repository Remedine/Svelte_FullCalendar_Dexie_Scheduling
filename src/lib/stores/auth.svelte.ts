import { browser } from '$app/environment';
import { db, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

// )=- Svelte 5 exported state must be wrapped in an object
export const auth = $state({
	currentUser: null as User | null
});

// All functions and code go AFTER the $state block is closed
export async function login(
	name: string,
	pin: string
): Promise<{ success: boolean; user?: User; message?: string }> {
	const user = await db.users.where('name').equals(name).first();

	if (!user || !user.active) {
		return { success: false, message: 'User not found or inactive' };
	}

	const isValid = await bcrypt.compare(pin, user.pinHash);
	if (!isValid) {
		return { success: false, message: 'Incorrect PIN' };
	}

	// )=- Mutate the property only (this line must be OUTSIDE the $state({}))
	auth.currentUser = user;
	localStorage.setItem('currentUserId', user.id!.toString());

	return { success: true, user };
}

export async function logout() {
	auth.currentUser = null;
	localStorage.removeItem('currentUserId');
}

// Auto-login from localStorage (client-only)
if (browser) {
	const savedId = localStorage.getItem('currentUserId');
	if (savedId) {
		db.users.get(Number(savedId)).then((user) => {
			if (user && user.active) {
				auth.currentUser = user;
			}
		});
	}
}

export function getCurrentUser() {
	return auth.currentUser;
}
