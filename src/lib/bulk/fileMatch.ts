/**
 * Match uploaded filenames to invoices by invoiceNumber or importKey.
 */

export type InvoiceFileTarget = {
	id: string;
	invoiceNumber?: string;
	importKey?: string;
};

export type FileMatchRole = 'supporting' | 'primary';

export type FileMatchResult = {
	filename: string;
	/** Basename without path */
	baseName: string;
	action: 'would_attach' | 'error';
	role: FileMatchRole;
	invoiceId?: string;
	invoiceNumber?: string;
	importKey?: string;
	errors?: string[];
};

function baseName(path: string): string {
	const s = path.replace(/\\/g, '/');
	const i = s.lastIndexOf('/');
	return i >= 0 ? s.slice(i + 1) : s;
}

function stripExt(name: string): string {
	const i = name.lastIndexOf('.');
	if (i <= 0) return name;
	return name.slice(0, i);
}

function normalizeKey(s: string): string {
	return s.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function isDocx(filename: string): boolean {
	return /\.docx$/i.test(filename);
}

/**
 * Build match candidates from invoice records (prefer longer keys first for contains-match).
 */
export function buildInvoiceKeyIndex(invoices: InvoiceFileTarget[]): {
	exact: Map<string, InvoiceFileTarget[]>;
	/** Sorted longest-first for substring search */
	keys: Array<{ key: string; inv: InvoiceFileTarget; kind: 'number' | 'importKey' }>;
} {
	const exact = new Map<string, InvoiceFileTarget[]>();
	const keys: Array<{ key: string; inv: InvoiceFileTarget; kind: 'number' | 'importKey' }> = [];

	const addExact = (raw: string, inv: InvoiceFileTarget) => {
		const k = normalizeKey(raw);
		if (!k) return;
		const list = exact.get(k) || [];
		list.push(inv);
		exact.set(k, list);
	};

	for (const inv of invoices) {
		if (inv.invoiceNumber) {
			addExact(inv.invoiceNumber, inv);
			keys.push({ key: normalizeKey(inv.invoiceNumber), inv, kind: 'number' });
		}
		if (inv.importKey) {
			addExact(inv.importKey, inv);
			keys.push({ key: normalizeKey(inv.importKey), inv, kind: 'importKey' });
		}
	}

	keys.sort((a, b) => b.key.length - a.key.length);
	return { exact, keys };
}

export type MatchFilesOptions = {
	/** Explicit map: original filename → invoiceNumber or importKey */
	mapping?: Record<string, string>;
	/** If true, .docx files attach as primaryInvoiceFile */
	treatDocxAsPrimary?: boolean;
};

/**
 * Match a list of file names (or paths) to invoices.
 */
export function matchFilesToInvoices(
	fileNames: string[],
	invoices: InvoiceFileTarget[],
	options: MatchFilesOptions = {}
): FileMatchResult[] {
	const { exact, keys } = buildInvoiceKeyIndex(invoices);
	const mapping = options.mapping || {};
	const treatDocxAsPrimary = options.treatDocxAsPrimary !== false;

	return fileNames.map((path) => {
		const filename = baseName(path);
		const stem = stripExt(filename);
		const stemNorm = normalizeKey(stem);
		const role: FileMatchRole =
			treatDocxAsPrimary && isDocx(filename) ? 'primary' : 'supporting';

		// Explicit mapping wins
		const mapKey =
			mapping[filename] ||
			mapping[path] ||
			mapping[stem] ||
			Object.entries(mapping).find(([k]) => baseName(k) === filename)?.[1];

		if (mapKey) {
			const targets = exact.get(normalizeKey(mapKey)) || [];
			const unique = dedupeInvoices(targets);
			if (unique.length === 1) {
				return okResult(filename, role, unique[0]);
			}
			if (unique.length === 0) {
				return errResult(filename, role, [
					`Mapping target "${mapKey}" not found on any invoice`
				]);
			}
			return errResult(filename, role, [
				`Mapping target "${mapKey}" matches multiple invoices`
			]);
		}

		// Exact stem = invoiceNumber or importKey
		const exactHits = dedupeInvoices(exact.get(stemNorm) || []);
		if (exactHits.length === 1) {
			return okResult(filename, role, exactHits[0]);
		}
		if (exactHits.length > 1) {
			return errResult(filename, role, [
				`Filename matches multiple invoices (${exactHits.map((i) => i.invoiceNumber || i.id).join(', ')})`
			]);
		}

		// Substring: longest key contained in stem (or stem in key for short keys ≥ 4 chars)
		const contains: InvoiceFileTarget[] = [];
		for (const { key, inv } of keys) {
			if (key.length < 3) continue;
			if (stemNorm.includes(key) || (key.length >= 6 && key.includes(stemNorm))) {
				if (!contains.some((c) => c.id === inv.id)) contains.push(inv);
			}
		}
		if (contains.length === 1) {
			return okResult(filename, role, contains[0]);
		}
		if (contains.length > 1) {
			return errResult(filename, role, [
				`Ambiguous match: ${contains.map((i) => i.invoiceNumber || i.importKey || i.id).join(', ')}`
			]);
		}

		return errResult(filename, role, [
			'No invoice match — name the file after invoiceNumber or importKey (e.g. CCW-2026-0001.pdf)'
		]);
	});
}

function dedupeInvoices(list: InvoiceFileTarget[]): InvoiceFileTarget[] {
	const seen = new Set<string>();
	const out: InvoiceFileTarget[] = [];
	for (const inv of list) {
		if (seen.has(inv.id)) continue;
		seen.add(inv.id);
		out.push(inv);
	}
	return out;
}

function okResult(
	filename: string,
	role: FileMatchRole,
	inv: InvoiceFileTarget
): FileMatchResult {
	return {
		filename,
		baseName: filename,
		action: 'would_attach',
		role,
		invoiceId: inv.id,
		invoiceNumber: inv.invoiceNumber,
		importKey: inv.importKey
	};
}

function errResult(
	filename: string,
	role: FileMatchRole,
	errors: string[]
): FileMatchResult {
	return {
		filename,
		baseName: filename,
		action: 'error',
		role,
		errors
	};
}
