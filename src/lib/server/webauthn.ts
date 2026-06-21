import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticatorTransportFuture,
	type VerifiedAuthenticationResponse,
	type VerifiedRegistrationResponse
} from '@simplewebauthn/server';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';

export type PasskeyRecord = {
	id?: string;
	userId: string;
	credentialId: string;
	publicKey: string;
	counter: number;
	transports?: AuthenticatorTransportFuture[];
	deviceName?: string;
};

export type WebAuthnConfig = {
	rpName: string;
	rpID: string;
	origin: string;
};

export function getWebAuthnConfig(request: Request): WebAuthnConfig {
	const origin =
		request.headers.get('origin') ||
		(request.headers.get('x-forwarded-proto') && request.headers.get('host')
			? `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}`
			: `https://${request.headers.get('host') || 'localhost'}`);

	const { hostname, origin: resolvedOrigin } = new URL(origin);

	return {
		rpName: 'Capital City Windows',
		rpID: hostname,
		origin: resolvedOrigin
	};
}

type ChallengePayload = {
	challenge: string;
	type: 'registration' | 'authentication';
	userId?: string;
	email?: string;
	exp: number;
};

function signChallengePayload(payload: ChallengePayload): string {
	const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const sig = createHmac('sha256', INTERNAL_SECRET).update(data).digest('base64url');
	return `${data}.${sig}`;
}

export function createChallengeToken(payload: Omit<ChallengePayload, 'exp'>): string {
	return signChallengePayload({
		...payload,
		exp: Date.now() + 5 * 60 * 1000
	});
}

export function verifyChallengeToken(
	token: string,
	expectedType: ChallengePayload['type']
): ChallengePayload | null {
	const [data, sig] = token.split('.');
	if (!data || !sig) return null;

	const expectedSig = createHmac('sha256', INTERNAL_SECRET).update(data).digest('base64url');
	const a = Buffer.from(sig);
	const b = Buffer.from(expectedSig);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	try {
		const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as ChallengePayload;
		if (payload.type !== expectedType || payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

export function newChallenge(): string {
	return randomBytes(32).toString('base64url');
}

async function pbInternal<T>(path: string, body: Record<string, unknown>): Promise<T> {
	const res = await fetch(`${PUBLIC_PB_URL}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': INTERNAL_SECRET
		},
		body: JSON.stringify(body)
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`PB internal ${path} failed (${res.status}): ${text}`);
	}

	return res.json() as Promise<T>;
}

export async function findPasskeyByCredentialId(
	credentialId: string
): Promise<PasskeyRecord | null> {
	try {
		return await pbInternal<PasskeyRecord>('/api/internal/passkeys/by-credential', {
			credentialId
		});
	} catch {
		return null;
	}
}

export async function listPasskeysForUser(userId: string): Promise<PasskeyRecord[]> {
	const data = await pbInternal<{ items: PasskeyRecord[] }>('/api/internal/passkeys/list', {
		userId
	});
	return data.items || [];
}

export async function savePasskey(record: PasskeyRecord): Promise<void> {
	await pbInternal('/api/internal/passkeys/save', {
		userId: record.userId,
		credentialId: record.credentialId,
		publicKey: record.publicKey,
		counter: record.counter,
		transports: record.transports || [],
		deviceName: record.deviceName || ''
	});
}

export async function updatePasskeyCounter(credentialId: string, counter: number): Promise<void> {
	await pbInternal('/api/internal/passkeys/update-counter', { credentialId, counter });
}

export async function deletePasskey(credentialId: string): Promise<void> {
	await pbInternal('/api/internal/passkeys/delete', { credentialId });
}

export async function issueAuthTokenForUser(userId: string): Promise<{
	token: string;
	record: Record<string, unknown>;
}> {
	return pbInternal('/api/internal/auth-token', { userId });
}

export async function findUserByEmail(email: string): Promise<{
	id: string;
	email: string;
	firstName?: string;
	lastName?: string;
	name?: string;
} | null> {
	const normalized = email.trim().toLowerCase();
	const filter = `(email='${normalized.replace(/'/g, "\\'")}')`;
	const res = await fetch(
		`${PUBLIC_PB_URL}/api/collections/users/records?filter=${encodeURIComponent(filter)}&perPage=1`,
		{
			headers: { 'X-Internal-Secret': INTERNAL_SECRET }
		}
	);
	if (!res.ok) return null;
	const data = await res.json();
	const item = data.items?.[0];
	if (!item) return null;
	return item;
}

export async function buildRegistrationOptions(
	request: Request,
	user: { id: string; email: string; name?: string }
) {
	const config = getWebAuthnConfig(request);
	const existing = await listPasskeysForUser(user.id);
	const challenge = newChallenge();

	const options = await generateRegistrationOptions({
		rpName: config.rpName,
		rpID: config.rpID,
		userName: user.email,
		userDisplayName: user.name || user.email,
		userID: new TextEncoder().encode(user.id),
		attestationType: 'none',
		excludeCredentials: existing.map((pk) => ({
			id: pk.credentialId,
			transports: pk.transports
		})),
		authenticatorSelection: {
			residentKey: 'preferred',
			userVerification: 'preferred',
			authenticatorAttachment: 'platform'
		}
	});

	const challengeToken = createChallengeToken({
		challenge: options.challenge,
		type: 'registration',
		userId: user.id,
		email: user.email
	});

	return { options, challengeToken };
}

export async function verifyRegistration(
	request: Request,
	response: unknown,
	challengeToken: string,
	deviceName?: string
): Promise<VerifiedRegistrationResponse> {
	const payload = verifyChallengeToken(challengeToken, 'registration');
	if (!payload?.userId) throw new Error('Invalid or expired challenge');

	const config = getWebAuthnConfig(request);
	const verification = await verifyRegistrationResponse({
		response: response as any,
		expectedChallenge: payload.challenge,
		expectedOrigin: config.origin,
		expectedRPID: config.rpID,
		requireUserVerification: false
	});

	if (!verification.verified || !verification.registrationInfo) {
		throw new Error('Passkey registration could not be verified');
	}

	const { credential, credentialDeviceType } = verification.registrationInfo;

	await savePasskey({
		userId: payload.userId,
		credentialId: credential.id,
		publicKey: Buffer.from(credential.publicKey).toString('base64url'),
		counter: credential.counter,
		transports: credential.transports,
		deviceName: deviceName || credentialDeviceType || 'Passkey'
	});

	return verification;
}

export async function buildAuthenticationOptions(request: Request, email: string) {
	const normalized = email.trim().toLowerCase();
	const user = await findUserByEmail(normalized);
	if (!user) {
		// Avoid email enumeration — return empty credentials challenge
		const config = getWebAuthnConfig(request);
		const challenge = newChallenge();
		const options = await generateAuthenticationOptions({
			rpID: config.rpID,
			userVerification: 'preferred',
			allowCredentials: []
		});
		const challengeToken = createChallengeToken({
			challenge: options.challenge,
			type: 'authentication',
			email: normalized
		});
		return { options, challengeToken, user: null };
	}

	const passkeys = await listPasskeysForUser(user.id);
	const config = getWebAuthnConfig(request);
	const challenge = newChallenge();

	const options = await generateAuthenticationOptions({
		rpID: config.rpID,
		userVerification: 'preferred',
		allowCredentials: passkeys.map((pk) => ({
			id: pk.credentialId,
			transports: pk.transports
		}))
	});

	const challengeToken = createChallengeToken({
		challenge: options.challenge,
		type: 'authentication',
		userId: user.id,
		email: normalized
	});

	return { options, challengeToken, user };
}

export async function verifyAuthentication(
	request: Request,
	response: unknown,
	challengeToken: string
): Promise<{ verification: VerifiedAuthenticationResponse; userId: string }> {
	const payload = verifyChallengeToken(challengeToken, 'authentication');
	if (!payload) throw new Error('Invalid or expired challenge');

	const credentialId = (response as { id?: string })?.id;
	if (!credentialId) throw new Error('Missing credential id');

	const passkey = await findPasskeyByCredentialId(credentialId);
	if (!passkey) throw new Error('Unknown passkey');

	if (payload.userId && passkey.userId !== payload.userId) {
		throw new Error('Passkey does not belong to this account');
	}

	const config = getWebAuthnConfig(request);
	const verification = await verifyAuthenticationResponse({
		response: response as any,
		expectedChallenge: payload.challenge,
		expectedOrigin: config.origin,
		expectedRPID: config.rpID,
		requireUserVerification: false,
		credential: {
			id: passkey.credentialId,
			publicKey: Buffer.from(passkey.publicKey, 'base64url'),
			counter: passkey.counter,
			transports: passkey.transports
		}
	});

	if (!verification.verified) {
		throw new Error('Passkey authentication could not be verified');
	}

	const newCounter = verification.authenticationInfo.newCounter;
	if (newCounter > passkey.counter) {
		await updatePasskeyCounter(passkey.credentialId, newCounter);
	}

	return { verification, userId: passkey.userId };
}