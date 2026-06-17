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
const TIGHT = 30;
const LOOSE = 60;

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
		VerticalAlign
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
	const clientContact = [client?.phone, client?.email].filter(Boolean).join(' • ');

	const businessLines: string[] = [businessName];
	if (ctx.businessStreet) businessLines.push(ctx.businessStreet);
	const bizCsz = formatCityStateZip(ctx.businessCity, ctx.businessState, ctx.businessZip);
	if (bizCsz.trim()) businessLines.push(bizCsz);
	if (ctx.businessPhone) businessLines.push(ctx.businessPhone);
	if (ctx.businessEmail) businessLines.push(ctx.businessEmail);
	if (ctx.businessWebsite) businessLines.push(ctx.businessWebsite);
	if (ctx.businessSalesTaxAccount)
		businessLines.push(`CBJ Sales Tax Acct: ${ctx.businessSalesTaxAccount}`);

	const paymentLines = buildPaymentInstructions(client, ctx);

	const cell = (text: string, align?: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
		new TableCell({
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

	const headerCell = (lines: string[], boldFirst = false) =>
		new TableCell({
			verticalAlign: VerticalAlign.TOP,
			width: { size: 50, type: WidthType.PERCENTAGE },
			margins: { top: 40, bottom: 40, left: 60, right: 80 },
			children: lines.map((line, i) =>
				new Paragraph({
					spacing: { after: 20, before: 0 },
					children: [
						new TextRun({
							text: line,
							size: i === 0 && boldFirst ? HEADING : BODY,
							bold: i === 0 && boldFirst
						})
					]
				})
			)
		});

	const metaLines = [
		'INVOICE',
		`Invoice #: ${ctx.invoiceNumber}`,
		`Invoice date: ${invoiceDate}`,
		`Due date: ${dueDateStr}`,
		`Terms: Due within ${dueDays} days`,
		`Service date: ${serviceDate}${serviceEnd}`,
		`Job: ${job.title || 'Window cleaning service'}`
	];

	const billToLines = ['Bill To', clientName];
	if (billTo.street) billToLines.push(billTo.street);
	if (billTo.csz.trim()) billToLines.push(billTo.csz);
	if (clientContact) billToLines.push(clientContact);

	const billableRows = (job.billableItems || []).map((item: any, idx: number) =>
		new TableRow({
			children: [
				cell(item.title || `Item ${idx + 1}`),
				cell(String(item.quantity || 1), AlignmentType.RIGHT),
				cell(`$${(item.price || 0).toFixed(2)}`, AlignmentType.RIGHT),
				cell(`$${(item.total || 0).toFixed(2)}`, AlignmentType.RIGHT)
			]
		})
	);

	const subtotal = job.subtotal ?? 0;
	const taxAmount = job.taxAmount ?? 0;
	const total = job.totalAmount ?? 0;

	const doc = new Document({
		sections: [
			{
				properties: {
					page: {
						margin: { top: 720, right: 720, bottom: 720, left: 720 }
					}
				},
				children: [
					new Table({
						width: { size: 100, type: WidthType.PERCENTAGE },
						borders: {
							top: { style: 'none', size: 0 },
							bottom: { style: 'none', size: 0 },
							left: { style: 'none', size: 0 },
							right: { style: 'none', size: 0 },
							insideHorizontal: { style: 'none', size: 0 },
							insideVertical: { style: 'none', size: 0 }
						},
						rows: [
							new TableRow({
								children: [headerCell(businessLines, true), headerCell(metaLines, true)]
							})
						]
					}),
					new Paragraph({ spacing: { after: TIGHT }, text: '' }),
					new Table({
						width: { size: 100, type: WidthType.PERCENTAGE },
						borders: {
							top: { style: 'none', size: 0 },
							bottom: { style: 'none', size: 0 },
							left: { style: 'none', size: 0 },
							right: { style: 'none', size: 0 },
							insideHorizontal: { style: 'none', size: 0 },
							insideVertical: { style: 'none', size: 0 }
						},
						rows: [
							new TableRow({
								children: [
									headerCell(billToLines),
									headerCell(
										serviceLoc.street
											? ['Service Location', serviceLoc.street, serviceLoc.csz.trim() || '—']
											: ['Service Location', '—']
									)
								]
							})
						]
					}),
					new Paragraph({ spacing: { after: LOOSE }, text: '' }),
					new Paragraph({
						spacing: { after: TIGHT },
						children: [new TextRun({ text: 'Services', bold: true, size: LABEL })]
					}),
					new Table({
						width: { size: 100, type: WidthType.PERCENTAGE },
						rows: [
							new TableRow({
								children: [
									cell('Description'),
									cell('Qty', AlignmentType.RIGHT),
									cell('Unit', AlignmentType.RIGHT),
									cell('Total', AlignmentType.RIGHT)
								]
							}),
							...billableRows,
							new TableRow({
								children: [
									cell('Subtotal'),
									cell('', AlignmentType.RIGHT),
									cell('', AlignmentType.RIGHT),
									cell(`$${subtotal.toFixed(2)}`, AlignmentType.RIGHT)
								]
							}),
							new TableRow({
								children: [
									cell(`${taxLabel} (${taxPct.toFixed(1)}%)`),
									cell('', AlignmentType.RIGHT),
									cell('', AlignmentType.RIGHT),
									cell(`$${taxAmount.toFixed(2)}`, AlignmentType.RIGHT)
								]
							}),
							new TableRow({
								children: [
									cell('TOTAL'),
									cell('', AlignmentType.RIGHT),
									cell('', AlignmentType.RIGHT),
									cell(`$${total.toFixed(2)}`, AlignmentType.RIGHT)
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
									spacing: { after: 20, before: LOOSE },
									children: [new TextRun({ text: 'Invoice Notes', bold: true, size: LABEL })]
								}),
								new Paragraph({
									spacing: { after: TIGHT, before: 0 },
									children: [new TextRun({ text: ctx.invoiceNotes.trim(), size: BODY })]
								})
							]
						: [])
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