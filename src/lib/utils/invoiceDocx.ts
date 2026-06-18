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

const FONT = 'Arial';
const FONT_BODY = 20; // 10pt — matches contractor template
const FONT_LABEL = 20;
const FONT_TITLE = 68; // 34pt "Invoice" heading
const FONT_TOTAL = 32; // 16pt total line
const FONT_ENVELOPE = 20;
const COLOR_MUTED = '2B2C2F';
const TIGHT = 60;
const SECTION = 120;
const LOOSE = 200;

/** Twips (dxa): 1440 per inch. */
const TWIP = 1440;
const PAGE_WIDTH = Math.round(8.5 * TWIP);
const PAGE_HEIGHT = Math.round(11 * TWIP);
/** Left margin aligned with common 1-1/8" double-window envelope offset. */
const ENVELOPE_LEFT_MARGIN = Math.round(1.125 * TWIP);
const MARGIN_RIGHT = 720; // 0.5"
/** Minimal vertical margins so tri-fold panels use the full 11" sheet. */
const MARGIN_TOP = 0;
const MARGIN_BOTTOM = 0;
/** Printable content width (letter minus envelope left + right margins). */
const CONTENT_WIDTH = PAGE_WIDTH - ENVELOPE_LEFT_MARGIN - MARGIN_RIGHT;
const HALF_COL = Math.round(CONTENT_WIDTH / 2);
/** Line-item table columns (fixed dxa — required for Google Docs). */
const COL_DESC = Math.round(CONTENT_WIDTH * 0.52);
const COL_QTY = Math.round(CONTENT_WIDTH * 0.12);
const COL_UNIT = Math.round(CONTENT_WIDTH * 0.16);
const COL_TOTAL = CONTENT_WIDTH - COL_DESC - COL_QTY - COL_UNIT;
const COL_PAYMENT = Math.round(CONTENT_WIDTH * 0.58);
const COL_TOTALS = CONTENT_WIDTH - COL_PAYMENT;
/** Printable height and exact tri-fold thirds (11" ÷ 3 per panel). */
const USABLE_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
const PANEL_HEIGHT = Math.floor(USABLE_HEIGHT / 3);

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

function formatBusinessAddressLines(info: InvoiceDocxBusinessInfo): string[] {
	const street = info.businessStreet?.trim();
	const csz = formatCityStateZip(info.businessCity, info.businessState, info.businessZip);
	const lines: string[] = [];
	if (street) lines.push(street);
	if (csz.trim()) lines.push(csz.trim());
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

type DocxModule = Awaited<ReturnType<typeof importDocx>>;
type Alignment = (typeof import('docx'))['AlignmentType'][keyof (typeof import('docx'))['AlignmentType']];

/**
 * Generate a one-page invoice .docx for #10 double-window tri-fold mailing.
 * Top third: return + mail-to addresses; middle/bottom thirds: contractor-style invoice body.
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
		BorderStyle,
		ShadingType,
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
	const businessAddressLines = formatBusinessAddressLines(ctx);
	const paymentLines = buildPaymentInstructions(client, ctx);

	const noBorders = {
		top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
		insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' }
	};

	const lineBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
	const lineBorders = {
		top: lineBorder,
		bottom: lineBorder,
		left: lineBorder,
		right: lineBorder,
		insideHorizontal: lineBorder,
		insideVertical: lineBorder
	};
	type CellBorders = NonNullable<Parameters<DocxModule['TableCell']>[0]>['borders'];

	const run = (
		text: string,
		opts?: { bold?: boolean; size?: number; color?: string }
	) =>
		new TextRun({
			text,
			font: FONT,
			bold: opts?.bold,
			size: opts?.size ?? FONT_BODY,
			color: opts?.color
		});

	const para = (
		children: InstanceType<DocxModule['TextRun']>[],
		opts?: { align?: Alignment; spacingAfter?: number; spacingBefore?: number }
	) =>
		new Paragraph({
			alignment: opts?.align,
			spacing: {
				after: opts?.spacingAfter ?? 40,
				before: opts?.spacingBefore ?? 0
			},
			children
		});

	const spacer = (after = SECTION) => new Paragraph({ spacing: { after }, text: '' });

	const makeTable = (
		columnWidths: number[],
		rows: InstanceType<DocxModule['TableRow']>[],
		borders = noBorders
	) =>
		new Table({
			width: { size: columnWidths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
			columnWidths,
			borders,
			rows
		});

	const makeCell = (
		widthTwips: number,
		children: (InstanceType<DocxModule['Paragraph']> | InstanceType<DocxModule['Table']>)[],
		opts?: {
			align?: Alignment;
			borders?: CellBorders;
			shading?: string;
			margins?: { top?: number; bottom?: number; left?: number; right?: number };
		}
	) =>
		new TableCell({
			width: { size: widthTwips, type: WidthType.DXA },
			verticalAlign: VerticalAlign.TOP,
			...(opts?.borders ? { borders: opts.borders } : {}),
			...(opts?.shading
				? { shading: { fill: opts.shading, type: ShadingType.CLEAR } }
				: {}),
			margins: {
				top: opts?.margins?.top ?? 80,
				bottom: opts?.margins?.bottom ?? 80,
				left: opts?.margins?.left ?? 120,
				right: opts?.margins?.right ?? 120
			},
			children
		});

	const textCell = (
		text: string,
		widthTwips: number,
		opts?: { align?: Alignment; bold?: boolean; shading?: string; borders?: CellBorders }
	) =>
		makeCell(
			widthTwips,
			[
				para([run(text, { bold: opts?.bold })], {
					align: opts?.align,
					spacingAfter: 20
				})
			],
			opts
		);

	const labeledBlock = (label: string, lines: string[], widthTwips: number, rightPad = 0) =>
		makeCell(
			widthTwips,
			[
				para([run(label, { bold: true, size: FONT_LABEL })], { spacingAfter: 60 }),
				...lines.map((line) => para([run(line)], { spacingAfter: 40 }))
			],
			{ margins: { top: 0, bottom: 0, left: 0, right: rightPad } }
		);

	const addressLines = (lines: string[], boldFirst = false) =>
		lines.map((line, i) =>
			para([run(line, { bold: boldFirst && i === 0, size: FONT_ENVELOPE })], {
				spacingAfter: 60
			})
		);

	/** Top tri-fold panel: return address (upper window) + mail-to (lower window). */
	const topFoldPanel = [
		...addressLines(returnLines, true),
		spacer(360),
		para([run('Mail to:', { bold: true, size: FONT_ENVELOPE })], { spacingAfter: 60 }),
		...addressLines(recipientLines)
	];

	const exactRow = (heightTwips: number) => ({
		height: { value: heightTwips, rule: HeightRule.EXACT }
	});

	const billToLines = [clientName, billTo.street, billTo.csz].filter((l) => l.trim().length > 0);
	const serviceLines = [serviceLoc.street, serviceLoc.csz].filter((l) => l.trim().length > 0);
	if (serviceLines.length === 0) serviceLines.push('—');

	const companyLines = [
		para([run(businessName, { bold: true, size: FONT_LABEL })], { spacingAfter: 60 }),
		...businessAddressLines.map((line) => para([run(line)], { spacingAfter: 40 }))
	];

	const contactLine = (label: string, value: string) =>
		para([run(`${label}: ${value}`)], { align: AlignmentType.RIGHT, spacingAfter: 40 });

	const headerTable = makeTable(
		[HALF_COL, HALF_COL],
		[
			new TableRow({
				children: [
					makeCell(HALF_COL, companyLines, { margins: { top: 0, bottom: 0, left: 0, right: 160 } }),
					makeCell(
						HALF_COL,
						[
							para([run('Invoice', { bold: true, size: FONT_TITLE })], {
								align: AlignmentType.RIGHT,
								spacingAfter: 80
							}),
							...(ctx.businessPhone?.trim()
								? [contactLine('Phone', ctx.businessPhone.trim())]
								: []),
							...(ctx.businessEmail?.trim()
								? [contactLine('Email', ctx.businessEmail.trim())]
								: []),
							...(ctx.businessWebsite?.trim()
								? [contactLine('Website', ctx.businessWebsite.trim())]
								: [])
						],
						{ margins: { top: 0, bottom: 0, left: 0, right: 0 } }
					)
				]
			})
		]
	);

	const addressTable = makeTable(
		[HALF_COL, HALF_COL],
		[
			new TableRow({
				children: [
					labeledBlock('Bill to', billToLines, HALF_COL, 160),
					labeledBlock('Service location', serviceLines, HALF_COL)
				]
			})
		]
	);

	const detailsBlock = [
		para([run('Details', { bold: true, size: FONT_LABEL })], { spacingAfter: 60 }),
		para([run(`Invoice# ${ctx.invoiceNumber}`)], { spacingAfter: 40 }),
		para([run(`Invoice date: ${invoiceDate}`)], { spacingAfter: 40 }),
		para([run(`Terms: Net ${dueDays}`)], { spacingAfter: 40 }),
		para([run(`Due date: ${dueDateStr}`)], { spacingAfter: 40 }),
		para([run(`Service date: ${serviceDate}${serviceEnd}`)], { spacingAfter: 40 }),
		para([run(`Job: ${job.title || 'Window cleaning service'}`)], { spacingAfter: 40 }),
		...(ctx.businessSalesTaxAccount
			? [para([run(`CBJ Sales Tax Acct: ${ctx.businessSalesTaxAccount}`)], { spacingAfter: 40 })]
			: [])
	];

	const billableRows = (job.billableItems || []).map((item: any, idx: number) =>
		new TableRow({
			children: [
				textCell(item.title || `Item ${idx + 1}`, COL_DESC),
				textCell(String(item.quantity || 1), COL_QTY, { align: AlignmentType.RIGHT }),
				textCell(`$${(item.price || 0).toFixed(2)}`, COL_UNIT, { align: AlignmentType.RIGHT }),
				textCell(`$${(item.total || 0).toFixed(2)}`, COL_TOTAL, { align: AlignmentType.RIGHT })
			]
		})
	);

	const subtotal = job.subtotal ?? 0;
	const taxAmount = job.taxAmount ?? 0;
	const total = job.totalAmount ?? 0;

	const lineItemsTable = makeTable(
		[COL_DESC, COL_QTY, COL_UNIT, COL_TOTAL],
		[
			new TableRow({
				children: [
					textCell('Description', COL_DESC, { bold: true, shading: 'F3F3F3', borders: lineBorders }),
					textCell('Qty', COL_QTY, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: 'F3F3F3',
						borders: lineBorders
					}),
					textCell('Rate', COL_UNIT, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: 'F3F3F3',
						borders: lineBorders
					}),
					textCell('Amount', COL_TOTAL, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: 'F3F3F3',
						borders: lineBorders
					})
				]
			}),
			...billableRows,
			new TableRow({
				children: [
					textCell('Subtotal', COL_DESC, { borders: lineBorders }),
					textCell('', COL_QTY, { borders: lineBorders }),
					textCell('', COL_UNIT, { borders: lineBorders }),
					textCell(`$${subtotal.toFixed(2)}`, COL_TOTAL, {
						align: AlignmentType.RIGHT,
						borders: lineBorders
					})
				]
			}),
			new TableRow({
				children: [
					textCell(`${taxLabel} (${taxPct.toFixed(1)}%)`, COL_DESC, { borders: lineBorders }),
					textCell('', COL_QTY, { borders: lineBorders }),
					textCell('', COL_UNIT, { borders: lineBorders }),
					textCell(`$${taxAmount.toFixed(2)}`, COL_TOTAL, {
						align: AlignmentType.RIGHT,
						borders: lineBorders
					})
				]
			})
		],
		lineBorders
	);

	const paymentBlock = [
		para([run('Payment', { bold: true, size: FONT_LABEL, color: COLOR_MUTED })], {
			spacingAfter: 60
		}),
		...paymentLines.map((line) =>
			para([run(line, { color: COLOR_MUTED })], { spacingAfter: 40 })
		),
		para([run(`Thank you very much for your business 
			
			Brick A. Engstrom
			907.723.4617`, { color: COLOR_MUTED })], {
			spacingAfter: 40,
			spacingBefore: TIGHT
		}),
		...(ctx.invoiceNotes?.trim()
			? [
					para([run('Invoice notes', { bold: true, size: FONT_LABEL, color: COLOR_MUTED })], {
						spacingAfter: 40,
						spacingBefore: TIGHT
					}),
					para([run(ctx.invoiceNotes.trim(), { color: COLOR_MUTED })], { spacingAfter: 40 })
				]
			: [])
	];

	const totalsBlock = [
		para(
			[
				run('Total        ', { bold: true, size: FONT_TOTAL, color: COLOR_MUTED }),
				run(`$${total.toFixed(2)}`, { bold: true, size: FONT_TOTAL, color: COLOR_MUTED })
			],
			{ align: AlignmentType.RIGHT, spacingBefore: LOOSE }
		),
		para(
			[run(`Amount due by ${dueDateStr}`, { bold: true, color: COLOR_MUTED })],
			{ align: AlignmentType.RIGHT, spacingAfter: 20 }
		)
	];

	const footerTable = makeTable(
		[COL_PAYMENT, COL_TOTALS],
		[
			new TableRow({
				children: [
					makeCell(COL_PAYMENT, paymentBlock, { margins: { top: 0, bottom: 0, left: 0, right: 160 } }),
					makeCell(COL_TOTALS, totalsBlock, { margins: { top: 0, bottom: 0, left: 0, right: 0 } })
				]
			})
		]
	);

	// Full-sheet tri-fold: top third = envelope addresses, middle + bottom = invoice body.
	const middlePanel = [
		headerTable,
		spacer(),
		addressTable,
		spacer(),
		...detailsBlock
	];

	const bottomPanel = [lineItemsTable, spacer(), footerTable];

	const pageTable = makeTable(
		[CONTENT_WIDTH],
		[
			new TableRow({
				...exactRow(PANEL_HEIGHT),
				children: [
					makeCell(CONTENT_WIDTH, topFoldPanel, {
						margins: { top: 200, bottom: 120, left: 0, right: 0 }
					})
				]
			}),
			new TableRow({
				...exactRow(PANEL_HEIGHT),
				children: [
					makeCell(CONTENT_WIDTH, middlePanel, {
						margins: { top: 120, bottom: 80, left: 0, right: 0 }
					})
				]
			}),
			new TableRow({
				...exactRow(PANEL_HEIGHT),
				children: [
					makeCell(CONTENT_WIDTH, bottomPanel, {
						margins: { top: 80, bottom: 120, left: 0, right: 0 }
					})
				]
			})
		]
	);

	const children = [pageTable];

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
				children
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