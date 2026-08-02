import { describe, it, expect } from 'vitest';
import type { Client, Job } from '$lib/db';
import {
	buildPaymentInstructions,
	envelopeRecipientTopInches,
	generateInvoiceDocx,
	getBusinessReturnAddressLines,
	getClientBillToAddress,
	getClientServiceAddress,
	getRecipientMailingLines,
	normalizeInvoiceLayout
} from '$lib/utils/invoiceDocx';
import {
	hasEnvelopeMailToLabel,
	hasEnvelopePreviewMarkers,
	hasEnvelopeRecipientRowHeight,
	hasEnvelopeReturnOffset,
	hasEnvelopeWindowColumnWidth,
	hasServiceLocationLeftAligned,
	hasTotalsBoxAfterLineItems,
	hasTotalsRightAlignment,
	readInvoiceDocxStructure
} from '$lib/utils/invoiceDocx/inspect';

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
		expect(lines.some((l) => l.includes('Mail payment to:'))).toBe(true);
	});

	it('references billing email for email-billing clients', () => {
		const client = { preferredBillingMethod: 'email' } as Client;
		const lines = buildPaymentInstructions(client, business);
		expect(lines.some((l) => l.includes('billing@ccw.example'))).toBe(true);
	});
});

describe('envelope window spacing', () => {
	it('places recipient block at 2.5" for #10 lower window', () => {
		expect(envelopeRecipientTopInches()).toBeCloseTo(2.5, 3);
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

const sampleJob: Job = {
	id: 'j-docx',
	clientId: 'c-docx',
	title: 'Window Cleaning',
	start: new Date('2026-07-15T09:00:00'),
	end: new Date('2026-07-15T11:00:00'),
	assignedCrew: ['Alex'],
	status: 'completed',
	billableItems: [{ title: 'Full Exterior', price: 450, quantity: 1, total: 450 }],
	subtotal: 450,
	taxRate: 0.05,
	taxAmount: 22.5,
	totalAmount: 472.5,
	areaOfTown: 'downtown',
	createdAt: new Date(),
	updatedAt: new Date()
};

const sampleClient: Client = {
	id: 'c-docx',
	name: 'Oak Street LLC',
	serviceAddressStreet: '123 Oak St',
	serviceAddressCity: 'Juneau',
	serviceAddressState: 'AK',
	serviceAddressZip: '99801',
	areaOfTown: 'downtown',
	preferredBillingMethod: 'email',
	phone: '907-555-1234',
	email: 'billing@oak.example',
	createdAt: new Date(),
	updatedAt: new Date()
};

describe('generateInvoiceDocx structure', () => {
	it('positions envelope rows and omits Mail to: label in window zone', async () => {
		const blob = await generateInvoiceDocx(sampleJob, sampleClient, {
			invoiceNumber: 'CCW-2026-0001',
			businessName: 'Capital City Windows'
		});
		const structure = await readInvoiceDocxStructure(blob);

		expect(structure.plainText).toContain('Oak Street LLC');
		expect(hasEnvelopeMailToLabel(structure.plainText)).toBe(false);
		expect(hasEnvelopeRecipientRowHeight(structure.documentXml)).toBe(true);
		expect(hasEnvelopeReturnOffset(structure.documentXml)).toBe(true);
		expect(hasEnvelopeWindowColumnWidth(structure.documentXml)).toBe(true);
		expect(hasTotalsRightAlignment(structure.documentXml, 472.5)).toBe(true);
		expect(hasTotalsBoxAfterLineItems(structure.plainText, 472.5)).toBe(true);
		expect(hasServiceLocationLeftAligned(structure.documentXml)).toBe(true);
		expect(hasEnvelopePreviewMarkers(structure.plainText)).toBe(false);
	});

	it('places payment before invoice notes with notes last', async () => {
		const blob = await generateInvoiceDocx(sampleJob, sampleClient, {
			invoiceNumber: 'CCW-2026-0002',
			businessName: 'Capital City Windows',
			invoiceNotes: 'Gate code 1234'
		});
		const structure = await readInvoiceDocxStructure(blob);
		const paymentIdx = structure.plainText.indexOf('Payment');
		const notesIdx = structure.plainText.indexOf('Invoice notes');
		const dueIdx = structure.plainText.indexOf('Amount due by');
		expect(paymentIdx).toBeGreaterThan(-1);
		expect(notesIdx).toBeGreaterThan(-1);
		expect(dueIdx).toBeGreaterThan(-1);
		expect(dueIdx).toBeLessThan(paymentIdx);
		expect(paymentIdx).toBeLessThan(notesIdx);
		expect(structure.plainText).toContain('Gate code 1234');
	});

	it('includes dev envelope preview overlays when requested in dev', async () => {
		const blob = await generateInvoiceDocx(
			sampleJob,
			sampleClient,
			{ invoiceNumber: 'CCW-2026-0099' },
			{ envelopePreview: true }
		);
		const structure = await readInvoiceDocxStructure(blob);
		expect(hasEnvelopePreviewMarkers(structure.plainText)).toBe(import.meta.env.DEV);
	});

	it('pay_first layout highlights amount due and work section order', async () => {
		const blob = await generateInvoiceDocx(sampleJob, sampleClient, {
			invoiceNumber: 'CCW-2026-0100',
			invoiceLayout: 'pay_first'
		});
		const structure = await readInvoiceDocxStructure(blob);
		expect(structure.plainText).toContain('AMOUNT DUE');
		expect(structure.plainText).toContain('Bill to');
		expect(structure.plainText.indexOf('Amount due')).toBeGreaterThan(-1);
		expect(structure.plainText.indexOf('AMOUNT DUE')).toBeGreaterThan(
			structure.plainText.indexOf('Description')
		);
	});

	it('job_packet layout uses work performed and payment instructions titles', async () => {
		const blob = await generateInvoiceDocx(sampleJob, sampleClient, {
			invoiceNumber: 'CCW-2026-0101',
			invoiceLayout: 'job_packet',
			invoiceNotes: 'Leave gate open'
		});
		const structure = await readInvoiceDocxStructure(blob);
		expect(structure.plainText).toContain('WORK PERFORMED');
		expect(structure.plainText).toContain('Payment instructions');
		expect(structure.plainText).toContain('Job / tax info');
		expect(structure.plainText).toContain('Leave gate open');
		expect(structure.plainText.indexOf('WORK PERFORMED')).toBeLessThan(
			structure.plainText.indexOf('Payment instructions')
		);
	});
});

describe('normalizeInvoiceLayout', () => {
	it('defaults unknown values to quiet', () => {
		expect(normalizeInvoiceLayout(undefined)).toBe('quiet');
		expect(normalizeInvoiceLayout('nope')).toBe('quiet');
		expect(normalizeInvoiceLayout('pay_first')).toBe('pay_first');
		expect(normalizeInvoiceLayout('job_packet')).toBe('job_packet');
	});
});