import { browser } from '$app/environment';
import bcrypt from 'bcryptjs';

export interface DeviceAuthSettings {
	id: 'current';
	enabled: boolean;
	pinEnabled: boolean;
	biometricEnabled: boolean;
	pinHash?: string;
	pinLength?: number;
	biometricCredentialId?: string;
	userId?: string;
	email?: string;
}

export const PIN_LENGTH = 4;
export const MAX_PIN_ATTEMPTS = 5;

/** Default re-lock idle: 2 hours (overridable in Admin → Options). */
export const DEFAULT_IDLE_LOCK_MINUTES = 120;
export const DEFAULT_IDLE_LOCK_MS = DEFAULT_IDLE_LOCK_MINUTES * 60 * 1000;

/** @deprecated Use getIdleLockMs() — kept for tests */
export const IDLE_LOCK_MS = DEFAULT_IDLE_LOCK_MS;

const HIDDEN_AT_KEY = 'ccw_app_hidden_at';
const QUICK_UNLOCK_DECLINED_KEY = 'ccw_quick_unlock_declined';
const PIN_ATTEMPTS_KEY = 'ccw_pin_attempts';

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

export function markAppHidden(): void {
	if (!browser) return;
	sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()));
}

export function clearAppHidden(): void {
	if (!browser) return;
	sessionStorage.removeItem(HIDDEN_AT_KEY);
}

export async function getIdleLockMs(): Promise<number> {
	try {
		const { db } = await import('$lib/db');
		const opts = await db.options.get('1');
		const minutes = Number(opts?.quickUnlockIdleMinutes);
		if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60) {
			return minutes * 60 * 1000;
		}
	} catch {
		// Dexie may be unavailable during teardown
	}
	return DEFAULT_IDLE_LOCK_MS;
}

export function getPinAttemptsRemaining(): number {
	if (!browser) return MAX_PIN_ATTEMPTS;
	const used = Number(sessionStorage.getItem(PIN_ATTEMPTS_KEY) || 0);
	return Math.max(0, MAX_PIN_ATTEMPTS - used);
}

export function recordFailedPinAttempt(): number {
	if (!browser) return 0;
	const used = Number(sessionStorage.getItem(PIN_ATTEMPTS_KEY) || 0) + 1;
	sessionStorage.setItem(PIN_ATTEMPTS_KEY, String(used));
	return Math.max(0, MAX_PIN_ATTEMPTS - used);
}

export function clearPinAttempts(): void {
	if (!browser) return;
	sessionStorage.removeItem(PIN_ATTEMPTS_KEY);
}

export type PinVerifyResult =
	| { ok: true }
	| { ok: false; remaining: number; lockedOut: boolean };

/** True when the app was backgrounded long enough to require quick unlock again. */
export function shouldLockAfterReturn(idleMs: number = DEFAULT_IDLE_LOCK_MS): boolean {
	if (!browser) return false;
	const raw = sessionStorage.getItem(HIDDEN_AT_KEY);
	if (!raw) return false;
	const hiddenAt = Number(raw);
	if (!Number.isFinite(hiddenAt)) return false;
	return Date.now() - hiddenAt >= idleMs;
}

export function declineQuickUnlockSetup(userId: string): void {
	if (!browser) return;
	localStorage.setItem(QUICK_UNLOCK_DECLINED_KEY, userId);
}

export function clearQuickUnlockDecline(): void {
	if (!browser) return;
	localStorage.removeItem(QUICK_UNLOCK_DECLINED_KEY);
}

export async function shouldOfferQuickUnlockSetup(userId: string): Promise<boolean> {
	if (!userId) return false;
	if (await isQuickUnlockEnabled()) return false;
	if (browser && localStorage.getItem(QUICK_UNLOCK_DECLINED_KEY) === userId) return false;
	return true;
}

/** Clear quick unlock when a different user signs in on this device. */
export async function ensureDeviceAuthMatchesUser(userId: string): Promise<void> {
	try {
		const settings = await readSettings();
		if (settings?.userId && settings.userId !== userId) {
			await disableQuickUnlock();
			clearQuickUnlockDecline();
		}
	} catch {
		// Dexie may be closed during logout or test teardown
	}
}

export async function snapshotDeviceAuth(): Promise<DeviceAuthSettings | undefined> {
	return (await readSettings()) ?? undefined;
}

export async function restoreDeviceAuth(snapshot: DeviceAuthSettings | undefined): Promise<void> {
	if (!snapshot?.enabled) return;
	const { db } = await import('$lib/db');
	await db.deviceAuth.put(snapshot);
}

/** True when deviceAuth has a real PIN hash and/or registered biometric credential. */
export function hasUsableUnlockMethod(settings: DeviceAuthSettings | null | undefined): boolean {
	if (!settings?.enabled) return false;
	const hasPin = !!settings.pinEnabled && !!settings.pinHash;
	const hasBio = !!settings.biometricEnabled && !!settings.biometricCredentialId;
	return hasPin || hasBio;
}

export async function shouldRequireUnlock(userId?: string | null): Promise<boolean> {
	const settings = await readSettings();
	if (!settings?.enabled) return false;
	if (userId && settings.userId && settings.userId !== userId) return false;
	if (!hasUsableUnlockMethod(settings)) {
		// Partial/corrupt setup (e.g. enabled flag without PIN hash) must not block the app.
		await disableQuickUnlock();
		return false;
	}
	return true;
}

export function validatePinFormat(pin: string): string | null {
	if (!/^\d{4}$/.test(pin)) return `PIN must be exactly ${PIN_LENGTH} digits`;
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
		pinLength: pin ? PIN_LENGTH : undefined,
		biometricCredentialId,
		userId: opts.userId,
		email: opts.email
	};
	await db.deviceAuth.put(settings);
	clearQuickUnlockDecline();
	clearPinAttempts();
}

export async function disableQuickUnlock(): Promise<void> {
	const { db } = await import('$lib/db');
	await db.deviceAuth.delete('current').catch(() => {});
	clearQuickUnlockDecline();
}

export async function verifyPinUnlock(pin: string): Promise<PinVerifyResult> {
	if (getPinAttemptsRemaining() <= 0) {
		return { ok: false, remaining: 0, lockedOut: true };
	}

	if (validatePinFormat(pin)) {
		return { ok: false, remaining: getPinAttemptsRemaining(), lockedOut: false };
	}

	const settings = await readSettings();
	if (!settings?.enabled || !settings.pinEnabled || !settings.pinHash) {
		return { ok: false, remaining: getPinAttemptsRemaining(), lockedOut: false };
	}

	const match = await bcrypt.compare(pin, settings.pinHash);
	if (match) {
		clearPinAttempts();
		return { ok: true };
	}

	const remaining = recordFailedPinAttempt();
	return { ok: false, remaining, lockedOut: remaining <= 0 };
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

		if (assertion) clearPinAttempts();
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