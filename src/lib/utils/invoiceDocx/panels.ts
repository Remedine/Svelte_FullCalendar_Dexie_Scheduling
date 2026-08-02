import type { Job } from '$lib/db';
import type { InvoiceBillableItem, InvoiceDiscount } from '$lib/utils/invoiceTypes';
import type { InvoiceDocxBuilder } from './builder';
import type { InvoiceLayoutId } from './invoiceLayouts';
import { normalizeInvoiceLayout } from './invoiceLayouts';
import {
	COLOR_INK,
	COLOR_MUTED,
	CONTENT_WIDTH,
	DEFAULT_SIGNATORY,
	ENVELOPE_MAIL_TO_TOP,
	ENVELOPE_RETURN_OFFSET,
	ENVELOPE_WINDOW_WIDTH,
	FONT_HERO,
	FONT_LABEL,
	FONT_SECTION,
	FONT_TITLE,
	FONT_TOTAL,
	INVOICE_COL,
	NOTES_GAP,
	SECTION_GAP,
	TOP_ADDRESS_PANEL_HEIGHT,
	TIGHT,
	TOTALS_BOX_WIDTH,
	COL_DESC,
	COL_QTY,
	COL_UNIT,
	COL_TOTAL
} from './layout';
import type { InvoiceDocxContext } from './types';

export interface TopFoldInput {
	returnLines: string[];
	recipientLines: string[];
	serviceLines: string[];
	envelopePreview: boolean;
	/** pay_first shows amount due in the header. */
	totalAmount?: number;
}

export interface TopFoldMeta {
	serviceDate: string;
	serviceEnd: string;
	invoiceDate: string;
	dueDateStr: string;
}

export interface LineItemsOptions {
	/** Include subtotal + tax rows inside the table (quiet default). */
	includeTaxRows?: boolean;
	headerShading?: string;
	/** Optional section heading above the table (e.g. Work performed). */
	sectionTitle?: string;
}

type DocxChild =
	| ReturnType<InvoiceDocxBuilder['para']>
	| ReturnType<InvoiceDocxBuilder['makeTable']>;

function envelopeReturnCell(b: InvoiceDocxBuilder, lines: string[], preview: boolean) {
	return b.makeCell(
		ENVELOPE_WINDOW_WIDTH,
		[
			...(preview
				? [
						b.para([b.run('RETURN WINDOW (dev preview)', { size: 16, color: 'CC0000' })], {
							spacingAfter: 20
						})
					]
				: []),
			...b.addressLines(lines, {
				boldFirst: true,
				firstSpacingBefore: ENVELOPE_RETURN_OFFSET
			})
		],
		{
			margins: { top: 0, bottom: 0, left: 0, right: 0 },
			...(preview
				? { borders: b.previewWindowBorders('CC0000'), shading: 'FFF5F5' }
				: {})
		}
	);
}

function envelopeRecipientCell(b: InvoiceDocxBuilder, lines: string[], preview: boolean) {
	const RECIPIENT_INNER_BEFORE = 80;
	return b.makeCell(
		ENVELOPE_WINDOW_WIDTH,
		[
			...(preview
				? [
						b.para([b.run('RECIPIENT WINDOW (dev preview)', { size: 16, color: '0066CC' })], {
							spacingAfter: 20
						})
					]
				: []),
			...b.addressLines(lines, { firstSpacingBefore: RECIPIENT_INNER_BEFORE })
		],
		{
			margins: { top: 0, bottom: 0, left: 0, right: 0 },
			...(preview
				? { borders: b.previewWindowBorders('0066CC'), shading: 'F0F8FF' }
				: {})
		}
	);
}

function buildMetaColumn(
	b: InvoiceDocxBuilder,
	ctx: InvoiceDocxContext,
	meta: TopFoldMeta,
	layout: InvoiceLayoutId,
	totalAmount?: number
) {
	const { AlignmentType, ShadingType } = b;
	const invoiceBoxBorder = {
		top: b.lineBorder,
		bottom: b.lineBorder,
		left: b.lineBorder,
		right: b.lineBorder
	};

	const children = [
		b.para([b.run('Invoice', { bold: true, size: FONT_TITLE })], {
			align: AlignmentType.RIGHT,
			spacingAfter: 40
		}),
		b.para([b.run(`Invoice# ${ctx.invoiceNumber}`, { bold: true })], {
			align: AlignmentType.RIGHT,
			spacingAfter: 20,
			border: invoiceBoxBorder
		}),
		b.para([b.run(`Service date: ${meta.serviceDate}${meta.serviceEnd}`)], {
			align: AlignmentType.RIGHT,
			spacingAfter: 40
		}),
		b.para([b.run(`Invoice date: ${meta.invoiceDate}`)], {
			align: AlignmentType.RIGHT,
			spacingAfter: 40
		}),
		b.para([b.run('Due date: ', { bold: true }), b.run(meta.dueDateStr, { bold: true })], {
			align: AlignmentType.RIGHT,
			spacingAfter: layout === 'pay_first' ? 60 : 40,
			// Quiet: soft highlight; pay_first / job_packet: plain bold
			...(layout === 'quiet'
				? { shading: { fill: 'FFF3CD', type: ShadingType.CLEAR } }
				: {})
		})
	];

	if (layout === 'pay_first' && totalAmount != null) {
		children.push(
			b.para([b.run('Amount due', { bold: true, color: COLOR_MUTED })], {
				align: AlignmentType.RIGHT,
				spacingAfter: 20
			}),
			b.para(
				[
					b.run(`$${totalAmount.toFixed(2)}`, {
						bold: true,
						size: FONT_HERO,
						color: COLOR_INK
					})
				],
				{ align: AlignmentType.RIGHT, spacingAfter: 40 }
			)
		);
	}

	if (ctx.businessSalesTaxAccount && layout !== 'job_packet') {
		children.push(
			b.para([b.run(`CBJ Sales Tax Acct: ${ctx.businessSalesTaxAccount}`)], {
				align: AlignmentType.RIGHT,
				spacingAfter: 40
			})
		);
	}

	return b.makeCell(INVOICE_COL, children, {
		margins: { top: 0, bottom: 0, left: 80, right: 0 }
	});
}

/**
 * Second row right cell of the top fold.
 * quiet: service location (legacy placement).
 * pay_first / job_packet: leave empty so service lives below the fold.
 */
function buildTopFoldSecondaryCell(
	b: InvoiceDocxBuilder,
	input: TopFoldInput,
	ctx: InvoiceDocxContext,
	layout: InvoiceLayoutId
) {
	const { AlignmentType } = b;

	if (layout === 'quiet') {
		const contactLine = (label: string, value: string) =>
			b.para([b.run(`${label}: ${value}`)], { align: AlignmentType.RIGHT, spacingAfter: 40 });
		return b.makeCell(
			INVOICE_COL,
			[
				b.para([b.run('Service location', { bold: true, size: FONT_LABEL })], {
					align: AlignmentType.LEFT,
					spacingAfter: 40
				}),
				...input.serviceLines.map((line) =>
					b.para([b.run(line)], { align: AlignmentType.LEFT, spacingAfter: 20 })
				),
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
			{ margins: { top: 0, bottom: 0, left: 80, right: 0 } }
		);
	}

	// Empty right cell preserves 2-col grid / envelope left column alignment.
	return b.makeCell(INVOICE_COL, [b.para([b.run('')], { spacingAfter: 0 })], {
		margins: { top: 0, bottom: 0, left: 0, right: 0 }
	});
}

export function buildTopFoldTable(
	b: InvoiceDocxBuilder,
	input: TopFoldInput,
	ctx: InvoiceDocxContext,
	meta: TopFoldMeta,
	layout: InvoiceLayoutId = 'quiet'
) {
	const layoutId = normalizeInvoiceLayout(layout);
	return b.makeTable([ENVELOPE_WINDOW_WIDTH, INVOICE_COL], [
		new b.TableRow({
			...b.exactRow(ENVELOPE_MAIL_TO_TOP),
			children: [
				envelopeReturnCell(b, input.returnLines, input.envelopePreview),
				buildMetaColumn(b, ctx, meta, layoutId, input.totalAmount)
			]
		}),
		new b.TableRow({
			children: [
				envelopeRecipientCell(b, input.recipientLines, input.envelopePreview),
				buildTopFoldSecondaryCell(b, input, ctx, layoutId)
			]
		})
	]);
}

export function buildLineItemsTableFromSnapshot(
	b: InvoiceDocxBuilder,
	items: InvoiceBillableItem[],
	subtotal: number,
	taxAmount: number,
	taxLabel: string,
	taxPct: number,
	invoiceDiscount?: InvoiceDiscount,
	opts?: LineItemsOptions
) {
	const { AlignmentType } = b;
	const includeTaxRows = opts?.includeTaxRows !== false;
	const headerShading = opts?.headerShading ?? 'F3F3F3';
	const lineCellMargins = { top: 40, bottom: 40, left: 60, right: 60 };

	const billableRows = (items || []).map((item, idx: number) => {
		const discountNote = item.lineDiscount?.description?.trim();
		const hasDiscount = !!(item.lineDiscount?.value > 0 && discountNote);
		const description =
			(item.title || `Item ${idx + 1}`) + (hasDiscount ? ` — ${discountNote}` : '');
		return new b.TableRow({
			children: [
				b.textCell(description, COL_DESC, { margins: lineCellMargins }),
				b.textCell(String(item.quantity || 1), COL_QTY, {
					align: AlignmentType.RIGHT,
					margins: lineCellMargins
				}),
				b.textCell(`$${(item.price || 0).toFixed(2)}`, COL_UNIT, {
					align: AlignmentType.RIGHT,
					margins: lineCellMargins
				}),
				b.textCell(`$${(item.total || 0).toFixed(2)}`, COL_TOTAL, {
					align: AlignmentType.RIGHT,
					margins: lineCellMargins
				})
			]
		});
	});

	const discountRows =
		invoiceDiscount && invoiceDiscount.value > 0
			? [
					new b.TableRow({
						children: [
							b.textCell(
								invoiceDiscount.description?.trim() ||
									(invoiceDiscount.type === 'percent'
										? `Discount (${invoiceDiscount.value}%)`
										: 'Discount'),
								COL_DESC,
								{ borders: b.lineBorders, margins: lineCellMargins }
							),
							b.textCell('', COL_QTY, { borders: b.lineBorders, margins: lineCellMargins }),
							b.textCell('', COL_UNIT, { borders: b.lineBorders, margins: lineCellMargins }),
							b.textCell(
								invoiceDiscount.type === 'amount'
									? `-$${invoiceDiscount.value.toFixed(2)}`
									: '',
								COL_TOTAL,
								{ align: AlignmentType.RIGHT, borders: b.lineBorders, margins: lineCellMargins }
							)
						]
					})
				]
			: [];

	const taxRows = includeTaxRows
		? [
				new b.TableRow({
					children: [
						b.textCell('Subtotal', COL_DESC, {
							borders: b.lineBorders,
							margins: lineCellMargins
						}),
						b.textCell('', COL_QTY, { borders: b.lineBorders, margins: lineCellMargins }),
						b.textCell('', COL_UNIT, { borders: b.lineBorders, margins: lineCellMargins }),
						b.textCell(`$${subtotal.toFixed(2)}`, COL_TOTAL, {
							align: AlignmentType.RIGHT,
							borders: b.lineBorders,
							margins: lineCellMargins
						})
					]
				}),
				new b.TableRow({
					children: [
						b.textCell(`${taxLabel} (${taxPct.toFixed(1)}%)`, COL_DESC, {
							borders: b.lineBorders,
							margins: lineCellMargins
						}),
						b.textCell('', COL_QTY, { borders: b.lineBorders, margins: lineCellMargins }),
						b.textCell('', COL_UNIT, { borders: b.lineBorders, margins: lineCellMargins }),
						b.textCell(`$${taxAmount.toFixed(2)}`, COL_TOTAL, {
							align: AlignmentType.RIGHT,
							borders: b.lineBorders,
							margins: lineCellMargins
						})
					]
				})
			]
		: [];

	const table = b.makeTable(
		[COL_DESC, COL_QTY, COL_UNIT, COL_TOTAL],
		[
			new b.TableRow({
				children: [
					b.textCell('Description', COL_DESC, {
						bold: true,
						shading: headerShading,
						borders: b.lineBorders,
						margins: lineCellMargins
					}),
					b.textCell('Qty', COL_QTY, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: headerShading,
						borders: b.lineBorders,
						margins: lineCellMargins
					}),
					b.textCell('Rate', COL_UNIT, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: headerShading,
						borders: b.lineBorders,
						margins: lineCellMargins
					}),
					b.textCell('Amount', COL_TOTAL, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: headerShading,
						borders: b.lineBorders,
						margins: lineCellMargins
					})
				]
			}),
			...billableRows,
			...discountRows,
			...taxRows
		],
		b.lineBorders
	);

	if (opts?.sectionTitle?.trim()) {
		return {
			sectionTitle: b.para(
				[b.run(opts.sectionTitle.trim().toUpperCase(), { bold: true, size: FONT_SECTION })],
				{ spacingBefore: TIGHT, spacingAfter: 80 }
			),
			table
		};
	}
	return { sectionTitle: null as ReturnType<InvoiceDocxBuilder['para']> | null, table };
}

export function buildLineItemsTable(b: InvoiceDocxBuilder, job: Job, taxLabel: string, taxPct: number) {
	const built = buildLineItemsTableFromSnapshot(
		b,
		(job.billableItems || []) as InvoiceBillableItem[],
		job.subtotal ?? 0,
		job.taxAmount ?? 0,
		taxLabel,
		taxPct
	);
	return built.table;
}

/** pay_first: Bill to echo + service location side by side. */
function buildBillToServiceRow(
	b: InvoiceDocxBuilder,
	clientName: string,
	billToLines: string[],
	serviceLines: string[]
) {
	const half = Math.floor(CONTENT_WIDTH / 2);
	const right = CONTENT_WIDTH - half;
	const leftParas = [
		b.para([b.run('Bill to', { bold: true, size: FONT_LABEL, color: COLOR_MUTED })], {
			spacingAfter: 40
		}),
		b.para([b.run(clientName, { bold: true })], { spacingAfter: 20 }),
		...billToLines.map((line) => b.para([b.run(line)], { spacingAfter: 20 }))
	];
	const rightParas = [
		b.para([b.run('Service location', { bold: true, size: FONT_LABEL, color: COLOR_MUTED })], {
			spacingAfter: 40
		}),
		...serviceLines.map((line) => b.para([b.run(line)], { spacingAfter: 20 }))
	];
	return b.makeTable(
		[half, right],
		[
			new b.TableRow({
				children: [
					b.makeCell(half, leftParas, {
						margins: { top: 40, bottom: SECTION_GAP, left: 0, right: 80 }
					}),
					b.makeCell(right, rightParas, {
						margins: { top: 40, bottom: SECTION_GAP, left: 80, right: 0 }
					})
				]
			})
		]
	);
}

/** job_packet: two labeled cards under the fold. */
function buildJobPacketCards(
	b: InvoiceDocxBuilder,
	serviceLines: string[],
	ctx: InvoiceDocxContext,
	meta: TopFoldMeta
) {
	const half = Math.floor(CONTENT_WIDTH / 2);
	const right = CONTENT_WIDTH - half;
	const cardBorder = b.lineBorders;
	const pad = { top: 80, bottom: 80, left: 100, right: 100 };

	const serviceParas = [
		b.para([b.run('Service location', { bold: true, size: FONT_LABEL })], {
			spacingAfter: 40
		}),
		...serviceLines.map((line) => b.para([b.run(line)], { spacingAfter: 20 }))
	];

	const metaParas = [
		b.para([b.run('Job / tax info', { bold: true, size: FONT_LABEL })], {
			spacingAfter: 40
		}),
		b.para([b.run(`Service: ${meta.serviceDate}${meta.serviceEnd}`)], { spacingAfter: 20 }),
		b.para([b.run(`Invoice: ${meta.invoiceDate}`)], { spacingAfter: 20 }),
		b.para([b.run(`Due: ${meta.dueDateStr}`, { bold: true })], { spacingAfter: 20 }),
		...(ctx.businessSalesTaxAccount
			? [
					b.para([b.run(`CBJ tax acct: ${ctx.businessSalesTaxAccount}`)], {
						spacingAfter: 20
					})
				]
			: []),
		...(ctx.businessPhone?.trim()
			? [b.para([b.run(`Phone: ${ctx.businessPhone.trim()}`)], { spacingAfter: 20 })]
			: []),
		...(ctx.businessEmail?.trim()
			? [b.para([b.run(`Email: ${ctx.businessEmail.trim()}`)], { spacingAfter: 20 })]
			: [])
	];

	return b.makeTable(
		[half, right],
		[
			new b.TableRow({
				children: [
					b.makeCell(half, serviceParas, {
						borders: cardBorder,
						margins: pad
					}),
					b.makeCell(right, metaParas, {
						borders: cardBorder,
						margins: pad
					})
				]
			})
		]
	);
}

/**
 * Total + amount due in a bordered box, right-aligned (quiet layout).
 */
export function buildTotalsBox(b: InvoiceDocxBuilder, total: number, dueDateStr: string) {
	const { AlignmentType } = b;
	const boxMargins = { top: 60, bottom: 60, left: 100, right: 100 };
	const leftSpacer = CONTENT_WIDTH - TOTALS_BOX_WIDTH;
	const labelW = Math.round(TOTALS_BOX_WIDTH * 0.55);
	const amountW = TOTALS_BOX_WIDTH - labelW;

	const boxTable = b.makeTable(
		[labelW, amountW],
		[
			new b.TableRow({
				children: [
					b.makeCell(
						labelW,
						[
							b.para(
								[b.run('Total', { bold: true, size: FONT_TOTAL, color: COLOR_MUTED })],
								{ spacingAfter: 0 }
							)
						],
						{ borders: b.lineBorders, margins: boxMargins }
					),
					b.makeCell(
						amountW,
						[
							b.para(
								[
									b.run(`$${total.toFixed(2)}`, {
										bold: true,
										size: FONT_TOTAL,
										color: COLOR_MUTED
									})
								],
								{ align: AlignmentType.RIGHT, spacingAfter: 0 }
							)
						],
						{ borders: b.lineBorders, margins: boxMargins }
					)
				]
			}),
			new b.TableRow({
				children: [
					b.makeCell(
						TOTALS_BOX_WIDTH,
						[
							b.para(
								[b.run(`Amount due by ${dueDateStr}`, { bold: true, color: COLOR_MUTED })],
								{ align: AlignmentType.RIGHT, spacingAfter: 0 }
							)
						],
						{ borders: b.lineBorders, margins: boxMargins, columnSpan: 2 }
					)
				]
			})
		],
		b.lineBorders
	);

	return b.makeTable(
		[leftSpacer, TOTALS_BOX_WIDTH],
		[
			new b.TableRow({
				children: [
					b.makeCell(leftSpacer, [b.para([b.run('')], { spacingAfter: 0 })], {
						margins: { top: 0, bottom: 0, left: 0, right: 0 }
					}),
					b.makeCell(TOTALS_BOX_WIDTH, [boxTable], {
						margins: { top: 80, bottom: 0, left: 0, right: 0 }
					})
				]
			})
		]
	);
}

/** Right-aligned subtotal / tax / total stack (pay_first + job_packet). */
export function buildTotalsStack(
	b: InvoiceDocxBuilder,
	subtotal: number,
	taxAmount: number,
	taxLabel: string,
	taxPct: number,
	total: number,
	dueDateStr: string,
	opts?: { emphasizeTotal?: boolean }
) {
	const { AlignmentType } = b;
	const w = TOTALS_BOX_WIDTH;
	const leftSpacer = CONTENT_WIDTH - w;
	const labelW = Math.round(w * 0.62);
	const amountW = w - labelW;
	const row = (label: string, amount: string, bold = false, size?: number) =>
		new b.TableRow({
			children: [
				b.makeCell(
					labelW,
					[
						b.para([b.run(label, { bold, size: size ?? FONT_LABEL, color: COLOR_MUTED })], {
							spacingAfter: 0
						})
					],
					{ margins: { top: 20, bottom: 20, left: 0, right: 40 } }
				),
				b.makeCell(
					amountW,
					[
						b.para(
							[b.run(amount, { bold, size: size ?? FONT_LABEL, color: COLOR_MUTED })],
							{ align: AlignmentType.RIGHT, spacingAfter: 0 }
						)
					],
					{ margins: { top: 20, bottom: 20, left: 0, right: 0 } }
				)
			]
		});

	const stack = b.makeTable(
		[labelW, amountW],
		[
			row('Subtotal', `$${subtotal.toFixed(2)}`),
			row(`${taxLabel} (${taxPct.toFixed(1)}%)`, `$${taxAmount.toFixed(2)}`),
			row(
				opts?.emphasizeTotal ? 'TOTAL DUE' : 'Total',
				`$${total.toFixed(2)}`,
				true,
				FONT_TOTAL
			),
			row(`by ${dueDateStr}`, '', true)
		]
	);

	return b.makeTable(
		[leftSpacer, w],
		[
			new b.TableRow({
				children: [
					b.makeCell(leftSpacer, [b.para([b.run('')], { spacingAfter: 0 })]),
					b.makeCell(w, [stack], { margins: { top: 80, bottom: 40, left: 0, right: 0 } })
				]
			})
		]
	);
}

/** Full-width amount due bar (pay_first). */
export function buildAmountDueBar(b: InvoiceDocxBuilder, total: number, dueDateStr: string) {
	const { AlignmentType } = b;
	return b.makeTable(
		[CONTENT_WIDTH],
		[
			new b.TableRow({
				children: [
					b.makeCell(
						CONTENT_WIDTH,
						[
							b.para(
								[
									b.run('AMOUNT DUE', { bold: true, size: FONT_SECTION }),
									b.run('    '),
									b.run(`$${total.toFixed(2)}`, {
										bold: true,
										size: FONT_HERO
									})
								],
								{ align: AlignmentType.RIGHT, spacingAfter: 20 }
							),
							b.para(
								[b.run(`Please pay by ${dueDateStr}`, { bold: true, color: COLOR_MUTED })],
								{ align: AlignmentType.RIGHT, spacingAfter: 0 }
							)
						],
						{
							borders: b.lineBorders,
							shading: 'F4F4F4',
							margins: { top: 100, bottom: 100, left: 120, right: 120 }
						}
					)
				]
			})
		]
	);
}

/** Payment instructions + sign-off. */
export function buildPaymentParagraphs(
	b: InvoiceDocxBuilder,
	ctx: InvoiceDocxContext,
	paymentLines: string[],
	opts?: { title?: string }
) {
	const signatoryName = ctx.invoiceSignatoryName?.trim() || DEFAULT_SIGNATORY.name;
	const signatoryPhone =
		ctx.invoiceSignatoryPhone?.trim() || ctx.businessPhone?.trim() || DEFAULT_SIGNATORY.phone;
	const title = opts?.title ?? 'Payment';

	return [
		b.para(
			[
				b.run(title, {
					bold: true,
					size: FONT_LABEL,
					color: COLOR_MUTED
				})
			],
			{ spacingAfter: 40, spacingBefore: SECTION_GAP }
		),
		...paymentLines.map((line) =>
			b.para([b.run(line, { color: COLOR_MUTED })], { spacingAfter: 40 })
		),
		b.para([b.run('Thank you very much for your business.', { color: COLOR_MUTED })], {
			spacingAfter: 20,
			spacingBefore: TIGHT
		}),
		b.para([b.run(signatoryName, { color: COLOR_MUTED })], { spacingAfter: 20 }),
		b.para([b.run(signatoryPhone, { color: COLOR_MUTED })], {
			spacingAfter: SECTION_GAP
		})
	];
}

/** Invoice notes — last body section. */
export function buildInvoiceNotesParagraphs(
	b: InvoiceDocxBuilder,
	notes?: string,
	opts?: { title?: string }
) {
	const trimmed = notes?.trim();
	if (!trimmed) return [];
	const title = opts?.title ?? 'Invoice notes';
	return [
		b.para([b.run(title, { bold: true, size: FONT_LABEL, color: COLOR_MUTED })], {
			spacingAfter: 40,
			spacingBefore: NOTES_GAP
		}),
		b.para([b.run(trimmed, { color: COLOR_MUTED })], { spacingAfter: 40 })
	];
}

export interface AssembleBodyInput {
	layout: InvoiceLayoutId;
	clientName: string;
	/** Street + CSZ for bill-to (without name). */
	billToAddressLines: string[];
	serviceLines: string[];
	items: InvoiceBillableItem[];
	subtotal: number;
	taxAmount: number;
	taxLabel: string;
	taxPct: number;
	total: number;
	dueDateStr: string;
	invoiceDiscount?: InvoiceDiscount;
	paymentLines: string[];
	ctx: InvoiceDocxContext;
	meta: TopFoldMeta;
}

/** Build body children for the selected layout. */
export function assembleInvoiceBody(b: InvoiceDocxBuilder, input: AssembleBodyInput): DocxChild[] {
	const layout = normalizeInvoiceLayout(input.layout);
	const payment =
		layout === 'job_packet'
			? buildPaymentParagraphs(b, input.ctx, input.paymentLines, {
					title: 'Payment instructions'
				})
			: buildPaymentParagraphs(b, input.ctx, input.paymentLines);
	const notes =
		layout === 'job_packet'
			? buildInvoiceNotesParagraphs(b, input.ctx.invoiceNotes, { title: 'Notes' })
			: buildInvoiceNotesParagraphs(b, input.ctx.invoiceNotes);

	if (layout === 'pay_first') {
		const { table } = buildLineItemsTableFromSnapshot(
			b,
			input.items,
			input.subtotal,
			input.taxAmount,
			input.taxLabel,
			input.taxPct,
			input.invoiceDiscount,
			{ includeTaxRows: false, headerShading: 'EEEEEE' }
		);
		return [
			buildBillToServiceRow(
				b,
				input.clientName,
				input.billToAddressLines,
				input.serviceLines
			),
			table,
			buildTotalsStack(
				b,
				input.subtotal,
				input.taxAmount,
				input.taxLabel,
				input.taxPct,
				input.total,
				input.dueDateStr
			),
			buildAmountDueBar(b, input.total, input.dueDateStr),
			...payment,
			...notes
		];
	}

	if (layout === 'job_packet') {
		const { sectionTitle, table } = buildLineItemsTableFromSnapshot(
			b,
			input.items,
			input.subtotal,
			input.taxAmount,
			input.taxLabel,
			input.taxPct,
			input.invoiceDiscount,
			{
				includeTaxRows: false,
				headerShading: 'F3F3F3',
				sectionTitle: 'Work performed'
			}
		);
		return [
			buildJobPacketCards(b, input.serviceLines, input.ctx, input.meta),
			b.para([b.run('')], { spacingAfter: SECTION_GAP }),
			...(sectionTitle ? [sectionTitle] : []),
			table,
			buildTotalsStack(
				b,
				input.subtotal,
				input.taxAmount,
				input.taxLabel,
				input.taxPct,
				input.total,
				input.dueDateStr,
				{ emphasizeTotal: true }
			),
			...payment,
			...notes
		];
	}

	// quiet (default)
	const { table } = buildLineItemsTableFromSnapshot(
		b,
		input.items,
		input.subtotal,
		input.taxAmount,
		input.taxLabel,
		input.taxPct,
		input.invoiceDiscount,
		{ includeTaxRows: true }
	);
	// Service location already in top fold for quiet — no duplicate under fold.
	return [
		table,
		buildTotalsBox(b, input.total, input.dueDateStr),
		...payment,
		...notes
	];
}

export function buildPageTable(
	b: InvoiceDocxBuilder,
	topFoldTable: ReturnType<InvoiceDocxBuilder['makeTable']>,
	bodyChildren: DocxChild[]
) {
	return b.makeTable([CONTENT_WIDTH], [
		new b.TableRow({
			...b.exactRow(TOP_ADDRESS_PANEL_HEIGHT),
			children: [
				b.makeCell(CONTENT_WIDTH, [topFoldTable], {
					margins: { top: 0, bottom: 0, left: 0, right: 0 }
				})
			]
		}),
		new b.TableRow({
			children: [
				b.makeCell(CONTENT_WIDTH, bodyChildren, {
					margins: { top: 80, bottom: 80, left: 0, right: 0 }
				})
			]
		})
	]);
}
