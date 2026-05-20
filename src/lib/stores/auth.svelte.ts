import { browser } from '$app/environment';
import { db, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

// )=- Wrapped in object so we can safely export and mutate (Svelte 5 rule)
export const auth = $state({
	currentUser: null as User | null,
	isReady: false
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
	localStorage.setItem('currentUserId', user.id!.toString());

	return { success: true, user };
}

export async function logout() {
	auth.currentUser = null;
	localStorage.removeItem('currentUserId');
}

// Auto-restore session
if (browser) {
	const savedId = localStorage.getItem('currentUserId');
	if (savedId) {
		db.users.get(Number(savedId)).then((user) => {
			if (user && user.active) {
				auth.currentUser = user;
			}
			auth.isReady = true;
		});
	} else {
		auth.isReady = true;
	}
} else {
	auth.isReady = true;
}

// )=- Add this function for PIN reset modal
export async function setInitialPin(userId: number, newPin: string) {
  const bcrypt = await import('bcryptjs');
  const hashed = await bcrypt.hash(newPin, 10);
  
  await db.users.update(userId, {
    pinHash: hashed,
    forcePinUpdate: false,
    updatedAt: new Date()
  });

  // Refresh current user
  const updatedUser = await db.users.get(userId);
  if (updatedUser) {
    auth.currentUser = updatedUser;
  }
}