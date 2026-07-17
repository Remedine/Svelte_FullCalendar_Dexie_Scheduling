import { bulkJobToPbPayload } from './jobMap';
import { listAllRecords, pbCreate, pbUpdate } from './pbHttp';
import type { BulkJob } from './schema';
import type { ClientLookupIndex } from './pbClients';
import { normalizeEmail } from './clientMap';

export type ExistingJob = {
	id: string;
	importKey?: string;
	client?: string;
	title?: string;
};

export type JobLookupIndex = {
	byImportKey: Map<string, ExistingJob>;
	byId: Map<string, ExistingJob>;
};

export async function loadJobLookupIndex(authHeader: string): Promise<JobLookupIndex> {
	const byImportKey = new Map<string, ExistingJob>();
	const byId = new Map<string, ExistingJob>();
	const items = await listAllRecords(authHeader, 'jobs');
	for (const rec of items) {
		const existing: ExistingJob = {
			id: String(rec.id),
			importKey: rec.importKey ? String(rec.importKey) : undefined,
			client: rec.client ? String(rec.client) : undefined,
			title: rec.title ? String(rec.title) : undefined
		};
		byId.set(existing.id, existing);
		if (existing.importKey) byImportKey.set(existing.importKey, existing);
	}
	return { byImportKey, byId };
}

export type JobMatch =
	| { kind: 'create' }
	| { kind: 'update'; existing: ExistingJob }
	| { kind: 'error'; message: string };

export function matchExistingJob(job: BulkJob, index: JobLookupIndex): JobMatch {
	if (job.externalId) {
		const byKey = index.byImportKey.get(job.externalId);
		if (byKey) return { kind: 'update', existing: byKey };
	}
	return { kind: 'create' };
}

/** Resolve client PB id for a job row. */
export function resolveJobClientPbId(
	job: BulkJob,
	clientIndex: ClientLookupIndex
): { ok: true; clientPbId: string } | { ok: false; message: string } {
	if (job.clientPbId) {
		return { ok: true, clientPbId: job.clientPbId };
	}
	if (job.clientExternalId) {
		const c = clientIndex.byImportKey.get(job.clientExternalId);
		if (c) return { ok: true, clientPbId: c.id };
		return {
			ok: false,
			message: `clientExternalId "${job.clientExternalId}" not found in clients (importKey)`
		};
	}
	if (job.clientEmail) {
		const c = clientIndex.byEmail.get(normalizeEmail(job.clientEmail));
		if (c) return { ok: true, clientPbId: c.id };
		return {
			ok: false,
			message: `clientEmail "${job.clientEmail}" not found in clients`
		};
	}
	return { ok: false, message: 'Job needs clientExternalId, clientEmail, or clientPbId' };
}

export async function createPbJob(
	authHeader: string,
	job: BulkJob,
	clientPbId: string
): Promise<{ id: string }> {
	return pbCreate(authHeader, 'jobs', bulkJobToPbPayload(job, clientPbId));
}

export async function updatePbJob(
	authHeader: string,
	pbId: string,
	job: BulkJob,
	clientPbId: string
): Promise<{ id: string }> {
	return pbUpdate(authHeader, 'jobs', pbId, bulkJobToPbPayload(job, clientPbId));
}
