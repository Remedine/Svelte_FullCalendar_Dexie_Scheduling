import type { Client, Job } from '$lib/db';
import { getInvoiceDueDateForJob } from '$lib/utils/dates';

/** Business + invoice settings pulled from AppOptions for docx generation. */
export interface InvoiceDocxBusinessInfo {
	businessName?: string;
	businessStreet?: string;
	businessCity?: string;
	businessState?: string;
	businessZip?: string;
	businessPhone?: string;
	businessEmail?: string;
	businessWebsite?: string;
	businessMailingStreet?: string;
	businessMailingCity?: string;
	businessMailingState?: string;
	businessMailingZip?: string;
	businessSalesTaxAccount?: string;
	salesTaxJurisdiction?: string;
	taxRate?: number;
	invoiceDueDays?: number;
}

export interface InvoiceDocxContext extends InvoiceDocxBusinessInfo {
	invoiceNumber: string;
	invoiceDate?: Date;
	/** Invoice-specific notes (not job or client notes). */
	invoiceNotes?: string;
}

const BODY = 18; // 9pt — compact for one-page layout
const LABEL = 18;
const HEADING = 22;
const ENVELOPE = 20; // 10pt — readable through #10 window
const TIGHT = 30;
const LOOSE = 60;
const SECTION = 80;

/** Twips (dxa): 1440 per inch. #10 double-window tri-fold zones. */
const TWIP = 1440;
/** Left margin aligned with common 1-1/8" double-window envelope offset. */
const ENVELOPE_LEFT_MARGIN = Math.round(1.125 * TWIP);
/** Printable content width (letter 8.5" minus 1-1/8" left and 1/2" right margins). */
const CONTENT_WIDTH = Math.round(6.875 * TWIP);
const HALF_COL = Math.round(CONTENT_WIDTH / 2);
/** Line-item table columns (fixed dxa for stable print alignment). */
const COL_DESC = Math.round(CONTENT_WIDTH * 0.55);
const COL_QTY = Math.round(CONTENT_WIDTH * 0.1);
const COL_UNIT = Math.round(CONTENT_WIDTH * 0.15);
const COL_TOTAL = CONTENT_WIDTH - COL_DESC - COL_QTY - COL_UNIT;
/** Top panel (~2.75") — return address shows in upper window when tri-folded. */
const ENVELOPE_RETURN_ROW_H = Math.round(2.75 * TWIP);
/** Bottom panel (~2.75") — recipient shows in lower window when tri-folded. */
const ENVELOPE_RECIPIENT_ROW_H = Math.round(2.75 * TWIP);

function resolveTaxRatePercent(job: Job, optsRate?: number): number {
	const raw = optsRate ?? job.taxRate ?? 5;
	return raw < 1 ? raw * 100 : raw;
}

function formatCityStateZip(city?: string, state?: string, zip?: string): string {
	return [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '');
}

/** Bill To address: billing fields when useBillingAddress, else service address. */
export function getClientBillToAddress(client: Client | null | undefined): {
	street: string;
	csz: string;
} {
	if (!client) return { street: '', csz: '' };
	if (client.useBillingAddress) {
		return {
			street: client.billingAddressStreet?.trim() || '',
			csz: formatCityStateZip(
				client.billingAddressCity,
				client.billingAddressState,
				client.billingAddressZip
			)
		};
	}
	return {
		street: client.serviceAddressStreet?.trim() || '',
		csz: formatCityStateZip(
			client.serviceAddressCity,
			client.serviceAddressState,
			client.serviceAddressZip
		)
	};
}

/** Service location always uses the service address (tax situs). */
export function getClientServiceAddress(client: Client | null | undefined): {
	street: string;
	csz: string;
} {
	if (!client) return { street: '', csz: '' };
	return {
		street: client.serviceAddressStreet?.trim() || '',
		csz: formatCityStateZip(
			client.serviceAddressCity,
			client.serviceAddressState,
			client.serviceAddressZip
		)
	};
}

/** Return address for envelope window (mailing / remit address from options). */
export function getBusinessReturnAddressLines(info: InvoiceDocxBusinessInfo): string[] {
	const name = info.businessName || 'Capital City Windows';
	const mail = formatMailingLines(info);
	return [name, ...mail].filter((l) => l.trim().length > 0);
}

/** Recipient block for envelope window (billing or service address per client setting). */
export function getRecipientMailingLines(
	client: Client | null | undefined,
	clientName: string
): string[] {
	const billTo = getClientBillToAddress(client);
	const lines = [clientName];
	if (billTo.street) lines.push(billTo.street);
	if (billTo.csz.trim()) lines.push(billTo.csz.trim());
	return lines;
}

function formatMailingLines(info: InvoiceDocxBusinessInfo): string[] {
	const street = info.businessMailingStreet?.trim() || info.businessStreet?.trim();
	const city = info.businessMailingCity?.trim() || info.businessCity?.trim();
	const state = info.businessMailingState?.trim() || info.businessState?.trim();
	const zip = info.businessMailingZip?.trim() || info.businessZip?.trim();
	const lines: string[] = [];
	if (street) lines.push(street);
	const csz = formatCityStateZip(city, state, zip);
	if (csz.trim()) lines.push(csz);
	return lines;
}

/** Payment instructions tailored to client preferred billing method. */
export function buildPaymentInstructions(
	client: Client | null | undefined,
	business: InvoiceDocxBusinessInfo
): string[] {
	const name = business.businessName || 'Capital City Windows';
	const email = business.businessEmail?.trim();
	const phone = business.businessPhone?.trim();
	const mail = formatMailingLines(business);
	const method = client?.preferredBillingMethod;

	const lines: string[] = [];

	if (method === 'check') {
		lines.push(`Make check payable to ${name}.`);
		if (mail.length) lines.push(`Mail to: ${mail.join(', ')}`);
	} else if (method === 'email') {
		lines.push('Please remit payment by the due date (check or as agreed).');
		if (email) lines.push(`Payment confirmation or questions: ${email}`);
	} else {
		lines.push(`Please remit payment by the due date. Make payable to ${name}.`);
		if (mail.length) lines.push(`Mail to: ${mail.join(', ')}`);
	}

	if (phone) lines.push(`Billing inquiries: ${phone}`);
	return lines;
}

async function importDocx() {
	return import('docx');
}

/**
 * Generate a compact one-page invoice .docx (fits ~5–8 line items + boilerplate).
 * Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md
 */
export async function generateInvoiceDocx(
	job: Job,
	client: Client | null | undefined,
	ctx: InvoiceDocxContext
): Promise<Blob> {
	const {
		Document,
		Packer,
		Paragraph,
		Table,
		TableRow,
		TableCell,
		TextRun,
		AlignmentType,
		WidthType,
		VerticalAlign,
		HeightRule
	} = await importDocx();

	const businessName = ctx.businessName || 'Capital City Windows';
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
	const billTo = getClientBillToAddress(client);
	const serviceLoc = getClientServiceAddress(client);
	const returnLines = getBusinessReturnAddressLines(ctx);
	const recipientLines = getRecipientMailingLines(client, clientName);

	const paymentLines = buildPaymentInstructions(client, ctx);

	const envelopeAddressCell = (lines: string[], boldFirst = false) =>
		new TableCell({
			verticalAlign: VerticalAlign.TOP,
			margins: { top: 100, bottom: 100, left: 0, right: 0 },
			children: lines.map((line, i) =>
				new Paragraph({
					spacing: { after: 80, before: i === 0 ? 0 : 0 },
					children: [
						new TextRun({
							text: line,
							size: ENVELOPE,
							bold: boldFirst && i === 0
						})
					]
				})
			)
		});

	const exactRow = (heightTwips: number) => ({
		height: { value: heightTwips, rule: HeightRule.EXACT }
	});

	const cell = (
		text: string,
		align?: (typeof AlignmentType)[keyof typeof AlignmentType],
		widthTwips?: number
	) =>
		new TableCell({
			...(widthTwips ? { width: { size: widthTwips, type: WidthType.DXA } } : {}),
			verticalAlign: VerticalAlign.TOP,
			margins: { top: 40, bottom: 40, left: 60, right: 60 },
			children: [
				new Paragraph({
					alignment: align,
					spacing: { after: 20, before: 0 },
					children: [new TextRun({ text, size: BODY })]
				})
			]
		});

	const labeledAddressCell = (
		label: string,
		lines: string[],
		widthTwips: number,
		rightPad = 0
	) =>
		new TableCell({
			width: { size: widthTwips, type: WidthType.DXA },
			verticalAlign: VerticalAlign.TOP,
			margins: { top: 0, bottom: 0, left: 0, right: rightPad },
			children: [
				new Paragraph({
					spacing: { after: 40, before: 0 },
					children: [new TextRun({ text: label, bold: true, size: LABEL })]
				}),
				...lines.map((line) =>
					new Paragraph({
						spacing: { after: 30, before: 0 },
						children: [new TextRun({ text: line, size: BODY })]
					})
				)
			]
		});

	const metaCell = (label: string, value: string, widthTwips: number) =>
		new TableCell({
			width: { size: widthTwips, type: WidthType.DXA },
			verticalAlign: VerticalAlign.TOP,
			margins: { top: 0, bottom: 0, left: 0, right: 0 },
			children: [
				new Paragraph({
					spacing: { after: 30, before: 0 },
					children: [
						new TextRun({ text: `${label}: `, bold: true, size: BODY }),
						new TextRun({ text: value, size: BODY })
					]
				})
			]
		});

	const billToLines = [clientName, billTo.street, billTo.csz].filter((l) => l.trim().length > 0);
	const serviceLines = [serviceLoc.street, serviceLoc.csz].filter((l) => l.trim().length > 0);
	if (serviceLines.length === 0) serviceLines.push('—');

	const billableRows = (job.billableItems || []).map((item: any, idx: number) =>
		new TableRow({
			children: [
				cell(item.title || `Item ${idx + 1}`, undefined, COL_DESC),
				cell(String(item.quantity || 1), AlignmentType.RIGHT, COL_QTY),
				cell(`$${(item.price || 0).toFixed(2)}`, AlignmentType.RIGHT, COL_UNIT),
				cell(`$${(item.total || 0).toFixed(2)}`, AlignmentType.RIGHT, COL_TOTAL)
			]
		})
	);

	const subtotal = job.subtotal ?? 0;
	const taxAmount = job.taxAmount ?? 0;
	const total = job.totalAmount ?? 0;

	const noBorders = {
		top: { style: 'none' as const, size: 0 },
		bottom: { style: 'none' as const, size: 0 },
		left: { style: 'none' as const, size: 0 },
		right: { style: 'none' as const, size: 0 },
		insideHorizontal: { style: 'none' as const, size: 0 },
		insideVertical: { style: 'none' as const, size: 0 }
	};

	// #10 double-window envelope layout: return (top panel), invoice body (middle), recipient (bottom).
	// Tri-fold bottom-up then top-down so windows align with standard 0.875" x 3.25" (return) and 1" x 4" (recipient) openings.
	const middleContent: (typeof Paragraph | typeof Table)[] = [
		new Paragraph({
			spacing: { after: LOOSE, before: 0 },
			children: [new TextRun({ text: 'INVOICE', bold: true, size: HEADING })]
		}),
		new Table({
			width: { size: CONTENT_WIDTH, type: WidthType.DXA },
			borders: noBorders,
			rows: [
				new TableRow({
					children: [
						metaCell('Invoice #', ctx.invoiceNumber, HALF_COL),
						metaCell('Date', invoiceDate, HALF_COL)
					]
				}),
				new TableRow({
					children: [
						metaCell('Due', dueDateStr, HALF_COL),
						metaCell('Terms', `${dueDays} days`, HALF_COL)
					]
				})
			]
		}),
		new Paragraph({ spacing: { after: SECTION }, text: '' }),
		new Table({
			width: { size: CONTENT_WIDTH, type: WidthType.DXA },
			borders: noBorders,
			rows: [
				new TableRow({
					children: [
						labeledAddressCell('Bill To', billToLines, HALF_COL, 120),
						labeledAddressCell('Service Location', serviceLines, HALF_COL)
					]
				})
			]
		}),
		new Paragraph({ spacing: { after: SECTION }, text: '' }),
		new Paragraph({
			spacing: { after: 30, before: 0 },
			children: [
				new TextRun({ text: 'Service date: ', bold: true, size: BODY }),
				new TextRun({ text: `${serviceDate}${serviceEnd}`, size: BODY })
			]
		}),
		new Paragraph({
			spacing: { after: SECTION, before: 0 },
			children: [
				new TextRun({ text: 'Job: ', bold: true, size: BODY }),
				new TextRun({ text: job.title || 'Window cleaning service', size: BODY })
			]
		}),
		...(ctx.businessSalesTaxAccount
			? [
					new Paragraph({
						spacing: { after: TIGHT, before: 0 },
						children: [
							new TextRun({
								text: `CBJ Sales Tax Acct: ${ctx.businessSalesTaxAccount}`,
								size: BODY
							})
						]
					})
				]
			: []),
		new Table({
			width: { size: CONTENT_WIDTH, type: WidthType.DXA },
			rows: [
				new TableRow({
					children: [
						cell('Description', undefined, COL_DESC),
						cell('Qty', AlignmentType.RIGHT, COL_QTY),
						cell('Unit', AlignmentType.RIGHT, COL_UNIT),
						cell('Total', AlignmentType.RIGHT, COL_TOTAL)
					]
				}),
				...billableRows,
				new TableRow({
					children: [
						cell('Subtotal', undefined, COL_DESC),
						cell('', AlignmentType.RIGHT, COL_QTY),
						cell('', AlignmentType.RIGHT, COL_UNIT),
						cell(`$${subtotal.toFixed(2)}`, AlignmentType.RIGHT, COL_TOTAL)
					]
				}),
				new TableRow({
					children: [
						cell(`${taxLabel} (${taxPct.toFixed(1)}%)`, undefined, COL_DESC),
						cell('', AlignmentType.RIGHT, COL_QTY),
						cell('', AlignmentType.RIGHT, COL_UNIT),
						cell(`$${taxAmount.toFixed(2)}`, AlignmentType.RIGHT, COL_TOTAL)
					]
				}),
				new TableRow({
					children: [
						cell('TOTAL', undefined, COL_DESC),
						cell('', AlignmentType.RIGHT, COL_QTY),
						cell('', AlignmentType.RIGHT, COL_UNIT),
						cell(`$${total.toFixed(2)}`, AlignmentType.RIGHT, COL_TOTAL)
					]
				})
			]
		}),
		new Paragraph({ spacing: { after: TIGHT }, text: '' }),
		new Paragraph({
			spacing: { after: TIGHT },
			children: [
				new TextRun({
					text: `Amount due by ${dueDateStr}: $${total.toFixed(2)}`,
					bold: true,
					size: HEADING
				})
			]
		}),
		new Paragraph({
			spacing: { after: 20 },
			children: [new TextRun({ text: 'Payment', bold: true, size: LABEL })]
		}),
		...paymentLines.map(
			(line) =>
				new Paragraph({
					spacing: { after: 20, before: 0 },
					children: [new TextRun({ text: line, size: BODY })]
				})
		),
		new Paragraph({
			spacing: { after: TIGHT, before: 0 },
			children: [
				new TextRun({
					text: `Thank you for choosing ${businessName}!`,
					size: BODY
				})
			]
		}),
		...(ctx.invoiceNotes?.trim()
			? [
					new Paragraph({
						spacing: { after: 20, before: TIGHT },
						children: [new TextRun({ text: 'Invoice Notes', bold: true, size: LABEL })]
					}),
					new Paragraph({
						spacing: { after: TIGHT, before: 0 },
						children: [new TextRun({ text: ctx.invoiceNotes.trim(), size: BODY })]
					})
				]
			: [])
	];

	const doc = new Document({
		sections: [
			{
				properties: {
					page: {
						margin: {
							top: 180,
							right: 720,
							bottom: 180,
							left: ENVELOPE_LEFT_MARGIN
						}
					}
				},
				children: [
					new Table({
						width: { size: CONTENT_WIDTH, type: WidthType.DXA },
						borders: noBorders,
						rows: [
							new TableRow({
								...exactRow(ENVELOPE_RETURN_ROW_H),
								children: [envelopeAddressCell(returnLines, true)]
							}),
							new TableRow({
								children: [
									new TableCell({
										verticalAlign: VerticalAlign.TOP,
										margins: { top: 120, bottom: 120, left: 0, right: 0 },
										children: middleContent
									})
								]
							}),
							new TableRow({
								...exactRow(ENVELOPE_RECIPIENT_ROW_H),
								children: [envelopeAddressCell(recipientLines)]
							})
						]
					})
				]
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
		invoiceDueDays: opts.invoiceDueDays as number | undefined
	};
}