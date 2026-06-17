import { describe, it, expect } from 'vitest';
import {
	buildPaymentInstructions,
	getBusinessReturnAddressLines,
	getClientBillToAddress,
	getClientServiceAddress,
	getRecipientMailingLines
} from '$lib/utils/invoiceDocx';
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

describe('envelope address blocks', () => {
	it('return address uses mailing address from options', () => {
		const lines = getBusinessReturnAddressLines({
			businessName: 'Capital City Windows',
			businessMailingStreet: 'PO Box 100',
			businessMailingCity: 'Juneau',
			businessMailingState: 'AK',
			businessMailingZip: '99801'
		});
		expect(lines[0]).toBe('Capital City Windows');
		expect(lines[1]).toBe('PO Box 100');
		expect(lines[2]).toContain('Juneau');
	});

	it('recipient mailing uses bill-to address lines only', () => {
		const client = {
			useBillingAddress: true,
			billingAddressStreet: 'PO Box 200',
			billingAddressCity: 'Anchorage',
			billingAddressState: 'AK',
			billingAddressZip: '99501'
		} as Client;
		const lines = getRecipientMailingLines(client, 'Jane Homeowner');
		expect(lines).toEqual(['Jane Homeowner', 'PO Box 200', 'Anchorage, AK 99501']);
	});
});

describe('client billing vs service address', () => {
	const base = {
		serviceAddressStreet: '100 Service Rd',
		serviceAddressCity: 'Juneau',
		serviceAddressState: 'AK',
		serviceAddressZip: '99801',
		billingAddressStreet: 'PO Box 200',
		billingAddressCity: 'Anchorage',
		billingAddressState: 'AK',
		billingAddressZip: '99501'
	} as Client;

	it('uses service address for Bill To when useBillingAddress is false', () => {
		const billTo = getClientBillToAddress({ ...base, useBillingAddress: false });
		expect(billTo.street).toBe('100 Service Rd');
		expect(billTo.csz).toContain('Juneau');
	});

	it('uses billing address for Bill To when useBillingAddress is true', () => {
		const billTo = getClientBillToAddress({ ...base, useBillingAddress: true });
		expect(billTo.street).toBe('PO Box 200');
		expect(billTo.csz).toContain('Anchorage');
	});

	it('always uses service address for service location', () => {
		const loc = getClientServiceAddress({ ...base, useBillingAddress: true });
		expect(loc.street).toBe('100 Service Rd');
		expect(loc.csz).toContain('Juneau');
	});
});