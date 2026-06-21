import { browser } from '$app/environment';
import bcrypt from 'bcryptjs';

export interface DeviceAuthSettings {
	id: 'current';
	enabled: boolean;
	pinEnabled: boolean;
	biometricEnabled: boolean;
	pinHash?: string;
	biometricCredentialId?: string;
	userId?: string;
	email?: string;
}

const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 8;

function bufferToBase64url(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToBuffer(value: string): ArrayBuffer {
	const padded = value.replace(/-/g, '+').replace(/_/g, '/');
	const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
	const binary = atob(padded + pad);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

export function isWebAuthnAvailable(): boolean {
	return (
		browser &&
		typeof window !== 'undefined' &&
		!!window.PublicKeyCredential &&
		typeof navigator.credentials?.create === 'function'
	);
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
	if (!isWebAuthnAvailable()) return false;
	try {
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
	} catch {
		return false;
	}
}

async function readSettings(): Promise<DeviceAuthSettings | null> {
	const { db } = await import('$lib/db');
	return (await db.deviceAuth.get('current')) || null;
}

export async function getDeviceAuthSettings(): Promise<DeviceAuthSettings | null> {
	if (!browser) return null;
	return readSettings();
}

export async function isQuickUnlockEnabled(): Promise<boolean> {
	const settings = await readSettings();
	return !!settings?.enabled;
}

export async function shouldRequireUnlock(userId?: string | null): Promise<boolean> {
	const settings = await readSettings();
	if (!settings?.enabled) return false;
	if (userId && settings.userId && settings.userId !== userId) return false;
	return settings.pinEnabled || settings.biometricEnabled;
}

export function validatePinFormat(pin: string): string | null {
	if (!/^\d+$/.test(pin)) return 'PIN must contain only digits';
	if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
		return `PIN must be ${MIN_PIN_LENGTH}–${MAX_PIN_LENGTH} digits`;
	}
	return null;
}

async function registerLocalBiometricCredential(
	userId: string,
	email: string,
	displayName: string
): Promise<string> {
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const credential = (await navigator.credentials.create({
		publicKey: {
			challenge,
			rp: { name: 'Capital City Windows', id: window.location.hostname },
			user: {
				id: new TextEncoder().encode(userId),
				name: email,
				displayName
			},
			pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
			authenticatorSelection: {
				authenticatorAttachment: 'platform',
				userVerification: 'required',
				residentKey: 'discouraged'
			},
			attestation: 'none',
			timeout: 60_000
		}
	})) as PublicKeyCredential | null;

	if (!credential?.rawId) {
		throw new Error('Biometric setup was cancelled or is not available on this device');
	}

	return bufferToBase64url(credential.rawId);
}

export async function enableQuickUnlock(opts: {
	userId: string;
	email: string;
	displayName: string;
	pin?: string;
	enableBiometric?: boolean;
}): Promise<void> {
	const pin = opts.pin?.trim();
	const wantBiometric = !!opts.enableBiometric;
	const pinError = pin ? validatePinFormat(pin) : null;
	if (pinError) throw new Error(pinError);
	if (!pin && !wantBiometric) {
		throw new Error('Choose a PIN and/or biometric unlock');
	}

	let biometricCredentialId: string | undefined;
	if (wantBiometric) {
		if (!(await isPlatformAuthenticatorAvailable())) {
			throw new Error('Fingerprint or Face ID is not available on this device');
		}
		biometricCredentialId = await registerLocalBiometricCredential(
			opts.userId,
			opts.email,
			opts.displayName
		);
	}

	const { db } = await import('$lib/db');
	const settings: DeviceAuthSettings = {
		id: 'current',
		enabled: true,
		pinEnabled: !!pin,
		biometricEnabled: !!biometricCredentialId,
		pinHash: pin ? await bcrypt.hash(pin, 10) : undefined,
		biometricCredentialId,
		userId: opts.userId,
		email: opts.email
	};
	await db.deviceAuth.put(settings);
}

export async function disableQuickUnlock(): Promise<void> {
	const { db } = await import('$lib/db');
	await db.deviceAuth.delete('current').catch(() => {});
}

export async function verifyPinUnlock(pin: string): Promise<boolean> {
	const settings = await readSettings();
	if (!settings?.enabled || !settings.pinEnabled || !settings.pinHash) return false;
	return bcrypt.compare(pin, settings.pinHash);
}

export async function unlockWithBiometric(): Promise<boolean> {
	const settings = await readSettings();
	if (!settings?.enabled || !settings.biometricEnabled || !settings.biometricCredentialId) {
		return false;
	}

	try {
		const assertion = (await navigator.credentials.get({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rpId: window.location.hostname,
				allowCredentials: [
					{
						id: base64urlToBuffer(settings.biometricCredentialId),
						type: 'public-key'
					}
				],
				userVerification: 'required',
				timeout: 60_000
			}
		})) as PublicKeyCredential | null;

		return !!assertion;
	} catch {
		return false;
	}
}

export async function updateQuickUnlockPin(currentPin: string, newPin: string): Promise<void> {
	const pinError = validatePinFormat(newPin);
	if (pinError) throw new Error(pinError);

	const settings = await readSettings();
	if (!settings?.pinHash) throw new Error('PIN unlock is not enabled');

	const ok = await bcrypt.compare(currentPin, settings.pinHash);
	if (!ok) throw new Error('Current PIN is incorrect');

	settings.pinHash = await bcrypt.hash(newPin, 10);
	settings.pinEnabled = true;
	settings.enabled = true;
	const { db } = await import('$lib/db');
	await db.deviceAuth.put(settings);
}