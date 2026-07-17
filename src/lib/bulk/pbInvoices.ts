import { normalizeEmail } from './clientMap';
import { bulkInvoiceToPbPayload } from './invoiceMap';
import { listAllRecords, pbCreate, pbUpdate } from './pbHttp';
import type { BulkInvoice } from './schema';
import type { ClientLookupIndex } from './pbClients';
import type { JobLookupIndex } from './pbJobs';

export type ExistingInvoice = {
	id: string;
	importKey?: string;
	invoiceNumber?: string;
	job?: string;
	client?: string;
};

export type InvoiceLookupIndex = {
	byImportKey: Map<string, ExistingInvoice>;
	byInvoiceNumber: Map<string, ExistingInvoice>;
	byId: Map<string, ExistingInvoice>;
};

export async function loadInvoiceLookupIndex(authHeader: string): Promise<InvoiceLookupIndex> {
	const byImportKey = new Map<string, ExistingInvoice>();
	const byInvoiceNumber = new Map<string, ExistingInvoice>();
	const byId = new Map<string, ExistingInvoice>();
	const items = await listAllRecords(authHeader, 'invoices');
	for (const rec of items) {
		const existing: ExistingInvoice = {
			id: String(rec.id),
			importKey: rec.importKey ? String(rec.importKey) : undefined,
			invoiceNumber: rec.invoiceNumber ? String(rec.invoiceNumber) : undefined,
			job: rec.job ? String(rec.job) : undefined,
			client: rec.client ? String(rec.client) : undefined
		};
		byId.set(existing.id, existing);
		if (existing.importKey) byImportKey.set(existing.importKey, existing);
		if (existing.invoiceNumber) byInvoiceNumber.set(existing.invoiceNumber, existing);
	}
	return { byImportKey, byInvoiceNumber, byId };
}

export type InvoiceMatch =
	| { kind: 'create' }
	| { kind: 'update'; existing: ExistingInvoice }
	| { kind: 'error'; message: string };

export function matchExistingInvoice(
	inv: BulkInvoice,
	index: InvoiceLookupIndex
): InvoiceMatch {
	const byKey = inv.externalId ? index.byImportKey.get(inv.externalId) : undefined;
	const byNum = inv.invoiceNumber ? index.byInvoiceNumber.get(inv.invoiceNumber) : undefined;

	if (byKey && byNum && byKey.id !== byNum.id) {
		return {
			kind: 'error',
			message: `importKey and invoiceNumber match different invoices (${byKey.id} vs ${byNum.id})`
		};
	}
	const existing = byKey || byNum;
	if (existing) return { kind: 'update', existing };
	return { kind: 'create' };
}

export function resolveInvoiceJobPbId(
	inv: BulkInvoice,
	jobIndex: JobLookupIndex
): { ok: true; jobPbId: string; clientPbId?: string } | { ok: false; message: string } {
	if (inv.jobPbId) {
		const j = jobIndex.byId.get(inv.jobPbId);
		return {
			ok: true,
			jobPbId: inv.jobPbId,
			clientPbId: j?.client
		};
	}
	if (inv.jobExternalId) {
		const j = jobIndex.byImportKey.get(inv.jobExternalId);
		if (j) return { ok: true, jobPbId: j.id, clientPbId: j.client };
		return {
			ok: false,
			message: `jobExternalId "${inv.jobExternalId}" not found in jobs (importKey)`
		};
	}
	return { ok: false, message: 'Invoice needs jobExternalId or jobPbId' };
}

export function resolveInvoiceClientPbId(
	inv: BulkInvoice,
	clientIndex: ClientLookupIndex,
	fallbackFromJob?: string
): { ok: true; clientPbId: string } | { ok: false; message: string } {
	if (inv.clientPbId) return { ok: true, clientPbId: inv.clientPbId };
	if (inv.clientExternalId) {
		const c = clientIndex.byImportKey.get(inv.clientExternalId);
		if (c) return { ok: true, clientPbId: c.id };
		return {
			ok: false,
			message: `clientExternalId "${inv.clientExternalId}" not found`
		};
	}
	if (inv.clientEmail) {
		const c = clientIndex.byEmail.get(normalizeEmail(inv.clientEmail));
		if (c) return { ok: true, clientPbId: c.id };
		return { ok: false, message: `clientEmail "${inv.clientEmail}" not found` };
	}
	if (fallbackFromJob) return { ok: true, clientPbId: fallbackFromJob };
	return {
		ok: false,
		message: 'Invoice needs client ref or a job that already has a client'
	};
}

export async function createPbInvoice(
	authHeader: string,
	inv: BulkInvoice,
	jobPbId: string,
	clientPbId: string
): Promise<{ id: string }> {
	return pbCreate(authHeader, 'invoices', bulkInvoiceToPbPayload(inv, jobPbId, clientPbId));
}

export async function updatePbInvoice(
	authHeader: string,
	pbId: string,
	inv: BulkInvoice,
	jobPbId: string,
	clientPbId: string
): Promise<{ id: string }> {
	return pbUpdate(
		authHeader,
		'invoices',
		pbId,
		bulkInvoiceToPbPayload(inv, jobPbId, clientPbId)
	);
}
