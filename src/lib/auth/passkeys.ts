import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { browser } from '$app/environment';
import { isWebAuthnAvailable } from '$lib/auth/deviceUnlock';

export function canUsePasskeys(): boolean {
	return isWebAuthnAvailable();
}

export async function registerPasskey(deviceName?: string): Promise<void> {
	const { pb } = await import('$lib/db/pb');
	if (!pb.authStore.token) throw new Error('Sign in first to add a passkey');

	const optionsRes = await fetch('/api/auth/webauthn/register/options', {
		method: 'POST',
		headers: { Authorization: pb.authStore.token }
	});
	if (!optionsRes.ok) {
		const data = await optionsRes.json().catch(() => ({}));
		throw new Error(data.error || 'Could not start passkey setup');
	}

	const { options, challengeToken } = await optionsRes.json();
	const registration = await startRegistration({ optionsJSON: options });

	const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: pb.authStore.token
		},
		body: JSON.stringify({
			response: registration,
			challengeToken,
			deviceName: deviceName || guessDeviceName()
		})
	});

	if (!verifyRes.ok) {
		const data = await verifyRes.json().catch(() => ({}));
		throw new Error(data.error || 'Passkey registration failed');
	}
}

export async function listPasskeys(): Promise<
	Array<{ credentialId: string; deviceName: string; created?: string }>
> {
	const { pb } = await import('$lib/db/pb');
	if (!pb.authStore.token) return [];

	const res = await fetch('/api/auth/webauthn/credentials', {
		headers: { Authorization: pb.authStore.token }
	});
	if (!res.ok) return [];
	const data = await res.json();
	return data.items || [];
}

export async function removePasskey(credentialId: string): Promise<void> {
	const { pb } = await import('$lib/db/pb');
	if (!pb.authStore.token) throw new Error('Not authenticated');

	const res = await fetch('/api/auth/webauthn/credentials', {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json',
			Authorization: pb.authStore.token
		},
		body: JSON.stringify({ credentialId })
	});

	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		throw new Error(data.error || 'Failed to remove passkey');
	}
}

function guessDeviceName(): string {
	if (!browser) return 'Passkey';
	const ua = navigator.userAgent;
	if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone / iPad';
	if (/Android/i.test(ua)) return 'Android device';
	if (/Windows/i.test(ua)) return 'Windows device';
	if (/Mac/i.test(ua)) return 'Mac';
	return 'This device';
}