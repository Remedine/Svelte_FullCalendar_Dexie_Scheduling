// src/lib/pb.ts

import PocketBase from 'pocketbase';

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
		const authData = await pb.collection('users').authWithPassword(email, password);

		// TODO (next step): Cache user + pinHash to Dexie for offline PIN login
		console.log('✅ Email login successful:', authData.record.name);
		return authData;
	} catch (err) {
		console.error('Email login failed:', err);
		throw err;
	}
}

//Pin Login (local/offline fallback - checks Dexie first)
export async function loginWithPin(name: string, pin: string) {
	// This function will be expanded in the next step when we integrate with Dexie
	// For now it is a placeholder that we will connect to your existing bcrypt logic
    console.log('Pin login requested for:', name);
    throw new Error('PIN login not yet wired to Dexie');
}

export function logout() {
    pb.authStore.clear();
    console.log('👋 Logged out');
}

//Get current logged-in user record
export function getCurrentUser() {
    return pb.authStore.model;
}