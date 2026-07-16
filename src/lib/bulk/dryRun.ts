/**
 * Validate a bulk payload and produce a dry-run / apply report.
 * Client rows can resolve create vs update when a ClientLookupIndex is provided.
 */
import {
	bulkClientSchema,
	bulkInvoiceSchema,
	bulkJobSchema,
	MAX_BULK_ROWS,
	type BulkClient,
	type BulkEntity,
	type BulkInvoice,
	type BulkJob,
	type BulkPayload
} from './schema';
import { matchExistingClient, type ClientLookupIndex } from './pbClients';

export type BulkRowAction =
	| 'would_create'
	| 'would_update'
	| 'created'
	| 'updated'
	| 'error'
	| 'deferred';

export type BulkRowResult = {
	entity: BulkEntity;
	index: number;
	action: BulkRowAction;
	/** externalId or natural key for display */
	key: string;
	summary: string;
	errors?: string[];
	/** Validated data when not error */
	data?: BulkClient | BulkJob | BulkInvoice;
	/** Matched PocketBase id when updating */
	pbId?: string;
};

export type BulkEntitySummary = {
	total: number;
	valid: number;
	error: number;
	wouldCreate: number;
	wouldUpdate: number;
	created: number;
	updated: number;
	deferred: number;
};

export type BulkCommitSupport = {
	clients: boolean;
	jobs: boolean;
	invoices: boolean;
};

export type BulkDryRunResult = {
	/** true = preview only; false = commit result */
	dryRun: boolean;
	/** Slice 2: clients can be committed; jobs/invoices still deferred */
	commitSupported: BulkCommitSupport;
	summary: {
		clients: BulkEntitySummary;
		jobs: BulkEntitySummary;
		invoices: BulkEntitySummary;
		totalValid: number;
		totalError: number;
		totalRows: number;
	};
	rows: BulkRowResult[];
	payloadErrors: string[];
};

export type BulkDryRunOptions = {
	/** When set, client rows resolve would_create vs would_update */
	clientIndex?: ClientLookupIndex;
	/** When true, jobs/invoices that validate are still marked deferred (commit not ready) */
	markJobsInvoicesDeferred?: boolean;
};

function emptySummary(): BulkEntitySummary {
	return {
		total: 0,
		valid: 0,
		error: 0,
		wouldCreate: 0,
		wouldUpdate: 0,
		created: 0,
		updated: 0,
		deferred: 0
	};
}

function formatZodIssues(issues: { path: PropertyKey[]; message: string }[]): string[] {
	return issues.map((i) => {
		const path = i.path.length ? i.path.join('.') + ': ' : '';
		return `${path}${i.message}`;
	});
}

function clientKey(c: BulkClient, index: number): string {
	return c.externalId || c.email || c.name || `row-${index}`;
}

function jobKey(j: BulkJob, index: number): string {
	return j.externalId || j.title || `row-${index}`;
}

function invoiceKey(inv: BulkInvoice, index: number): string {
	return inv.externalId || inv.invoiceNumber || `row-${index}`;
}

function guessKey(raw: unknown, index: number): string {
	if (raw && typeof raw === 'object') {
		const o = raw as Record<string, unknown>;
		for (const k of ['externalId', 'name', 'title', 'invoiceNumber', 'email']) {
			if (typeof o[k] === 'string' && o[k]) return String(o[k]);
		}
	}
	return `row-${index}`;
}

function tallyValid(summary: BulkEntitySummary, action: BulkRowAction) {
	summary.valid++;
	if (action === 'would_create' || action === 'created') summary.wouldCreate++;
	if (action === 'would_update' || action === 'updated') summary.wouldUpdate++;
	if (action === 'created') summary.created++;
	if (action === 'updated') summary.updated++;
	if (action === 'deferred') summary.deferred++;
}

export function runBulkDryRun(
	payload: BulkPayload,
	options: BulkDryRunOptions = {}
): BulkDryRunResult {
	const rows: BulkRowResult[] = [];
	const payloadErrors: string[] = [];
	const summary = {
		clients: emptySummary(),
		jobs: emptySummary(),
		invoices: emptySummary(),
		totalValid: 0,
		totalError: 0,
		totalRows: 0
	};

	const clientCount = payload.clients?.length ?? 0;
	const jobCount = payload.jobs?.length ?? 0;
	const invoiceCount = payload.invoices?.length ?? 0;
	const total = clientCount + jobCount + invoiceCount;

	if (total === 0) {
		payloadErrors.push('Payload must include at least one of clients, jobs, or invoices');
	}
	if (total > MAX_BULK_ROWS) {
		payloadErrors.push(`Too many rows (${total}); max is ${MAX_BULK_ROWS}`);
	}

	const clientExternalIds = new Set<string>();
	const jobExternalIds = new Set<string>();
	const seenClientExt = new Map<string, number>();
	const seenJobExt = new Map<string, number>();
	const seenInvoiceExt = new Map<string, number>();
	const seenInvoiceNumbers = new Map<string, number>();

	// --- Clients ---
	if (payload.clients) {
		for (let i = 0; i < payload.clients.length; i++) {
			summary.clients.total++;
			summary.totalRows++;
			const parsed = bulkClientSchema.safeParse(payload.clients[i]);
			if (!parsed.success) {
				summary.clients.error++;
				summary.totalError++;
				rows.push({
					entity: 'clients',
					index: i,
					action: 'error',
					key: guessKey(payload.clients[i], i),
					summary: 'Invalid client row',
					errors: formatZodIssues(parsed.error.issues)
				});
				continue;
			}
			const data = parsed.data;
			const key = clientKey(data, i);
			const errors: string[] = [];

			if (data.externalId) {
				const prev = seenClientExt.get(data.externalId);
				if (prev !== undefined) {
					errors.push(`Duplicate externalId "${data.externalId}" (also row ${prev})`);
				} else {
					seenClientExt.set(data.externalId, i);
					clientExternalIds.add(data.externalId);
				}
			}

			let action: BulkRowAction = 'would_create';
			let pbId: string | undefined;

			if (!errors.length && options.clientIndex) {
				const match = matchExistingClient(data, options.clientIndex);
				if (match.kind === 'error') {
					errors.push(match.message);
				} else if (match.kind === 'update') {
					action = 'would_update';
					pbId = match.existing.id;
				} else {
					action = 'would_create';
				}
			}

			if (errors.length) {
				summary.clients.error++;
				summary.totalError++;
				rows.push({
					entity: 'clients',
					index: i,
					action: 'error',
					key,
					summary: data.name,
					errors
				});
			} else {
				tallyValid(summary.clients, action);
				summary.totalValid++;
				const matchNote =
					action === 'would_update' ? ` · update ${pbId}` : ' · create';
				rows.push({
					entity: 'clients',
					index: i,
					action,
					key,
					summary: `${data.name} · ${data.serviceAddressCity}${matchNote}`,
					data,
					pbId
				});
			}
		}
	}

	// --- Jobs ---
	if (payload.jobs) {
		for (let i = 0; i < payload.jobs.length; i++) {
			summary.jobs.total++;
			summary.totalRows++;
			const parsed = bulkJobSchema.safeParse(payload.jobs[i]);
			if (!parsed.success) {
				summary.jobs.error++;
				summary.totalError++;
				rows.push({
					entity: 'jobs',
					index: i,
					action: 'error',
					key: guessKey(payload.jobs[i], i),
					summary: 'Invalid job row',
					errors: formatZodIssues(parsed.error.issues)
				});
				continue;
			}
			const data = parsed.data;
			const key = jobKey(data, i);
			const errors: string[] = [];

			if (data.externalId) {
				const prev = seenJobExt.get(data.externalId);
				if (prev !== undefined) {
					errors.push(`Duplicate externalId "${data.externalId}" (also row ${prev})`);
				} else {
					seenJobExt.set(data.externalId, i);
					jobExternalIds.add(data.externalId);
				}
			}

			if (data.clientExternalId && payload.clients?.length) {
				if (!clientExternalIds.has(data.clientExternalId)) {
					const anyClientExt = (payload.clients as unknown[]).some((c) => {
						if (c && typeof c === 'object' && 'externalId' in c) {
							return String((c as { externalId?: string }).externalId) === data.clientExternalId;
						}
						return false;
					});
					if (!anyClientExt) {
						errors.push(
							`clientExternalId "${data.clientExternalId}" not found in this payload's clients`
						);
					} else if (!clientExternalIds.has(data.clientExternalId)) {
						errors.push(
							`clientExternalId "${data.clientExternalId}" refers to an invalid client row`
						);
					}
				}
			}

			if (errors.length) {
				summary.jobs.error++;
				summary.totalError++;
				rows.push({
					entity: 'jobs',
					index: i,
					action: 'error',
					key,
					summary: data.title,
					errors
				});
			} else {
				const action: BulkRowAction = options.markJobsInvoicesDeferred
					? 'deferred'
					: 'would_create';
				tallyValid(summary.jobs, action);
				summary.totalValid++;
				const clientRef = data.clientExternalId || data.clientEmail || data.clientPbId || '';
				rows.push({
					entity: 'jobs',
					index: i,
					action,
					key,
					summary:
						action === 'deferred'
							? `${data.title} → ${clientRef} (job commit not available yet)`
							: `${data.title} → ${clientRef}`,
					data,
					errors:
						action === 'deferred'
							? ['Job commit not implemented yet — clients only in this release']
							: undefined
				});
			}
		}
	}

	// --- Invoices ---
	if (payload.invoices) {
		for (let i = 0; i < payload.invoices.length; i++) {
			summary.invoices.total++;
			summary.totalRows++;
			const parsed = bulkInvoiceSchema.safeParse(payload.invoices[i]);
			if (!parsed.success) {
				summary.invoices.error++;
				summary.totalError++;
				rows.push({
					entity: 'invoices',
					index: i,
					action: 'error',
					key: guessKey(payload.invoices[i], i),
					summary: 'Invalid invoice row',
					errors: formatZodIssues(parsed.error.issues)
				});
				continue;
			}
			const data = parsed.data;
			const key = invoiceKey(data, i);
			const errors: string[] = [];

			if (data.externalId) {
				const prev = seenInvoiceExt.get(data.externalId);
				if (prev !== undefined) {
					errors.push(`Duplicate externalId "${data.externalId}" (also row ${prev})`);
				} else {
					seenInvoiceExt.set(data.externalId, i);
				}
			}

			if (data.invoiceNumber) {
				const prev = seenInvoiceNumbers.get(data.invoiceNumber);
				if (prev !== undefined) {
					errors.push(`Duplicate invoiceNumber "${data.invoiceNumber}" (also row ${prev})`);
				} else {
					seenInvoiceNumbers.set(data.invoiceNumber, i);
				}
			}

			if (data.jobExternalId && payload.jobs?.length) {
				if (!jobExternalIds.has(data.jobExternalId)) {
					const anyJobExt = (payload.jobs as unknown[]).some((j) => {
						if (j && typeof j === 'object' && 'externalId' in j) {
							return String((j as { externalId?: string }).externalId) === data.jobExternalId;
						}
						return false;
					});
					if (!anyJobExt) {
						errors.push(
							`jobExternalId "${data.jobExternalId}" not found in this payload's jobs`
						);
					} else if (!jobExternalIds.has(data.jobExternalId)) {
						errors.push(`jobExternalId "${data.jobExternalId}" refers to an invalid job row`);
					}
				}
			}

			if (errors.length) {
				summary.invoices.error++;
				summary.totalError++;
				rows.push({
					entity: 'invoices',
					index: i,
					action: 'error',
					key,
					summary: data.invoiceNumber || key,
					errors
				});
			} else {
				const action: BulkRowAction = options.markJobsInvoicesDeferred
					? 'deferred'
					: 'would_create';
				tallyValid(summary.invoices, action);
				summary.totalValid++;
				const jobRef = data.jobExternalId || data.jobPbId || '';
				rows.push({
					entity: 'invoices',
					index: i,
					action,
					key,
					summary:
						action === 'deferred'
							? `${data.invoiceNumber || key} (invoice commit not available yet)`
							: `${data.invoiceNumber || key} · ${data.status} · job ${jobRef}`,
					data,
					errors:
						action === 'deferred'
							? ['Invoice commit not implemented yet — clients only in this release']
							: undefined
				});
			}
		}
	}

	return {
		dryRun: true,
		commitSupported: { clients: true, jobs: false, invoices: false },
		summary,
		rows,
		payloadErrors
	};
}
