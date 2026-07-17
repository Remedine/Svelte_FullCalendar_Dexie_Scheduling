/**
 * Pure helpers for mobile calendar move/resize feedback (HUD labels, duration).
 * Kept free of DOM so unit tests can lock the Google-style gesture copy format.
 */

export function formatMobileTime(d: Date, locale?: string): string {
	return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export function formatMobileTimeRange(start: Date, end: Date, locale?: string): string {
	return `${formatMobileTime(start, locale)} – ${formatMobileTime(end, locale)}`;
}

export function formatMobileDuration(start: Date, end: Date): string {
	const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return m ? `${h}h ${m}m` : `${h}h`;
}

/** Thresholds used by SplitCalendar mobile gestures — documented for review vs prior values. */
export const MOBILE_GESTURE_DEFAULTS = {
	/** Prior: 450ms. Material / Google Calendar press-and-drag is typically ~300–400ms. */
	longPressMs: 320,
	/** Prior: 18px after long-press — felt sticky once grab engaged. */
	dragMinDistancePx: 12,
	/** Prior: required pre-select before move. Now long-press any movable card. */
	requireSelectBeforeMove: false
} as const;
