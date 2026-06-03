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
	name: string,
	pin: string
): Promise<{ success: boolean; user?: any; message?: string }> {
	const { db } = await import('$lib/db'); // )=- Dynamic import here

	const user = await db.users.where('name').equals(name).first();

	if (!user || !user.active) {
		return { success: false, message: 'User not found or inactive' };
	}

	const isValid = await bcrypt.compare(pin, user.pinHash);
	if (!isValid) {
		return { success: false, message: 'Incorrect PIN' };
	}

	auth.currentUser = user;
	auth.isAuthenticated = true;
	localStorage.setItem('currentUserId', user.id!.toString());

	return { success: true, user };
}

export async function logout() {
	auth.currentUser = null;
	auth.isAuthenticated = false;
	localStorage.removeItem('currentUserId');
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

export async function setInitialPin(userId: number, newPin: string) {
	const { db } = await import('$lib/db'); // )=- Dynamic import
	const bcryptModule = await import('bcryptjs');
	const hashed = await bcryptModule.hash(newPin, 10);

	await db.users.update(userId, {
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
