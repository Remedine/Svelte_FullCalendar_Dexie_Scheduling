import { describe, expect, it } from 'vitest';
import { matchFilesToInvoices, type InvoiceFileTarget } from './fileMatch';

const invoices: InvoiceFileTarget[] = [
	{ id: 'i1', invoiceNumber: 'CCW-2026-0001', importKey: 'inv-1' },
	{ id: 'i2', invoiceNumber: 'CCW-2026-0002', importKey: 'inv-2' },
	{ id: 'i3', invoiceNumber: 'LEG-9', importKey: 'legacy-9' }
];

describe('matchFilesToInvoices', () => {
	it('matches exact invoice number in filename', () => {
		const rows = matchFilesToInvoices(['CCW-2026-0001.pdf'], invoices);
		expect(rows[0].action).toBe('would_attach');
		expect(rows[0].invoiceId).toBe('i1');
		expect(rows[0].role).toBe('supporting');
	});

	it('matches importKey and treats docx as primary by default', () => {
		const rows = matchFilesToInvoices(['inv-2.docx'], invoices);
		expect(rows[0].action).toBe('would_attach');
		expect(rows[0].invoiceId).toBe('i2');
		expect(rows[0].role).toBe('primary');
	});

	it('matches substring invoice number', () => {
		const rows = matchFilesToInvoices(['scan_CCW-2026-0001_front.jpg'], invoices);
		expect(rows[0].action).toBe('would_attach');
		expect(rows[0].invoiceId).toBe('i1');
	});

	it('uses explicit mapping', () => {
		const rows = matchFilesToInvoices(['photo.jpg'], invoices, {
			mapping: { 'photo.jpg': 'LEG-9' }
		});
		expect(rows[0].invoiceId).toBe('i3');
	});

	it('errors when no match', () => {
		const rows = matchFilesToInvoices(['random.pdf'], invoices);
		expect(rows[0].action).toBe('error');
	});

	it('errors when mapping target missing', () => {
		const rows = matchFilesToInvoices(['a.pdf'], invoices, {
			mapping: { 'a.pdf': 'NOPE' }
		});
		expect(rows[0].action).toBe('error');
	});

	it('can force all supporting including docx', () => {
		const rows = matchFilesToInvoices(['inv-1.docx'], invoices, {
			treatDocxAsPrimary: false
		});
		expect(rows[0].role).toBe('supporting');
	});
});
