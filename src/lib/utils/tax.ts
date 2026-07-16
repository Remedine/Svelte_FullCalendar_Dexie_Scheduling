// Single source of truth for tax rate percent vs decimal handling.
// Dexie stores percent (e.g. 5 = 5%). PocketBase jobs store decimal (e.g. 0.05).
// Juneau/CBJ default in options is 5% — never invent a second fallback (e.g. 8).

/** Default tax percent when options are missing (5 = 5%). */
export const DEFAULT_TAX_RATE_PERCENT = 5;

/** Normalize any stored rate to a percentage value (5 = 5%). */
export function normalizeTaxRateToPercent(
	rate: number | null | undefined,
	fallback = DEFAULT_TAX_RATE_PERCENT
): number {
	if (rate == null || Number.isNaN(Number(rate))) return fallback;
	const n = Number(rate);
	if (n > 0 && n < 1) return n * 100;
	return n;
}

/** Convert a percent rate to the decimal form used on PocketBase job records. */
export function taxRatePercentToPbDecimal(percent: number): number {
	return normalizeTaxRateToPercent(percent) / 100;
}

/** Decimal multiplier for billing math (0.05 for 5%). */
export function taxRateToDecimal(
	rate: number | null | undefined,
	fallback = DEFAULT_TAX_RATE_PERCENT
): number {
	return normalizeTaxRateToPercent(rate, fallback) / 100;
}