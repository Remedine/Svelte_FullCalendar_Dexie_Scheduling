import { browser } from '$app/environment';
import { db, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

export const auth = $state({
	currentUser: null as User | null,
	isAuthenticated: false, 
	loading: true 
});


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

//Re-usable setter so email login (or future pocketbase flowws) can set Dexie currentUser
export function setCurrentUser(user: User | null) {
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
		db.users.get(savedId).then((user) => {               
			if (user && user.active) {
				auth.currentUser = user;
				auth.isAuthenticated = true;
			}
			auth.loading = false;
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
	const bcrypt = await import('bcryptjs');
	const hashed = await bcrypt.hash(newPin, 10);

	await db.users.update(userId, {
		pinHash: hashed,
		forcePinUpdate: false,
		updatedAt: new Date()
	});

	// Refresh current user in store
	const updatedUser = await db.users.get(userId);
	if (updatedUser) {
		auth.currentUser = updatedUser;
		auth.isAuthenticated = true; 
	}
}