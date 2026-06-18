import { FONT, FONT_BODY, FONT_ENVELOPE } from './layout';

type DocxModule = typeof import('docx');
type Alignment = DocxModule['AlignmentType'][keyof DocxModule['AlignmentType']];

export type InvoiceDocxBuilder = ReturnType<typeof createInvoiceDocxBuilder>;

export function createInvoiceDocxBuilder(docx: DocxModule) {
	const {
		Paragraph,
		Table,
		TableRow,
		TableCell,
		TextRun,
		WidthType,
		VerticalAlign,
		BorderStyle,
		ShadingType,
		HeightRule
	} = docx;

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

	type CellBorders = NonNullable<ConstructorParameters<typeof TableCell>[0]>['borders'];

	const run = (text: string, opts?: { bold?: boolean; size?: number; color?: string }) =>
		new TextRun({
			text,
			font: FONT,
			bold: opts?.bold,
			size: opts?.size ?? FONT_BODY,
			color: opts?.color
		});

	const para = (
		children: InstanceType<typeof TextRun>[],
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
		rows: InstanceType<typeof TableRow>[],
		borders = noBorders
	) =>
		new Table({
			width: { size: columnWidths.reduce((sum, w) => sum + w, 0), type: WidthType.DXA },
			columnWidths,
			borders,
			rows
		});

	/** All cells default to zero margins; pass explicit margins only when padding is intended. */
	const makeCell = (
		widthTwips: number,
		children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[],
		opts?: {
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
				top: opts?.margins?.top ?? 0,
				bottom: opts?.margins?.bottom ?? 0,
				left: opts?.margins?.left ?? 0,
				right: opts?.margins?.right ?? 0
			},
			children
		});

	const textCell = (
		text: string,
		widthTwips: number,
		opts?: {
			align?: Alignment;
			bold?: boolean;
			shading?: string;
			borders?: CellBorders;
			margins?: { top?: number; bottom?: number; left?: number; right?: number };
		}
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

	const exactRow = (heightTwips: number) => ({
		height: { value: heightTwips, rule: HeightRule.EXACT }
	});

	const previewWindowBorders = (color: string) => ({
		top: { style: BorderStyle.DASHED, size: 4, color },
		bottom: { style: BorderStyle.DASHED, size: 4, color },
		left: { style: BorderStyle.DASHED, size: 4, color },
		right: { style: BorderStyle.DASHED, size: 4, color }
	});

	return {
		TableRow,
		AlignmentType: docx.AlignmentType,
		BorderStyle,
		ShadingType,
		run,
		para,
		makeTable,
		makeCell,
		textCell,
		addressLines,
		exactRow,
		lineBorder,
		lineBorders,
		previewWindowBorders
	};
}