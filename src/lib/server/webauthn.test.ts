import { describe, expect, it } from 'vitest';
import { normalizeCredentialId } from './webauthn';

describe('normalizeCredentialId', () => {
	it('strips base64url padding', () => {
		expect(normalizeCredentialId('abc123==')).toBe('abc123');
		expect(normalizeCredentialId('abc123')).toBe('abc123');
	});
});