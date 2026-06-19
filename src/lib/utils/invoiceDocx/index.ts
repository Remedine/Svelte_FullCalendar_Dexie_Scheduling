import type { Client, Invoice, Job } from '$lib/db';
import { clientFromSnapshot } from '$lib/utils/invoiceSnapshot';
import { createInvoiceDocxBuilder } from './builder';
import {
	buildLineItemsTable,
	buildLineItemsTableFromSnapshot,
	buildPageTable,
	buildPaymentParagraphs,
	buildTopFoldTable,
	buildTotalsParagraphs
} from './panels';
import {
	ENVELOPE_LEFT_MARGIN,
	FONT,
	FONT_BODY,
	MARGIN_BOTTOM,
	MARGIN_RIGHT,
	MARGIN_TOP,
	PAGE_HEIGHT,
	PAGE_WIDTH
} from './layout';
import {
	buildPaymentInstructions,
	getBusinessReturnAddressLines,
	getClientBillToAddress,
	getClientServiceAddress,
	getRecipientMailingLines
} from './addresses';
import { normalizeTaxRateToPercent } from '$lib/utils/tax';
import type { InvoiceDocxContext, InvoiceDocxGenerateOptions } from './types';

export type {
	InvoiceDocxBusinessInfo,
	InvoiceDocxContext,
	InvoiceDocxGenerateOptions
} from './types';

export {
	buildPaymentInstructions,
	getBusinessReturnAddressLines,
	getClientBillToAddress,
	getClientServiceAddress,
	getRecipientMailingLines
} from './addresses';

export {
	envelopeRecipientTopInches,
	TOP_ADDRESS_PANEL_HEIGHT
} from './layout';

/**
 * Generate .docx from invoice snapshot (authoritative) + job service dates.
 */
export async function generateInvoiceDocxFromSnapshot(
	invoice: Invoice,
	job: Job,
	linkedClient: Client | null | undefined,
	ctx: InvoiceDocxContext,
	options?: InvoiceDocxGenerateOptions
): Promise<Blob> {
	const docx = await import('docx');
	const { Document, Packer } = docx;
	const b = createInvoiceDocxBuilder(docx);

	const snapshotClient = clientFromSnapshot(
		invoice.clientSnapshot || {
			name: linkedClient?.name || 'Client',
			serviceAddressStreet: linkedClient?.serviceAddressStreet || '',
			serviceAddressCity: linkedClient?.serviceAddressCity || '',
			serviceAddressState: linkedClient?.serviceAddressState || '',
			serviceAddressZip: linkedClient?.serviceAddressZip || ''
		},
		linkedClient?.preferredBillingMethod || 'invoice'
	);

	const dueDateStr = (
		invoice.dueDate instanceof Date ? invoice.dueDate : new Date(invoice.dueDate)
	).toLocaleDateString();
	const invoiceDate = (
		ctx.invoiceDate ??
		(invoice.invoiceDate instanceof Date ? invoice.invoiceDate : new Date())
	).toLocaleDateString();
	const taxPct = normalizeTaxRateToPercent(ctx.taxRate);
	const taxLabel =
		ctx.salesTaxJurisdiction?.trim() || 'City and Borough of Juneau sales tax';
	const serviceDate = new Date(job.start).toLocaleDateString();
	const serviceEnd =
		job.end && new Date(job.end).toDateString() !== new Date(job.start).toDateString()
			? ` – ${new Date(job.end).toLocaleDateString()}`
			: '';

	const clientName = snapshotClient.name || 'Client';
	const serviceLoc = getClientServiceAddress(snapshotClient);
	const serviceLines = [serviceLoc.street, serviceLoc.csz].filter((l) => l.trim().length > 0);
	if (serviceLines.length === 0) serviceLines.push('—');

	const envelopePreview = import.meta.env.DEV && options?.envelopePreview === true;

	const docCtx: InvoiceDocxContext = {
		...ctx,
		invoiceNumber: invoice.invoiceNumber || ctx.invoiceNumber,
		invoiceNotes: invoice.notes || ctx.invoiceNotes
	};

	const topFoldTable = buildTopFoldTable(
		b,
		{
			returnLines: getBusinessReturnAddressLines(docCtx),
			recipientLines: getRecipientMailingLines(snapshotClient, clientName),
			serviceLines,
			envelopePreview
		},
		docCtx,
		{ serviceDate, serviceEnd, invoiceDate, dueDateStr }
	);

	const lineItemsTable = buildLineItemsTableFromSnapshot(
		b,
		invoice.billableItems || [],
		invoice.subtotal ?? 0,
		invoice.taxAmount ?? 0,
		taxLabel,
		taxPct,
		invoice.invoiceDiscount
	);
	const paymentParagraphs = buildPaymentParagraphs(
		b,
		docCtx,
		buildPaymentInstructions(snapshotClient, docCtx)
	);
	const totalsParagraphs = buildTotalsParagraphs(b, invoice.amount ?? 0, dueDateStr);

	const pageTable = buildPageTable(b, topFoldTable, [
		lineItemsTable,
		...paymentParagraphs,
		...totalsParagraphs
	]);

	const doc = new Document({
		styles: {
			default: {
				document: {
					run: { font: FONT, size: FONT_BODY }
				}
			}
		},
		sections: [
			{
				properties: {
					page: {
						size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
						margin: {
							top: MARGIN_TOP,
							right: MARGIN_RIGHT,
							bottom: MARGIN_BOTTOM,
							left: ENVELOPE_LEFT_MARGIN
						}
					}
				},
				children: [pageTable]
			}
		]
	});

	return Packer.toBlob(doc);
}

/**
 * Legacy entry: builds a temporary snapshot from job+client.
 * Prefer generateInvoiceDocxFromSnapshot for the invoice editor.
 */
export async function generateInvoiceDocx(
	job: Job,
	client: Client | null | undefined,
	ctx: InvoiceDocxContext,
	options?: InvoiceDocxGenerateOptions
): Promise<Blob> {
	const { buildSnapshotDefaults } = await import('$lib/utils/invoiceSnapshot');
	const { calculateInvoiceTotals, normalizeBillableItems } = await import('$lib/utils/invoiceTotals');
	const defaults = buildSnapshotDefaults(job, client, ctx.invoiceDueDays ?? 30);
	const items = normalizeBillableItems(defaults.billableItems);
	const totals = calculateInvoiceTotals({
		billableItems: items,
		taxRatePercent: normalizeTaxRateToPercent(ctx.taxRate ?? job.taxRate)
	});
	const tempInvoice: Invoice = {
		jobId: job.id || '',
		clientId: job.clientId,
		status: 'draft',
		dueDate: defaults.dueDate,
		invoiceDate: ctx.invoiceDate ?? defaults.invoiceDate,
		amount: totals.total,
		subtotal: totals.subtotal,
		taxAmount: totals.taxAmount,
		billableItems: items,
		clientSnapshot: defaults.clientSnapshot,
		notes: ctx.invoiceNotes,
		invoiceNumber: ctx.invoiceNumber,
		createdAt: new Date(),
		updatedAt: new Date()
	};
	return generateInvoiceDocxFromSnapshot(tempInvoice, job, client, ctx, options);
}

/** Map AppOptions record to InvoiceDocxBusinessInfo. */
export function businessInfoFromOptions(opts: Record<string, unknown> | null | undefined) {
	if (!opts) return {};
	return {
		businessName: opts.businessName as string | undefined,
		businessStreet: opts.businessStreet as string | undefined,
		businessCity: opts.businessCity as string | undefined,
		businessState: opts.businessState as string | undefined,
		businessZip: opts.businessZip as string | undefined,
		businessPhone: opts.businessPhone as string | undefined,
		businessEmail: opts.businessEmail as string | undefined,
		businessWebsite: opts.businessWebsite as string | undefined,
		businessMailingStreet: opts.businessMailingStreet as string | undefined,
		businessMailingCity: opts.businessMailingCity as string | undefined,
		businessMailingState: opts.businessMailingState as string | undefined,
		businessMailingZip: opts.businessMailingZip as string | undefined,
		businessSalesTaxAccount: opts.businessSalesTaxAccount as string | undefined,
		salesTaxJurisdiction: opts.salesTaxJurisdiction as string | undefined,
		taxRate: opts.taxRate as number | undefined,
		invoiceDueDays: opts.invoiceDueDays as number | undefined,
		invoiceSignatoryName: opts.invoiceSignatoryName as string | undefined,
		invoiceSignatoryPhone: opts.invoiceSignatoryPhone as string | undefined
	};
}