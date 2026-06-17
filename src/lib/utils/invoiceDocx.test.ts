import { describe, it, expect } from 'vitest';
import { buildPaymentInstructions } from '$lib/utils/invoiceDocx';
import type { Client } from '$lib/db';

describe('buildPaymentInstructions', () => {
	const business = {
		businessName: 'Capital City Windows',
		businessEmail: 'billing@ccw.example',
		businessPhone: '907-555-0100',
		businessMailingStreet: 'PO Box 100',
		businessMailingCity: 'Juneau',
		businessMailingState: 'AK',
		businessMailingZip: '99801'
	};

	it('includes check mailing for check-billing clients', () => {
		const client = { preferredBillingMethod: 'check' } as Client;
		const lines = buildPaymentInstructions(client, business);
		expect(lines.some((l) => l.includes('Make check payable'))).toBe(true);
		expect(lines.some((l) => l.includes('PO Box 100'))).toBe(true);
	});

	it('references billing email for email-billing clients', () => {
		const client = { preferredBillingMethod: 'email' } as Client;
		const lines = buildPaymentInstructions(client, business);
		expect(lines.some((l) => l.includes('billing@ccw.example'))).toBe(true);
	});
});