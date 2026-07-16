/**
 * Commit validated bulk client rows to PocketBase.
 */
import type { BulkClient, BulkPayload } from './schema';
import { runBulkDryRun, type BulkDryRunResult, type BulkRowResult } from './dryRun';
import {
	createPbClient,
	loadClientLookupIndex,
	matchExistingClient,
	updatePbClient,
	type ClientLookupIndex
} from './pbClients';

export type BulkCommitResult = Omit<BulkDryRunResult, 'dryRun'> & {
	dryRun: false;
};

/**
 * Apply client creates/updates. Jobs/invoices in the payload are left deferred.
 */
export async function commitBulkClients(
	authHeader: string,
	payload: BulkPayload
): Promise<BulkCommitResult> {
	const index = await loadClientLookupIndex(authHeader);
	const preview = runBulkDryRun(payload, {
		clientIndex: index,
		markJobsInvoicesDeferred: true
	});

	if (preview.payloadErrors.length) {
		return { ...preview, dryRun: false };
	}

	const liveIndex: ClientLookupIndex = {
		byImportKey: new Map(index.byImportKey),
		byEmail: new Map(index.byEmail)
	};

	const rows: BulkRowResult[] = [];
	let clientsValid = 0;
	let clientsError = 0;
	let created = 0;
	let updated = 0;

	for (const row of preview.rows) {
		if (row.entity !== 'clients') {
			rows.push(row);
			continue;
		}

		if (row.action === 'error' || !row.data) {
			rows.push(row);
			clientsError++;
			continue;
		}

		const client = row.data as BulkClient;
		try {
			const match = matchExistingClient(client, liveIndex);
			if (match.kind === 'error') {
				rows.push({
					...row,
					action: 'error',
					errors: [match.message]
				});
				clientsError++;
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
				clientsValid++;
				updated++;
				registerLive(liveIndex, id, client);
			} else {
				const { id } = await createPbClient(authHeader, client);
				rows.push({
					...row,
					action: 'created',
					pbId: id,
					summary: `${client.name} · created ${id}`
				});
				clientsValid++;
				created++;
				registerLive(liveIndex, id, client);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Client write failed';
			rows.push({
				...row,
				action: 'error',
				errors: [message],
				summary: client.name
			});
			clientsError++;
		}
	}

	const jobs = preview.summary.jobs;
	const invoices = preview.summary.invoices;
	const nonClientError = jobs.error + invoices.error;
	const nonClientValid = jobs.valid + invoices.valid;

	return {
		dryRun: false,
		commitSupported: { clients: true, jobs: false, invoices: false },
		summary: {
			clients: {
				total: preview.summary.clients.total,
				valid: clientsValid,
				error: clientsError,
				wouldCreate: created,
				wouldUpdate: updated,
				created,
				updated,
				deferred: 0
			},
			jobs,
			invoices,
			totalValid: clientsValid + nonClientValid,
			totalError: clientsError + nonClientError,
			totalRows: preview.summary.totalRows
		},
		rows,
		payloadErrors: []
	};
}

function registerLive(index: ClientLookupIndex, id: string, client: BulkClient) {
	const existing = {
		id,
		importKey: client.externalId,
		email: client.email,
		name: client.name
	};
	if (client.externalId) index.byImportKey.set(client.externalId, existing);
	const em = (client.email || '').trim().toLowerCase();
	if (em) index.byEmail.set(em, existing);
}
