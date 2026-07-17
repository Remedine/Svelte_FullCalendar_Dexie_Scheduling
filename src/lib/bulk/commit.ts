/**
 * Full bulk commit: clients → jobs → invoices (order matters for relations).
 */
import type { BulkClient, BulkInvoice, BulkJob, BulkPayload } from './schema';
import { runBulkDryRun, type BulkDryRunResult, type BulkRowResult } from './dryRun';
import {
	createPbClient,
	loadClientLookupIndex,
	matchExistingClient,
	updatePbClient,
	type ClientLookupIndex,
	type ExistingClient
} from './pbClients';
import {
	createPbJob,
	loadJobLookupIndex,
	matchExistingJob,
	resolveJobClientPbId,
	updatePbJob,
	type JobLookupIndex,
	type ExistingJob
} from './pbJobs';
import {
	createPbInvoice,
	loadInvoiceLookupIndex,
	matchExistingInvoice,
	resolveInvoiceClientPbId,
	resolveInvoiceJobPbId,
	updatePbInvoice,
	type InvoiceLookupIndex
} from './pbInvoices';

export type BulkCommitResult = Omit<BulkDryRunResult, 'dryRun'> & {
	dryRun: false;
};

function registerClient(index: ClientLookupIndex, id: string, client: BulkClient) {
	const existing: ExistingClient = {
		id,
		importKey: client.externalId,
		email: client.email,
		name: client.name
	};
	if (client.externalId) index.byImportKey.set(client.externalId, existing);
	const em = (client.email || '').trim().toLowerCase();
	if (em) index.byEmail.set(em, existing);
}

function registerJob(
	index: JobLookupIndex,
	id: string,
	job: BulkJob,
	clientPbId: string
) {
	const existing: ExistingJob = {
		id,
		importKey: job.externalId,
		client: clientPbId,
		title: job.title
	};
	index.byId.set(id, existing);
	if (job.externalId) index.byImportKey.set(job.externalId, existing);
}

function emptyEntityCounts() {
	return {
		valid: 0,
		error: 0,
		created: 0,
		updated: 0
	};
}

/**
 * Commit clients, jobs, and invoices present in the payload.
 */
export async function commitBulk(
	authHeader: string,
	payload: BulkPayload
): Promise<BulkCommitResult> {
	const [clientIndex, jobIndex, invoiceIndex] = await Promise.all([
		loadClientLookupIndex(authHeader),
		loadJobLookupIndex(authHeader),
		loadInvoiceLookupIndex(authHeader)
	]);

	const preview = runBulkDryRun(payload, {
		clientIndex,
		jobIndex,
		invoiceIndex
	});

	if (preview.payloadErrors.length) {
		return { ...preview, dryRun: false };
	}

	const liveClients: ClientLookupIndex = {
		byImportKey: new Map(clientIndex.byImportKey),
		byEmail: new Map(clientIndex.byEmail)
	};
	const liveJobs: JobLookupIndex = {
		byImportKey: new Map(jobIndex.byImportKey),
		byId: new Map(jobIndex.byId)
	};
	const liveInvoices: InvoiceLookupIndex = {
		byImportKey: new Map(invoiceIndex.byImportKey),
		byInvoiceNumber: new Map(invoiceIndex.byInvoiceNumber),
		byId: new Map(invoiceIndex.byId)
	};

	const rows: BulkRowResult[] = [];
	const cStats = emptyEntityCounts();
	const jStats = emptyEntityCounts();
	const iStats = emptyEntityCounts();

	// Process in entity order so relations resolve
	const clientRows = preview.rows.filter((r) => r.entity === 'clients');
	const jobRows = preview.rows.filter((r) => r.entity === 'jobs');
	const invoiceRows = preview.rows.filter((r) => r.entity === 'invoices');

	for (const row of clientRows) {
		if (row.action === 'error' || !row.data) {
			rows.push(row);
			cStats.error++;
			continue;
		}
		const client = row.data as BulkClient;
		try {
			const match = matchExistingClient(client, liveClients);
			if (match.kind === 'error') {
				rows.push({ ...row, action: 'error', errors: [match.message] });
				cStats.error++;
				continue;
			}
			if (match.kind === 'update') {
				const { id } = await updatePbClient(authHeader, match.existing.id, client);
				rows.push({
					...row,
					action: 'updated',
					pbId: id,
					summary: `${client.name} · updated ${id}`
				});
				cStats.valid++;
				cStats.updated++;
				registerClient(liveClients, id, client);
			} else {
				const { id } = await createPbClient(authHeader, client);
				rows.push({
					...row,
					action: 'created',
					pbId: id,
					summary: `${client.name} · created ${id}`
				});
				cStats.valid++;
				cStats.created++;
				registerClient(liveClients, id, client);
			}
		} catch (err) {
			rows.push({
				...row,
				action: 'error',
				errors: [err instanceof Error ? err.message : 'Client write failed'],
				summary: client.name
			});
			cStats.error++;
		}
	}

	for (const row of jobRows) {
		if (row.action === 'error' || !row.data) {
			rows.push(row);
			jStats.error++;
			continue;
		}
		const job = row.data as BulkJob;
		try {
			const clientRes = resolveJobClientPbId(job, liveClients);
			if (!clientRes.ok) {
				rows.push({ ...row, action: 'error', errors: [clientRes.message] });
				jStats.error++;
				continue;
			}
			const match = matchExistingJob(job, liveJobs);
			if (match.kind === 'update') {
				const { id } = await updatePbJob(
					authHeader,
					match.existing.id,
					job,
					clientRes.clientPbId
				);
				rows.push({
					...row,
					action: 'updated',
					pbId: id,
					summary: `${job.title} · updated ${id}`
				});
				jStats.valid++;
				jStats.updated++;
				registerJob(liveJobs, id, job, clientRes.clientPbId);
			} else {
				const { id } = await createPbJob(authHeader, job, clientRes.clientPbId);
				rows.push({
					...row,
					action: 'created',
					pbId: id,
					summary: `${job.title} · created ${id}`
				});
				jStats.valid++;
				jStats.created++;
				registerJob(liveJobs, id, job, clientRes.clientPbId);
			}
		} catch (err) {
			rows.push({
				...row,
				action: 'error',
				errors: [err instanceof Error ? err.message : 'Job write failed'],
				summary: job.title
			});
			jStats.error++;
		}
	}

	for (const row of invoiceRows) {
		if (row.action === 'error' || !row.data) {
			rows.push(row);
			iStats.error++;
			continue;
		}
		const inv = row.data as BulkInvoice;
		try {
			const jobRes = resolveInvoiceJobPbId(inv, liveJobs);
			if (!jobRes.ok) {
				rows.push({ ...row, action: 'error', errors: [jobRes.message] });
				iStats.error++;
				continue;
			}
			const clientRes = resolveInvoiceClientPbId(
				inv,
				liveClients,
				jobRes.clientPbId
			);
			if (!clientRes.ok) {
				rows.push({ ...row, action: 'error', errors: [clientRes.message] });
				iStats.error++;
				continue;
			}
			const match = matchExistingInvoice(inv, liveInvoices);
			if (match.kind === 'error') {
				rows.push({ ...row, action: 'error', errors: [match.message] });
				iStats.error++;
				continue;
			}
			if (match.kind === 'update') {
				const { id } = await updatePbInvoice(
					authHeader,
					match.existing.id,
					inv,
					jobRes.jobPbId,
					clientRes.clientPbId
				);
				rows.push({
					...row,
					action: 'updated',
					pbId: id,
					summary: `${inv.invoiceNumber || inv.externalId || id} · updated ${id}`
				});
				iStats.valid++;
				iStats.updated++;
				if (inv.externalId) {
					liveInvoices.byImportKey.set(inv.externalId, {
						id,
						importKey: inv.externalId,
						invoiceNumber: inv.invoiceNumber,
						job: jobRes.jobPbId,
						client: clientRes.clientPbId
					});
				}
				if (inv.invoiceNumber) {
					liveInvoices.byInvoiceNumber.set(inv.invoiceNumber, {
						id,
						importKey: inv.externalId,
						invoiceNumber: inv.invoiceNumber,
						job: jobRes.jobPbId,
						client: clientRes.clientPbId
					});
				}
			} else {
				const { id } = await createPbInvoice(
					authHeader,
					inv,
					jobRes.jobPbId,
					clientRes.clientPbId
				);
				rows.push({
					...row,
					action: 'created',
					pbId: id,
					summary: `${inv.invoiceNumber || inv.externalId || id} · created ${id}`
				});
				iStats.valid++;
				iStats.created++;
				const existing = {
					id,
					importKey: inv.externalId,
					invoiceNumber: inv.invoiceNumber,
					job: jobRes.jobPbId,
					client: clientRes.clientPbId
				};
				liveInvoices.byId.set(id, existing);
				if (inv.externalId) liveInvoices.byImportKey.set(inv.externalId, existing);
				if (inv.invoiceNumber) liveInvoices.byInvoiceNumber.set(inv.invoiceNumber, existing);
			}
		} catch (err) {
			rows.push({
				...row,
				action: 'error',
				errors: [err instanceof Error ? err.message : 'Invoice write failed'],
				summary: inv.invoiceNumber || inv.externalId || 'invoice'
			});
			iStats.error++;
		}
	}

	const totalValid = cStats.valid + jStats.valid + iStats.valid;
	const totalError = cStats.error + jStats.error + iStats.error;

	return {
		dryRun: false,
		commitSupported: { clients: true, jobs: true, invoices: true },
		summary: {
			clients: {
				total: preview.summary.clients.total,
				valid: cStats.valid,
				error: cStats.error,
				wouldCreate: cStats.created,
				wouldUpdate: cStats.updated,
				created: cStats.created,
				updated: cStats.updated,
				deferred: 0
			},
			jobs: {
				total: preview.summary.jobs.total,
				valid: jStats.valid,
				error: jStats.error,
				wouldCreate: jStats.created,
				wouldUpdate: jStats.updated,
				created: jStats.created,
				updated: jStats.updated,
				deferred: 0
			},
			invoices: {
				total: preview.summary.invoices.total,
				valid: iStats.valid,
				error: iStats.error,
				wouldCreate: iStats.created,
				wouldUpdate: iStats.updated,
				created: iStats.created,
				updated: iStats.updated,
				deferred: 0
			},
			totalValid,
			totalError,
			totalRows: preview.summary.totalRows
		},
		rows,
		payloadErrors: []
	};
}

/** @deprecated use commitBulk — kept for import path compatibility */
export async function commitBulkClients(
	authHeader: string,
	payload: BulkPayload
): Promise<BulkCommitResult> {
	return commitBulk(authHeader, payload);
}
