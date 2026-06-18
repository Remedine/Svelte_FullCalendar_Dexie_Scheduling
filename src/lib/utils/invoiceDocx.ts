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

/** Twips (dxa): 1440 per inch. */
const TWIP = 1440;
const PAGE_WIDTH = Math.round(8.5 * TWIP);
const PAGE_HEIGHT = Math.round(11 * TWIP);
/**
 * #10 double-window envelope (tri-fold: bottom third up, top third down).
 * Return + recipient must live in the top 3⅔" panel so they show through both windows.
 * @see https://www.postalmethods.com/envelope-information/
 */
const ENVELOPE_LEFT_MARGIN = Math.round(0.875 * TWIP);
const MARGIN_RIGHT = 720; // 0.5"
/** Return address zone: 0.5" from sheet top. Recipient zone: 2.3125" (2⁵⁄₁₆") from sheet top. */
const ENVELOPE_RETURN_OFFSET = Math.round(0.5 * TWIP);
const ENVELOPE_MAIL_TO_TOP = Math.round(2.3125 * TWIP);
/** Window fits ~4.5" × 1" of address lines — keep recipient block inside this column. */
const ENVELOPE_WINDOW_WIDTH = Math.round(4.5 * TWIP);
/** Minimal vertical margins so tri-fold panels use the full 11" sheet. */
const MARGIN_TOP = 0;
const MARGIN_BOTTOM = 0;
/** Printable content width (letter minus envelope left + right margins). */
const CONTENT_WIDTH = PAGE_WIDTH - ENVELOPE_LEFT_MARGIN - MARGIN_RIGHT;
const INVOICE_COL = CONTENT_WIDTH - ENVELOPE_WINDOW_WIDTH;
/** Line-item table columns (fixed dxa — required for Google Docs). */
const COL_DESC = Math.round(CONTENT_WIDTH * 0.52);
const COL_QTY = Math.round(CONTENT_WIDTH * 0.12);
const COL_UNIT = Math.round(CONTENT_WIDTH * 0.16);
const COL_TOTAL = CONTENT_WIDTH - COL_DESC - COL_QTY - COL_UNIT;
/** Printable height and exact tri-fold thirds (11" ÷ 3 per panel). */
const USABLE_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
const PANEL_HEIGHT = Math.floor(USABLE_HEIGHT / 3);

/** Recipient block top offset on unfolded sheet (inches) for #10 lower window after tri-fold. */
export function envelopeRecipientTopInches(): number {
	return ENVELOPE_MAIL_TO_TOP / TWIP;
}

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

type DocxModule = Awaited<ReturnType<typeof importDocx>>;
type Alignment = (typeof import('docx'))['AlignmentType'][keyof (typeof import('docx'))['AlignmentType']];

/**
 * Generate a one-page invoice .docx for #10 double-window tri-fold mailing.
 * Top third: #10 window return + recipient (fixed rows, left), invoice + service (right).
 * Remainder: line items, payment, and right-justified total on one page.
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
	const serviceLoc = getClientServiceAddress(client);
	const returnLines = getBusinessReturnAddressLines(ctx);
	const recipientLines = getRecipientMailingLines(client, clientName);
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
		opts?: {
			align?: Alignment;
			spacingAfter?: number;
			spacingBefore?: number;
			shading?: { fill: string; type: (typeof ShadingType)[keyof typeof ShadingType] };
			border?: {
				top?: typeof lineBorder;
				bottom?: typeof lineBorder;
				left?: typeof lineBorder;
				right?: typeof lineBorder;
			};
		}
	) =>
		new Paragraph({
			alignment: opts?.align,
			spacing: {
				after: opts?.spacingAfter ?? 40,
				before: opts?.spacingBefore ?? 0
			},
			...(opts?.shading ? { shading: opts.shading } : {}),
			...(opts?.border ? { border: opts.border } : {}),
			children
		});

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
			verticalAlign?: (typeof VerticalAlign)[keyof typeof VerticalAlign];
			margins?: { top?: number; bottom?: number; left?: number; right?: number };
		}
	) =>
		new TableCell({
			width: { size: widthTwips, type: WidthType.DXA },
			verticalAlign: opts?.verticalAlign ?? VerticalAlign.TOP,
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

	const addressLines = (
		lines: string[],
		opts?: { boldFirst?: boolean; firstSpacingBefore?: number }
	) =>
		lines.map((line, i) =>
			para([run(line, { bold: opts?.boldFirst && i === 0, size: FONT_ENVELOPE })], {
				spacingAfter: i === lines.length - 1 ? 0 : 40,
				spacingBefore: i === 0 ? (opts?.firstSpacingBefore ?? 0) : 0
			})
		);

	const flushCell = (
		widthTwips: number,
		children: (InstanceType<DocxModule['Paragraph']> | InstanceType<DocxModule['Table']>)[],
		verticalAlign?: (typeof VerticalAlign)[keyof typeof VerticalAlign]
	) =>
		makeCell(widthTwips, children, {
			verticalAlign,
			margins: { top: 0, bottom: 0, left: 0, right: 0 }
		});

	const serviceLines = [serviceLoc.street, serviceLoc.csz].filter((l) => l.trim().length > 0);
	if (serviceLines.length === 0) serviceLines.push('—');

	const contactLine = (label: string, value: string) =>
		para([run(`${label}: ${value}`)], { align: AlignmentType.RIGHT, spacingAfter: 40 });

	const invoiceBoxBorder = {
		top: lineBorder,
		bottom: lineBorder,
		left: lineBorder,
		right: lineBorder
	};

	/** Invoice metadata under the document title (no "Details" heading). */
	const invoiceMetaBlock = [
		para([run(`Invoice# ${ctx.invoiceNumber}`, { bold: true })], {
			align: AlignmentType.RIGHT,
			spacingAfter: 20,
			border: invoiceBoxBorder
		}),
		para([run(`Service date: ${serviceDate}${serviceEnd}`)], {
			align: AlignmentType.RIGHT,
			spacingAfter: 40
		}),
		para([run(`Invoice date: ${invoiceDate}`)], {
			align: AlignmentType.RIGHT,
			spacingAfter: 40
		}),
		para(
			[
				run('Due date: ', { bold: true }),
				run(dueDateStr, { bold: true })
			],
			{
				align: AlignmentType.RIGHT,
				spacingAfter: 40,
				shading: { fill: 'FFF3CD', type: ShadingType.CLEAR }
			}
		),
		...(ctx.businessSalesTaxAccount
			? [
					para([run(`CBJ Sales Tax Acct: ${ctx.businessSalesTaxAccount}`)], {
						align: AlignmentType.RIGHT,
						spacingAfter: 40
					})
				]
			: [])
	];

	const exactRow = (heightTwips: number) => ({
		height: { value: heightTwips, rule: HeightRule.EXACT }
	});

	const serviceBlock = [
		para([run('Service location', { bold: true, size: FONT_LABEL })], {
			align: AlignmentType.CENTER,
			spacingAfter: 40
		}),
		...serviceLines.map((line) =>
			para([run(line)], { align: AlignmentType.CENTER, spacingAfter: 40 })
		)
	];

	/**
	 * Top tri-fold panel: left column is ONLY #10 window content (return row, then recipient row
	 * at a fixed 2.3125" crease). No labels inside the recipient window — address lines only.
	 */
	const topFoldTable = makeTable(
		[ENVELOPE_WINDOW_WIDTH, INVOICE_COL],
		[
			new TableRow({
				...exactRow(ENVELOPE_MAIL_TO_TOP),
				children: [
					flushCell(
						ENVELOPE_WINDOW_WIDTH,
						addressLines(returnLines, {
							boldFirst: true,
							firstSpacingBefore: ENVELOPE_RETURN_OFFSET
						})
					),
					flushCell(INVOICE_COL, [
						para([run('Invoice', { bold: true, size: FONT_TITLE })], {
							align: AlignmentType.RIGHT,
							spacingAfter: 40
						}),
						...invoiceMetaBlock
					])
				]
			}),
			new TableRow({
				children: [
					flushCell(ENVELOPE_WINDOW_WIDTH, addressLines(recipientLines)),
					flushCell(INVOICE_COL, [
						...serviceBlock,
						...(ctx.businessPhone?.trim()
							? [contactLine('Phone', ctx.businessPhone.trim())]
							: []),
						...(ctx.businessEmail?.trim()
							? [contactLine('Email', ctx.businessEmail.trim())]
							: []),
						...(ctx.businessWebsite?.trim()
							? [contactLine('Website', ctx.businessWebsite.trim())]
							: [])
					])
				]
			})
		]
	);

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
			spacingAfter: 40,
			spacingBefore: TIGHT
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
		para([run(`Total   $${total.toFixed(2)}`, { bold: true, size: FONT_TOTAL, color: COLOR_MUTED })], {
			align: AlignmentType.RIGHT,
			spacingBefore: TIGHT,
			spacingAfter: 20
		}),
		para([run(`Amount due by ${dueDateStr}`, { bold: true, color: COLOR_MUTED })], {
			align: AlignmentType.RIGHT,
			spacingAfter: 0
		})
	];

	const paymentTable = makeTable(
		[CONTENT_WIDTH],
		[
			new TableRow({
				children: [
					flushCell(CONTENT_WIDTH, paymentBlock)
				]
			})
		]
	);

	const totalsTable = makeTable(
		[CONTENT_WIDTH],
		[
			new TableRow({
				children: [flushCell(CONTENT_WIDTH, totalsBlock)]
			})
		]
	);

	// Top third = #10 envelope windows; remainder = line items + payment + total (full-width right).
	const bodyPanel = [lineItemsTable, paymentTable, totalsTable];

	const pageTable = makeTable(
		[CONTENT_WIDTH],
		[
			new TableRow({
				...exactRow(PANEL_HEIGHT),
				children: [
					flushCell(CONTENT_WIDTH, [topFoldTable])
				]
			}),
			new TableRow({
				children: [
					makeCell(CONTENT_WIDTH, bodyPanel, {
						margins: { top: 40, bottom: 60, left: 0, right: 0 }
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