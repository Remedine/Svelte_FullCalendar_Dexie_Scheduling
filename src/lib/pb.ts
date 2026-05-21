// src/lib/pb.ts
import PocketBase from 'pocketbase';
import { db, type User } from '$lib/db';
import * as bcrypt from 'bcryptjs';

// PocketBase client singleton (single source of truth for auth + sync)
export const pb = new PocketBase(
    import.meta.env.PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090'
);

// Check if user is Authenticated Helper
export function isAuthenticated(): boolean {
    return pb.authStore.isValid;
}

//Email + Password login
export async function loginWithEmail(email: string, password: string) {
	try {
		const authData = await pb
			.collection('users')
			.authWithPassword(email, password);

		// Cache user + pinHash to Dexie for offline PIN login
		const pbUser = authData.record;
		const localuser: User = {
			name: pbUser.pinHash || '',
			role: pbUser.role,
			photo: pbUser.photo ? pbUser.photo : undefined,
			active: pbUser.active ?? true,
			forcePinUpdate: pbUser.forcePinUpdate ?? false,
			forcePhotoUpdate: pbUser.forcePhotoUpdate ?? false,
			createdAt: new Date(pbUser.createdAt),
			updatedAt: new Date(pbUser.updatedAt)
		};

		await db.users.put(localUser); // upsert into Dexie
		console.log('✅ Email login successful & cached to Dexie:', pbUser.name);
		return authData;
	} catch (err) {
		console.error('Email login failed:', err);
		throw err;
	}
}

//Pin Login (local/offline fallback - checks Dexie first)
export async function loginWithPin(name: string, pin: string) {
	try {
		// First try local Dexie (works offline)
		const localUsers = await db.users.where('name').equals(name).toArray();
		const user = localUsers[0];

		if (!user || !user.pinHash) {
			throw new Error('User not found or no PIN set');
		}

		const isValid = await bcrypt.compare(pin, user.pinHash);
		if (!isValid) {
			throw new Error('Invalid PIN');
		}

		if (!user.active) {
			throw new Error('Account is inactive');
		}

		console.log('✅ PIN login successful (offline):', name);
		return { record: user }; // mimic PocketBase shape for consistency
	} catch (err) {
		console.error('PIN login failed:', err);
		throw err;
	}
}

export function logout() {
    pb.authStore.clear();
    console.log('👋 Logged out');
}

//Get current logged-in user record
export function getCurrentUser() {
    return pb.authStore.model;
}