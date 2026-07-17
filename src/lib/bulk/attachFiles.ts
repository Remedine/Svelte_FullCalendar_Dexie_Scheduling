/**
 * Attach supporting (or primary) files to invoices after bulk import.
 */
import { matchFilesToInvoices, type FileMatchResult, type InvoiceFileTarget } from './fileMatch';
import { loadInvoiceLookupIndex } from './pbInvoices';
import { pbBase } from './pbHttp';

export type BulkFileInput = {
	filename: string;
	blob: Blob;
	type?: string;
};

export type BulkFileAttachRow = Omit<FileMatchResult, 'action'> & {
	action: 'would_attach' | 'attached' | 'error';
};

export type BulkFileAttachResult = {
	dryRun: boolean;
	summary: {
		total: number;
		matched: number;
		error: number;
		attached: number;
	};
	rows: BulkFileAttachRow[];
};

export async function loadInvoiceFileTargets(
	authHeader: string
): Promise<InvoiceFileTarget[]> {
	const index = await loadInvoiceLookupIndex(authHeader);
	const byId = new Map<string, InvoiceFileTarget>();
	for (const inv of index.byId.values()) {
		byId.set(inv.id, {
			id: inv.id,
			invoiceNumber: inv.invoiceNumber,
			importKey: inv.importKey
		});
	}
	// byInvoiceNumber may have entries; byId should have all from listAllRecords
	return [...byId.values()];
}

export function planFileAttachments(
	files: Array<{ filename: string }>,
	invoices: InvoiceFileTarget[],
	options: {
		mapping?: Record<string, string>;
		treatDocxAsPrimary?: boolean;
	} = {}
): BulkFileAttachResult {
	const matches = matchFilesToInvoices(
		files.map((f) => f.filename),
		invoices,
		options
	);
	const rows: BulkFileAttachRow[] = matches.map((m) => ({ ...m }));
	const error = rows.filter((r) => r.action === 'error').length;
	const matched = rows.filter((r) => r.action === 'would_attach').length;
	return {
		dryRun: true,
		summary: { total: rows.length, matched, error, attached: 0 },
		rows
	};
}

/**
 * Upload files to matched invoices (FormData PATCH).
 * Groups by invoice so multiple files for one invoice are one request when possible.
 */
export async function commitFileAttachments(
	authHeader: string,
	files: BulkFileInput[],
	options: {
		mapping?: Record<string, string>;
		treatDocxAsPrimary?: boolean;
	} = {}
): Promise<BulkFileAttachResult> {
	const invoices = await loadInvoiceFileTargets(authHeader);
	const plan = planFileAttachments(files, invoices, options);

	// Map filename → blob
	const fileByName = new Map(files.map((f) => [f.filename, f]));

	const rows: BulkFileAttachRow[] = [];
	let attached = 0;
	let error = 0;

	// Group successful matches by invoiceId
	const byInvoice = new Map<
		string,
		Array<{ plan: FileMatchResult; file: BulkFileInput }>
	>();

	for (const row of plan.rows) {
		if (row.action === 'error' || !row.invoiceId) {
			rows.push(row);
			error++;
			continue;
		}
		const file = fileByName.get(row.filename);
		if (!file) {
			rows.push({
				...row,
				action: 'error',
				errors: ['File blob missing for ' + row.filename]
			});
			error++;
			continue;
		}
		const list = byInvoice.get(row.invoiceId) || [];
		list.push({ plan: row, file });
		byInvoice.set(row.invoiceId, list);
	}

	for (const [invoiceId, group] of byInvoice) {
		try {
			const formData = new FormData();
			let hasPrimary = false;
			for (const { plan: p, file } of group) {
				const type = file.type || file.blob.type || 'application/octet-stream';
				const f = new File([file.blob], file.filename, { type });
				if (p.role === 'primary') {
					// Last primary wins if multiple
					formData.set('primaryInvoiceFile', f);
					hasPrimary = true;
				} else {
					formData.append('supportingDocuments', f);
				}
			}

			const res = await fetch(
				`${pbBase()}/api/collections/invoices/records/${encodeURIComponent(invoiceId)}`,
				{
					method: 'PATCH',
					headers: {
						Authorization: authHeader.trim()
						// no Content-Type — browser sets multipart boundary
					},
					body: formData
				}
			);

			if (!res.ok) {
				const body = await res.text().catch(() => '');
				const msg = `Upload failed (${res.status}): ${body.slice(0, 200)}`;
				for (const { plan: p } of group) {
					rows.push({ ...p, action: 'error', errors: [msg] });
					error++;
				}
				continue;
			}

			void hasPrimary;
			for (const { plan: p } of group) {
				rows.push({
					...p,
					action: 'attached'
				});
				attached++;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Upload failed';
			for (const { plan: p } of group) {
				rows.push({ ...p, action: 'error', errors: [msg] });
				error++;
			}
		}
	}

	// Preserve order roughly by original plan order
	rows.sort((a, b) => {
		const ia = plan.rows.findIndex((r) => r.filename === a.filename);
		const ib = plan.rows.findIndex((r) => r.filename === b.filename);
		return ia - ib;
	});

	return {
		dryRun: false,
		summary: {
			total: plan.summary.total,
			matched: plan.summary.matched,
			error,
			attached
		},
		rows
	};
}

