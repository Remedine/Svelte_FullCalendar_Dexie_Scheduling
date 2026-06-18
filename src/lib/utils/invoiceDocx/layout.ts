/** Twips (dxa): 1440 per inch. */
export const TWIP = 1440;

export const FONT = 'Arial';
export const FONT_BODY = 20; // 10pt
export const FONT_LABEL = 20;
export const FONT_TITLE = 68; // 34pt
export const FONT_TOTAL = 32; // 16pt
export const FONT_ENVELOPE = 20;
export const COLOR_MUTED = '2B2C2F';
export const TIGHT = 60;

export const PAGE_WIDTH = Math.round(8.5 * TWIP);
export const PAGE_HEIGHT = Math.round(11 * TWIP);

/**
 * #10 double-window envelope (tri-fold: bottom third up, top third down).
 * Return + recipient live in the top 1/3" panel (first fold section).
 * Positions tuned for standard #10 double window so addresses align in windows.
 * @see https://www.postalmethods.com/envelope-information/
 */
export const ENVELOPE_LEFT_MARGIN = Math.round(0.875 * TWIP);
export const MARGIN_RIGHT = 720; // 0.5"
export const MARGIN_TOP = 0;
export const MARGIN_BOTTOM = 0;

/** Return address zone: 0.5" from sheet top. Recipient zone: 2.5" from sheet top for standard #10 double-window. */
// )=- fix: changed recipient start from 2.3125" to 2.5" to better align return + mailing addresses for #10 double window envelope (Remedine/Svelte_FullCalendar_Dexie_Scheduling)
export const ENVELOPE_RETURN_OFFSET = Math.round(0.5 * TWIP);
export const ENVELOPE_MAIL_TO_TOP = Math.round(2.5 * TWIP);
/** Window fits ~4.5" of address lines. */
export const ENVELOPE_WINDOW_WIDTH = Math.round(4.5 * TWIP);

export const CONTENT_WIDTH = PAGE_WIDTH - ENVELOPE_LEFT_MARGIN - MARGIN_RIGHT;
export const INVOICE_COL = CONTENT_WIDTH - ENVELOPE_WINDOW_WIDTH;

export const COL_DESC = Math.round(CONTENT_WIDTH * 0.52);
export const COL_QTY = Math.round(CONTENT_WIDTH * 0.12);
export const COL_UNIT = Math.round(CONTENT_WIDTH * 0.16);
export const COL_TOTAL = CONTENT_WIDTH - COL_DESC - COL_QTY - COL_UNIT;

export const USABLE_HEIGHT = PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;
export const PANEL_HEIGHT = Math.floor(USABLE_HEIGHT / 3);

export const DEFAULT_SIGNATORY = {
	name: 'Brick A. Engstrom',
	phone: '907.723.4617'
} as const;

/** Recipient block top offset on unfolded sheet (inches) for #10 lower window after tri-fold. */
export function envelopeRecipientTopInches(): number {
	return ENVELOPE_MAIL_TO_TOP / TWIP;
}