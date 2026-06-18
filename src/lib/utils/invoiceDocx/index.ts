import type { Client, Job } from '$lib/db';
import { getInvoiceDueDateForJob } from '$lib/utils/dates';
import { createInvoiceDocxBuilder } from './builder';
import {
	buildLineItemsTable,
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

export { envelopeRecipientTopInches } from './layout';

function resolveTaxRatePercent(job: Job, optsRate?: number): number {
	const raw = optsRate ?? job.taxRate ?? 5;
	return raw < 1 ? raw * 100 : raw;
}

/**
 * Generate a one-page invoice .docx for #10 double-window tri-fold mailing.
 * Pass `{ envelopePreview: true }` in dev to overlay window guides on the top panel.
 */
export async function generateInvoiceDocx(
	job: Job,
	client: Client | null | undefined,
	ctx: InvoiceDocxContext,
	options?: InvoiceDocxGenerateOptions
): Promise<Blob> {
	const docx = await import('docx');
	const { Document, Packer } = docx;
	const b = createInvoiceDocxBuilder(docx);

	const dueDays = ctx.invoiceDueDays ?? 30;
	const dueDate = getInvoiceDueDateForJob(job, dueDays);
	const dueDateStr = dueDate.toLocaleDateString();
	const invoiceDate = (ctx.invoiceDate ?? new Date()).toLocaleDateString();
	const taxPct = resolveTaxRatePercent(job, ctx.taxRate);
	const taxLabel =
		ctx.salesTaxJurisdiction?.trim() || 'City and Borough of Juneau sales tax';
	const serviceDate = new Date(job.start).toLocaleDateString();
	const serviceEnd =
		job.end && new Date(job.end).toDateString() !== new Date(job.start).toDateString()
			? ` – ${new Date(job.end).toLocaleDateString()}`
			: '';

	const clientName = client?.name || 'Client';
	const serviceLoc = getClientServiceAddress(client);
	const serviceLines = [serviceLoc.street, serviceLoc.csz].filter((l) => l.trim().length > 0);
	if (serviceLines.length === 0) serviceLines.push('—');

	const envelopePreview = import.meta.env.DEV && options?.envelopePreview === true;

	const topFoldTable = buildTopFoldTable(
		b,
		{
			returnLines: getBusinessReturnAddressLines(ctx),
			recipientLines: getRecipientMailingLines(client, clientName),
			serviceLines,
			envelopePreview
		},
		ctx,
		{ serviceDate, serviceEnd, invoiceDate, dueDateStr }
	);

	const lineItemsTable = buildLineItemsTable(b, job, taxLabel, taxPct);
	const paymentParagraphs = buildPaymentParagraphs(
		b,
		ctx,
		buildPaymentInstructions(client, ctx)
	);
	const totalsParagraphs = buildTotalsParagraphs(b, job.totalAmount ?? 0, dueDateStr);

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