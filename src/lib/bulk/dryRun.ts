/**
 * Validate a bulk payload and produce a dry-run / apply report.
 * When lookup indexes are provided, rows resolve create vs update and relation checks.
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
import {
	matchExistingJob,
	resolveJobClientPbId,
	type JobLookupIndex
} from './pbJobs';
import {
	matchExistingInvoice,
	resolveInvoiceClientPbId,
	resolveInvoiceJobPbId,
	type InvoiceLookupIndex
} from './pbInvoices';

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
	key: string;
	summary: string;
	errors?: string[];
	data?: BulkClient | BulkJob | BulkInvoice;
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
	dryRun: boolean;
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
	/** Present on commit responses when the invoice counter was evaluated */
	invoiceCounter?: {
		nextInvoiceNumber: number;
		invoiceNumberYear: number;
		bumped: boolean;
		maxSeqSeen: number;
		applied: boolean;
		error?: string;
	};
};

export type BulkDryRunOptions = {
	clientIndex?: ClientLookupIndex;
	jobIndex?: JobLookupIndex;
	invoiceIndex?: InvoiceLookupIndex;
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

/** Augment client index with valid externalIds from this payload (as pending keys). */
function payloadClientKeys(payload: BulkPayload): Set<string> {
	const keys = new Set<string>();
	if (!payload.clients) return keys;
	for (const raw of payload.clients) {
		if (raw && typeof raw === 'object' && 'externalId' in raw) {
			const id = String((raw as { externalId?: string }).externalId || '');
			if (id) keys.add(id);
		}
	}
	return keys;
}

function payloadJobKeys(payload: BulkPayload): Set<string> {
	const keys = new Set<string>();
	if (!payload.jobs) return keys;
	for (const raw of payload.jobs) {
		if (raw && typeof raw === 'object' && 'externalId' in raw) {
			const id = String((raw as { externalId?: string }).externalId || '');
			if (id) keys.add(id);
		}
	}
	return keys;
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

	const total =
		(payload.clients?.length ?? 0) +
		(payload.jobs?.length ?? 0) +
		(payload.invoices?.length ?? 0);

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
	const pendingClientKeys = payloadClientKeys(payload);
	const pendingJobKeys = payloadJobKeys(payload);

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
				if (match.kind === 'error') errors.push(match.message);
				else if (match.kind === 'update') {
					action = 'would_update';
					pbId = match.existing.id;
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
				rows.push({
					entity: 'clients',
					index: i,
					action,
					key,
					summary: `${data.name} · ${data.serviceAddressCity}${
						action === 'would_update' ? ` · update ${pbId}` : ' · create'
					}`,
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

			// Client relation: payload clients, or server client index
			if (data.clientExternalId) {
				const inPayload = clientExternalIds.has(data.clientExternalId);
				const onServer = options.clientIndex?.byImportKey.has(data.clientExternalId);
				if (!inPayload && !onServer) {
					// Invalid client row in payload with same key?
					if (pendingClientKeys.has(data.clientExternalId) && !inPayload) {
						errors.push(
							`clientExternalId "${data.clientExternalId}" refers to an invalid client row`
						);
					} else if (!pendingClientKeys.has(data.clientExternalId)) {
						errors.push(
							`clientExternalId "${data.clientExternalId}" not found in payload clients or database`
						);
					}
				}
			} else if (data.clientEmail && options.clientIndex) {
				const resolved = resolveJobClientPbId(data, options.clientIndex);
				if (!resolved.ok) errors.push(resolved.message);
			} else if (data.clientEmail && payload.clients?.length) {
				// Local-only preview: allow if any client row has matching email
				const em = data.clientEmail.trim().toLowerCase();
				const found = (payload.clients as unknown[]).some((c) => {
					if (c && typeof c === 'object' && 'email' in c) {
						return String((c as { email?: string }).email || '')
							.trim()
							.toLowerCase() === em;
					}
					return false;
				});
				if (!found) {
					errors.push(`clientEmail "${data.clientEmail}" not found in this payload's clients`);
				}
			}

			let action: BulkRowAction = 'would_create';
			let pbId: string | undefined;

			if (!errors.length && options.jobIndex) {
				const match = matchExistingJob(data, options.jobIndex);
				if (match.kind === 'update') {
					action = 'would_update';
					pbId = match.existing.id;
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
				tallyValid(summary.jobs, action);
				summary.totalValid++;
				const clientRef = data.clientExternalId || data.clientEmail || data.clientPbId || '';
				rows.push({
					entity: 'jobs',
					index: i,
					action,
					key,
					summary: `${data.title} → ${clientRef}${
						action === 'would_update' ? ` · update ${pbId}` : ' · create'
					}`,
					data,
					pbId
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

			if (data.jobExternalId) {
				const inPayload = jobExternalIds.has(data.jobExternalId);
				const onServer = options.jobIndex?.byImportKey.has(data.jobExternalId);
				if (!inPayload && !onServer) {
					if (pendingJobKeys.has(data.jobExternalId) && !inPayload) {
						errors.push(`jobExternalId "${data.jobExternalId}" refers to an invalid job row`);
					} else if (!pendingJobKeys.has(data.jobExternalId)) {
						errors.push(
							`jobExternalId "${data.jobExternalId}" not found in payload jobs or database`
						);
					}
				}
			} else if (data.jobPbId && options.jobIndex) {
				if (!options.jobIndex.byId.has(data.jobPbId)) {
					// Allow unknown jobPbId only when index not fully trusted — still flag
					errors.push(`jobPbId "${data.jobPbId}" not found in jobs`);
				}
			}

			if (options.jobIndex && options.clientIndex && !errors.length) {
				const jobRes = resolveInvoiceJobPbId(data, options.jobIndex);
				// Only hard-check when job is already on server (not only in payload)
				if (data.jobPbId || (data.jobExternalId && options.jobIndex.byImportKey.has(data.jobExternalId))) {
					if (!jobRes.ok) errors.push(jobRes.message);
					else {
						const clientRes = resolveInvoiceClientPbId(
							data,
							options.clientIndex,
							jobRes.clientPbId
						);
						if (!clientRes.ok && !data.clientExternalId && !data.clientEmail && !data.clientPbId) {
							// client comes from job — ok if job has client
							if (!jobRes.clientPbId) errors.push(clientRes.message);
						} else if (!clientRes.ok && (data.clientExternalId || data.clientEmail || data.clientPbId)) {
							errors.push(clientRes.message);
						}
					}
				}
			}

			let action: BulkRowAction = 'would_create';
			let pbId: string | undefined;

			if (!errors.length && options.invoiceIndex) {
				const match = matchExistingInvoice(data, options.invoiceIndex);
				if (match.kind === 'error') errors.push(match.message);
				else if (match.kind === 'update') {
					action = 'would_update';
					pbId = match.existing.id;
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
				tallyValid(summary.invoices, action);
				summary.totalValid++;
				const jobRef = data.jobExternalId || data.jobPbId || '';
				rows.push({
					entity: 'invoices',
					index: i,
					action,
					key,
					summary: `${data.invoiceNumber || key} · ${data.status} · job ${jobRef}${
						action === 'would_update' ? ` · update ${pbId}` : ' · create'
					}`,
					data,
					pbId
				});
			}
		}
	}

	return {
		dryRun: true,
		commitSupported: { clients: true, jobs: true, invoices: true },
		summary,
		rows,
		payloadErrors
	};
}
