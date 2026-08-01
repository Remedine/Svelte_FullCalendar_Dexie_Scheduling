import type { Job } from '$lib/db';
import type { InvoiceBillableItem, InvoiceDiscount } from '$lib/utils/invoiceTypes';
import type { InvoiceDocxBuilder } from './builder';
import {
	COLOR_MUTED,
	CONTENT_WIDTH,
	DEFAULT_SIGNATORY,
	ENVELOPE_MAIL_TO_TOP,
	ENVELOPE_RETURN_OFFSET,
	ENVELOPE_WINDOW_WIDTH,
	FONT_LABEL,
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
}

export interface TopFoldMeta {
	serviceDate: string;
	serviceEnd: string;
	invoiceDate: string;
	dueDateStr: string;
}

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
		// Zero cell padding so return + recipient share the same left edge as the page margin.
		{
			margins: { top: 0, bottom: 0, left: 0, right: 0 },
			...(preview
				? { borders: b.previewWindowBorders('CC0000'), shading: 'FFF5F5' }
				: {})
		}
	);
}

function envelopeRecipientCell(b: InvoiceDocxBuilder, lines: string[], preview: boolean) {
	// Small top breathing room inside the lower window zone (recipient starts cleanly at 2.5").
	const RECIPIENT_INNER_BEFORE = 80; // ~0.055"
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

export function buildTopFoldTable(
	b: InvoiceDocxBuilder,
	input: TopFoldInput,
	ctx: InvoiceDocxContext,
	meta: TopFoldMeta
) {
	const { AlignmentType, ShadingType } = b;
	const invoiceBoxBorder = {
		top: b.lineBorder,
		bottom: b.lineBorder,
		left: b.lineBorder,
		right: b.lineBorder
	};

	const contactLine = (label: string, value: string) =>
		b.para([b.run(`${label}: ${value}`)], { align: AlignmentType.RIGHT, spacingAfter: 40 });

	return b.makeTable([ENVELOPE_WINDOW_WIDTH, INVOICE_COL], [
		new b.TableRow({
			...b.exactRow(ENVELOPE_MAIL_TO_TOP),
			children: [
				envelopeReturnCell(b, input.returnLines, input.envelopePreview),
				b.makeCell(
					INVOICE_COL,
					[
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
						b.para(
							[b.run('Due date: ', { bold: true }), b.run(meta.dueDateStr, { bold: true })],
							{
								align: AlignmentType.RIGHT,
								spacingAfter: 40,
								shading: { fill: 'FFF3CD', type: ShadingType.CLEAR }
							}
						),
						...(ctx.businessSalesTaxAccount
							? [
									b.para([b.run(`CBJ Sales Tax Acct: ${ctx.businessSalesTaxAccount}`)], {
										align: AlignmentType.RIGHT,
										spacingAfter: 40
									})
								]
							: [])
					],
					{ margins: { top: 0, bottom: 0, left: 80, right: 0 } }
				)
			]
		}),
		new b.TableRow({
			children: [
				envelopeRecipientCell(b, input.recipientLines, input.envelopePreview),
				// Service location stays in the right column of the recipient row; text is left-aligned
				// within that area (not centered). Area position is unchanged.
				b.makeCell(
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
				)
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
	invoiceDiscount?: InvoiceDiscount
) {
	const { AlignmentType } = b;
	const lineCellMargins = { top: 40, bottom: 40, left: 60, right: 60 };

	const billableRows = (items || []).map((item, idx: number) => {
		const discountNote = item.lineDiscount?.description?.trim();
		const hasDiscount = !!(item.lineDiscount?.value > 0 && discountNote);
		const description =
			(item.title || `Item ${idx + 1}`) +
			(hasDiscount ? ` — ${discountNote}` : '');
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

	return b.makeTable(
		[COL_DESC, COL_QTY, COL_UNIT, COL_TOTAL],
		[
			new b.TableRow({
				children: [
					b.textCell('Description', COL_DESC, {
						bold: true,
						shading: 'F3F3F3',
						borders: b.lineBorders,
						margins: lineCellMargins
					}),
					b.textCell('Qty', COL_QTY, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: 'F3F3F3',
						borders: b.lineBorders,
						margins: lineCellMargins
					}),
					b.textCell('Rate', COL_UNIT, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: 'F3F3F3',
						borders: b.lineBorders,
						margins: lineCellMargins
					}),
					b.textCell('Amount', COL_TOTAL, {
						align: AlignmentType.RIGHT,
						bold: true,
						shading: 'F3F3F3',
						borders: b.lineBorders,
						margins: lineCellMargins
					})
				]
			}),
			...billableRows,
			...discountRows,
			new b.TableRow({
				children: [
					b.textCell('Subtotal', COL_DESC, { borders: b.lineBorders, margins: lineCellMargins }),
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
		],
		b.lineBorders
	);
}

export function buildLineItemsTable(b: InvoiceDocxBuilder, job: Job, taxLabel: string, taxPct: number) {
	return buildLineItemsTableFromSnapshot(
		b,
		(job.billableItems || []) as InvoiceBillableItem[],
		job.subtotal ?? 0,
		job.taxAmount ?? 0,
		taxLabel,
		taxPct
	);
}

/** Payment instructions + sign-off. Separate from invoice notes (which come last). */
export function buildPaymentParagraphs(
	b: InvoiceDocxBuilder,
	ctx: InvoiceDocxContext,
	paymentLines: string[]
) {
	const signatoryName = ctx.invoiceSignatoryName?.trim() || DEFAULT_SIGNATORY.name;
	const signatoryPhone =
		ctx.invoiceSignatoryPhone?.trim() || ctx.businessPhone?.trim() || DEFAULT_SIGNATORY.phone;

	return [
		b.para([b.run('Payment', { bold: true, size: FONT_LABEL, color: COLOR_MUTED })], {
			spacingAfter: 40,
			spacingBefore: SECTION_GAP
		}),
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

/** Invoice notes — always the last body section, with clear space above. */
export function buildInvoiceNotesParagraphs(b: InvoiceDocxBuilder, notes?: string) {
	const trimmed = notes?.trim();
	if (!trimmed) return [];
	return [
		b.para([b.run('Invoice notes', { bold: true, size: FONT_LABEL, color: COLOR_MUTED })], {
			spacingAfter: 40,
			spacingBefore: NOTES_GAP
		}),
		b.para([b.run(trimmed, { color: COLOR_MUTED })], { spacingAfter: 40 })
	];
}

/**
 * Total + amount due in a bordered box, right-aligned immediately under the line-item table.
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
								[
									b.run(`Amount due by ${dueDateStr}`, {
										bold: true,
										color: COLOR_MUTED
									})
								],
								{ align: AlignmentType.RIGHT, spacingAfter: 0 }
							)
						],
						{
							borders: b.lineBorders,
							margins: boxMargins,
							columnSpan: 2
						}
					)
				]
			})
		],
		b.lineBorders
	);

	// Outer 2-col table: empty left spacer + totals box flush right under the line items.
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

export function buildPageTable(
	b: InvoiceDocxBuilder,
	topFoldTable: ReturnType<InvoiceDocxBuilder['makeTable']>,
	bodyChildren: (ReturnType<InvoiceDocxBuilder['para']> | ReturnType<InvoiceDocxBuilder['makeTable']>)[]
) {
	// Dedicated taller top panel so addresses stay at their window positions
	// while line items / totals start ~4.25" down (below the fold for #10 double window).
	// Body uses the page's standard 1" left margin (not further indented under addresses).
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