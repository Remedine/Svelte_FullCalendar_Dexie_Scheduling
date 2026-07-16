/**
 * Minimal RFC4180-ish CSV parser → array of row objects (header keys → values).
 */
import type { BulkEntity, BulkPayload } from './schema';

export function parseCsvText(text: string): Record<string, string>[] {
	const rows = parseCsvRows(text);
	if (rows.length === 0) return [];

	const headers = rows[0].map((h) => normalizeHeader(h));
	const out: Record<string, string>[] = [];

	for (let i = 1; i < rows.length; i++) {
		const cells = rows[i];
		// Skip fully empty lines
		if (cells.every((c) => !c.trim())) continue;
		const obj: Record<string, string> = {};
		for (let c = 0; c < headers.length; c++) {
			const key = headers[c];
			if (!key) continue;
			obj[key] = cells[c] ?? '';
		}
		out.push(obj);
	}
	return out;
}

/** Parse a single-entity CSV into a BulkPayload fragment. */
export function csvToBulkPayload(entity: BulkEntity, text: string): BulkPayload {
	const rows = parseCsvText(text).map((row) => expandCsvRow(row));
	return { [entity]: rows };
}

/**
 * Expand special CSV columns:
 * - billableItems: JSON array string
 * - assignedCrew: pipe- or semicolon-separated names
 * - booleans already handled as strings for Zod preprocess
 */
function expandCsvRow(row: Record<string, string>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...row };

	if (row.billableItems?.trim()) {
		try {
			out.billableItems = JSON.parse(row.billableItems);
		} catch {
			// leave string — schema will fail with a clear error
			out.billableItems = row.billableItems;
		}
	} else {
		delete out.billableItems;
	}

	if (row.assignedCrew?.trim()) {
		out.assignedCrew = row.assignedCrew
			.split(/[|;]/)
			.map((s) => s.trim())
			.filter(Boolean);
	} else {
		delete out.assignedCrew;
	}

	// Drop empty strings so optional fields stay optional
	for (const [k, v] of Object.entries(out)) {
		if (v === '') delete out[k];
	}

	return out;
}

/** Map "Service Address Street" / "external_id" → serviceAddressStreet / externalId. */
export function normalizeHeader(h: string): string {
	const t = h.trim().replace(/^\uFEFF/, '');
	if (!t) return t;
	if (!/[\s_]/.test(t)) {
		// Already one token — keep camelCase as-is; lower-case only if ALL CAPS
		if (t === t.toUpperCase() && t.length > 1) return t.toLowerCase();
		return t;
	}
	const parts = t.split(/[\s_]+/).filter(Boolean);
	return parts
		.map((p, i) => {
			const lower = p.toLowerCase();
			if (i === 0) return lower;
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join('');
}

function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let inQuotes = false;

	const pushCell = () => {
		row.push(cell);
		cell = '';
	};
	const pushRow = () => {
		// Avoid trailing empty row from final newline
		if (row.length === 1 && row[0] === '' && rows.length > 0) {
			row = [];
			return;
		}
		rows.push(row);
		row = [];
	};

	const s = text.replace(/^\uFEFF/, '');
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		const next = s[i + 1];

		if (inQuotes) {
			if (ch === '"') {
				if (next === '"') {
					cell += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cell += ch;
			}
			continue;
		}

		if (ch === '"') {
			inQuotes = true;
			continue;
		}
		if (ch === ',') {
			pushCell();
			continue;
		}
		if (ch === '\n') {
			pushCell();
			pushRow();
			continue;
		}
		if (ch === '\r') {
			if (next === '\n') continue;
			pushCell();
			pushRow();
			continue;
		}
		cell += ch;
	}

	// Last cell/row
	if (cell.length > 0 || row.length > 0) {
		pushCell();
		pushRow();
	}

	return rows;
}
