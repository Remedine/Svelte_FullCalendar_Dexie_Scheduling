// src/lib/db/index.ts

import Dexie, { type EntityTable } from 'dexie';
import { pb, pullJobsFromServer } from '$lib/db/pb';
// )=- Import pure date helper extracted in Phase 2 so due date logic is testable and not duplicated.
// Reference: TESTING_PLAN.md + JOBS_AND_INVOICES_SPEC.md
import { calculateDueDate } from '$lib/utils/dates';
// )=- bcryptjs import removed (was only for PIN hashing in login/create/setInitialPin flows). PIN login deleted; password hashing is handled by PocketBase on the server side for email auth.

// Dynamic import to break circular dependency with auth.svelte.ts
// (auth.svelte.ts imports db at top level for auto session restore)
let auth: any = null;
import('$lib/stores/auth.svelte').then((module) => {
	auth = module.auth;
});

// SAFE CLONE HELPER
// )=- Exported for unit testing (Phase 0 of TESTING_PLAN.md).
// safeClone is used everywhere for optimistic writes and queue data to strip Svelte proxies
// and normalize Dates. Having it exported lets us test the exact serialization behavior
// that prevents "function" and proxy pollution in Dexie + sync.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
export function safeClone<T>(obj: T): T {
	if (!obj) return obj;
	try {
		return JSON.parse(
			JSON.stringify(obj, (key, value) => {
				if (value instanceof Date) return value.toISOString();
				if (typeof value === 'function' || value?.__isSvelteProxy) return undefined;
				return value;
			})
		);
	} catch {
		if (Array.isArray(obj)) return [...obj] as T;
		if (typeof obj === 'object' && obj !== null) return { ...obj } as T;
		return obj;
	}
}

// )=- Helper to convert data URL (from camera FileReader) back to Blob for proper PocketBase file field upload.
// PB file fields (like 'photo' on users) expect Blob/File in the update payload, not raw base64 data URLs.
// Without this, we get "validation_invalid_file" 400 on photo updates from profile page.
// )=- Exported for unit testing as part of Phase 0 test infrastructure.
export function dataUrlToBlob(dataUrl: string): Blob {
	const arr = dataUrl.split(',');
	const mimeMatch = arr[0].match(/:(.*?);/);
	const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
	const bstr = atob(arr[1]);
	let n = bstr.length;
	const u8arr = new Uint8Array(n);
	while (n--) {
		u8arr[n] = bstr.charCodeAt(n);
	}
	return new Blob([u8arr], { type: mime });
}

// ==================== AREA HELPER (simplified for fresh start) ====================
// )=- Removed legacy mapping. We now trust area IDs coming directly from options table.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
// )=- Exported for unit testing (Phase 0).
export function getValidAreaOfTown(area: string | undefined): string {
	return area || '';
}

// Interface Types
export interface Client {
	id?: string;
	pbId?: string;
	name: string;
	serviceAddressStreet: string;
	serviceAddressCity: string;
	serviceAddressState: string;
	serviceAddressZip: string;
	areaOfTown: string;
	preferredBillingMethod: 'email' | 'check' | 'invoice';
	phone: string;
	email: string;
	notes?: string;
	createdAt: Date | string;
	updatedAt: Date | string;
}

export interface Job {
	id?: string;
	// )=- Added pbId (was used throughout the sync layer and pull logic but missing from the interface — latent type hole).
	// This also makes the new invoice helpers and getPaginatedJobsForClient type-safe.
	pbId?: string;
	clientId: string;
	title: string;
	start: Date;
	end: Date;
	assignedCrew: string[];
	status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
	billableItems: Array<{
		title: string;
		price: number;
		quantity: number;
		total: number;
	}>;
	subtotal: number;
	taxRate: number;
	taxAmount: number;
	totalAmount: number;
	areaOfTown: string;
	notes?: string;
	cancelReason?: string;
	cancelNotes?: string;
	cancelledAt?: Date;
	// )=- Made optional because createJob (and normal job creation) never supplies it; only cancelJob does.
	// This was a latent type inaccuracy exposed when we started adding fields to the interface.
	cancelledBy?: string;
	// )=- Added for legacy invoice imports (handwritten OCR / Asana CSV). Allows imperfect imported jobs
	// to still be searchable and linkable while we tolerate missing fields. See JOBS_AND_INVOICES_SPEC.md.
	importSource?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface User {
	id?: string;
	pbId?: string;
	firstName?: string; // )=- Optional for backward compat with existing data. New records always set via createUser/edit.
	lastName?: string;
	name: string; // derived or legacy full name for compat with assignedCrew arrays and old displays
	pinHash: string; // )=- Legacy only (PIN login removed). Kept so old Dexie rows with pinHash don't break on read/put. Ignored everywhere.
	email?: string;
	role: 'admin' | 'crew';
	photo?: string;
	active: boolean;
	forcePinUpdate: boolean; // )=- Legacy flag (PIN removed). No code paths read or act on it for auth gating anymore.
	forcePhotoUpdate: boolean;
	verified?: boolean; // )=- PB email verification flag for the user record. Optional for legacy rows.
	createdAt: Date;
	updatedAt: Date;
}

export interface AppOptions {
	id: string;
	taxRate: number;
	defaultJobDurationHours: number;
	defaultBillableItems: Array<{
		title: string;
		price: number;
		quantity?: number;
		hours?: number;
		isDefault?: boolean;
	}>;
	// )=- Using array to match how ClientForm and clients page consume the data
	areasOfTown: Array<{
		id: string;
		label: string;
		color: string;
		sortOrder?: number;
	}>;
	cancelReasons: string[];
	invoiceDueDays: number;
	lastUpdated: Date;
	updatedBy: string;
}

// )=- New first-class Invoice entity (per JOBS_AND_INVOICES_SPEC.md).
// Statuses are explicit; overdue is always derived at read time.
// Supports primary editable .docx + separate supporting documents for the 900+ legacy imports.
// Files themselves live in PocketBase; Dexie only stores metadata (no large binaries except user avatars).
export interface Invoice {
	id?: string;
	pbId?: string;
	jobId: string; // local or PB id — resolved during sync like clientId on jobs
	clientId: string; // denormalized for queries and legacy import flexibility
	status: 'draft' | 'generated' | 'sent' | 'paid';
	dueDate: Date;
	paidAt?: Date;
	amount: number;
	// Optional snapshot so historical invoices don't shift if the job billables are later edited
	billableItems?: Array<{
		title: string;
		price: number;
		quantity: number;
		total: number;
	}>;
	notes?: string;
	// )=- 'asana-export', 'handwritten-ocr', 'manual', etc. Must allow imperfect data for imports.
	importSource?: string;
	// The one editable .docx the user reviews, manually edits in Word, then re-uploads.
	primaryInvoiceFile?: {
		filename: string;
	};
	// Scans, photos, original exports, etc. Stored separately from the primary editable doc.
	supportingDocuments?: Array<{
		filename: string;
		type?: string;
	}>;
	createdAt: Date;
	updatedAt: Date;
}

// Simple sync queue
export interface SyncQueueItem {
	id?: string;
	type: 'create' | 'update' | 'delete';
	// )=- Added 'invoices' so the existing optimistic + queue + pull pattern works for the new entity.
	collection: 'jobs' | 'clients' | 'users' | 'invoices';
	recordId: string;
	data?: any;
	createdAt: Date;
}

const db = new Dexie('CapitalCityWindows') as Dexie & {
	clients: EntityTable<Client, 'id'>;
	jobs: EntityTable<Job, 'id'>;
	users: EntityTable<User, 'id'>;
	syncQueue: EntityTable<SyncQueueItem, 'id'>;
	options: EntityTable<AppOptions, 'id'>;
	// )=- New invoices store. Indexes chosen for the main access patterns:
	// - jobId for the common "get invoice for this job" lookup in details modal & cards
	// - clientId for the expandable related jobs on the clients page
	// - status + dueDate for facets, overdue computation, and has/no-invoice filtering
	// - pbId added in v19 (was missing, causing SchemaError on pull after first PB invoice save)
	invoices: EntityTable<Invoice, 'id'>;
};

// )=- Bumped to version 19 to add pbId index to the invoices object store.
// This fixes the exact Dexie SchemaError the user just reported:
//   "KeyPath pbId on object store invoices is not indexed"
//   (triggered in pullInvoicesFromServer at the `db.invoices.where('pbId').equals(rec.id).first()` line
//    during refreshFromServer on /jobs after the first successful invoice push to PocketBase).
// Root cause: The Invoice interface + createInvoice/updateInvoice queue code + pull merge logic
// (and get-by-pbId fallbacks) all assumed/used pbId on invoices (like we did for jobs/clients/users),
// but when the invoices store was first declared the .stores() string omitted `, pbId`.
// Dexie only allows .where() on declared indexes/primary keys. Adding the index in a new version(19)
// lets Dexie upgrade the DB and makes the "find existing local by server pbId for last-write-wins + stale delete"
// work after the first server invoice appears.
// Previous v18 bump was for jobs pbId (same class of bug).
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md (Phase 1/2 data + sync)
db.version(19).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown, importSource, pbId',
	users:
		'id, firstName, lastName, name, email, role, active, forcePhotoUpdate, forcePinUpdate, pbId, verified', // forcePinUpdate + pinHash/verified kept in schema for legacy row compat (PIN auth deleted)
	syncQueue: '++id, type, collection, recordId, createdAt',
	options: 'id',
	invoices: 'id, jobId, clientId, status, dueDate, importSource, pbId'
});

// ==================== JOB FUNCTIONS ====================

export async function createJob(jobData: any): Promise<string> {
	const billableItems = jobData.billableItems?.length
		? jobData.billableItems.map((item: any) => ({ ...item }))
		: [{ title: String(jobData.title), price: 450, quantity: 1, total: 450 }];

	const newId = jobData.id || crypto.randomUUID();

	const realClientId = await resolveClientPbId(jobData.clientId);

	if (!realClientId) {
		console.error('❌ Could not resolve client ID for job creation');
		throw new Error('Invalid client selected');
	}

	// )=- Pull tax rate from options table instead of hardcoded value
	const optionsRecord = await db.options.get('1');
	const taxRate = optionsRecord?.taxRate ?? 0.08;

	const newJob = safeClone({
		id: newId,
		clientId: realClientId,
		title: String(jobData.title),
		start: new Date(jobData.start),
		end: new Date(jobData.end),
		assignedCrew: [...(jobData.assignedCrew || [])],
		areaOfTown: getValidAreaOfTown(jobData.areaOfTown),
		status: 'scheduled' as const,
		notes: jobData.notes || undefined,
		createdAt: new Date(),
		updatedAt: new Date(),
		billableItems,
		subtotal:
			jobData.subtotal ||
			billableItems.reduce((sum: number, item: any) => sum + (item.total || 0), 0),
		taxRate,
		taxAmount: jobData.taxAmount || 0,
		totalAmount: jobData.totalAmount || 0
	});

	const id = await db.jobs.add(newJob);
	console.log(`✅ Job created locally (optimistic): ${id}`);

	await addToSyncQueue({
		type: 'create',
		collection: 'jobs',
		recordId: String(id),
		data: newJob
	});

	if (navigator.onLine) await processSyncQueue();

	return String(id);
}

export async function updateJob(jobId: string, updates: Partial<Job>) {
	const resolvedUpdates = { ...updates };

	if (resolvedUpdates.clientId) {
		resolvedUpdates.clientId = await resolveClientPbId(resolvedUpdates.clientId);
	}

	const safeUpdates = safeClone({ ...updates, updatedAt: new Date() });
	await db.jobs.update(jobId, safeUpdates);

	const updatedJob = await db.jobs.get(jobId);
	if (updatedJob) {
		await addToSyncQueue({
			type: 'update',
			collection: 'jobs',
			recordId: jobId,
			data: safeUpdates
		});
	}

	if (navigator.onLine) await processSyncQueue();
}

export async function cancelJob(jobId: string, cancelReason: string, notes?: string) {
	const currentUser = auth?.currentUser;

	const updates = safeClone({
		status: 'cancelled' as const,
		cancelReason,
		cancelledAt: new Date(),
		cancelledBy: currentUser?.id || null,
		notes: notes || undefined,
		updatedAt: new Date()
	});

	await db.jobs.update(jobId, updates);

	await addToSyncQueue({
		type: 'update',
		collection: 'jobs',
		recordId: jobId,
		data: updates
	});

	if (navigator.onLine) await processSyncQueue();
	console.log(`✅ Job ${jobId} cancelled by ${currentUser?.name || 'Unknown'}`);
}

export async function updateJobDates(jobId: string, newStart: Date | null, newEnd: Date | null) {
	if (!newStart) {
		console.error('updateJobDates: newStart is null');
		return;
	}

	const job = await db.jobs.get(jobId);
	if (!job) {
		console.error('updateJobDates: job not found', jobId);
		return;
	}

	const realId = job.pbId || job.id || jobId;
	const resolvedClientId = job.clientId ? await resolveClientPbId(job.clientId) : undefined;
	const finalEnd = newEnd || new Date(newStart.getTime() + 4 * 60 * 60 * 1000);

	const updates = safeClone({
		start: newStart,
		end: finalEnd,
		...(resolvedClientId && { clientId: resolvedClientId }),
		updatedAt: new Date()
	});

	await db.jobs.update(jobId, updates);

	await addToSyncQueue({
		type: 'update',
		collection: 'jobs',
		recordId: realId,
		data: updates
	});

	if (navigator.onLine) await processSyncQueue();
}

export async function getUpcomingJobs(limit = 10): Promise<Job[]> {
	const now = new Date();
	return await db.jobs
		.where('start')
		.aboveOrEqual(now)
		.and((job) => job.status !== 'cancelled')
		.limit(limit)
		.toArray();
}

export async function getJobsForRange(
	start: Date,
	end: Date,
	includeCancelled = false
): Promise<Job[]> {
	const raw = await db.jobs
		.where('start')
		.between(start, end, true, true)
		.and((job) => {
			if (includeCancelled) return true;
			return job.status !== 'cancelled';
		})
		.toArray();

	return dedupJobs(raw);
}

/**
 * Deduplicate an array of jobs by canonical key (pbId preferred, then local id).
 * Central helper so the calendar snapshot, client page lists, etc. all see the same unique set
 * even when Dexie has accumulated (pbId + local-uuid) records for the same logical job.
 */
export function dedupJobs(list: Job[]): Job[] {
	const byKey = new Map<string, Job>();
	for (const j of list) {
		const key = j.pbId || j.id || '';
		if (!key) continue;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, j);
		} else {
			// Prefer the canonical server record (where Dexie id === pbId) over a local-UUID record
			// that has pbId set. This keeps the "official" row from PB.
			const existingIsCanonical = existing.id === existing.pbId;
			const candidateIsCanonical = j.id === j.pbId;
			if (candidateIsCanonical && !existingIsCanonical) {
				byKey.set(key, j);
			}
			// otherwise keep existing (prefer first seen, or canonical)
		}
	}
	return Array.from(byKey.values());
}

// )=- New paginated job query specifically for the expandable "Related Jobs" lists on the clients page.
// Defensive matching on local clientId OR the client's pbId (exactly like loadClientsWithLastJob).
// Returns most recent first, limited for pagination (default 10 as specified).
// includeCancelled allows future "include cancelled" facet usage.
// Reference: JOBS_AND_INVOICES_SPEC.md
export async function getPaginatedJobsForClient(
	clientId: string,
	{
		limit = 10,
		offset = 0,
		includeCancelled = false
	}: { limit?: number; offset?: number; includeCancelled?: boolean } = {}
): Promise<Job[]> {
	const client = await db.clients.get(clientId);
	const possibleIds = new Set<string>();
	if (clientId) possibleIds.add(clientId);
	if (client?.pbId) possibleIds.add(client.pbId);

	let jobs = await db.jobs
		.where('clientId')
		.anyOf([...possibleIds])
		.toArray();

	if (!includeCancelled) {
		jobs = jobs.filter((j: Job) => j.status !== 'cancelled');
	}

	// Dedup using shared helper (prevents 2x in related jobs list when Dexie has local + synced records).
	jobs = dedupJobs(jobs);

	// Most recent first (consistent with existing client "last job" / "upcoming" logic)
	jobs.sort((a: Job, b: Job) => new Date(b.start).getTime() - new Date(a.start).getTime());

	return jobs.slice(offset, offset + limit);
}

// ==================== INVOICE FUNCTIONS ====================
// )=- Core CRUD + lookup helpers for the new first-class Invoice entity.
// Follows the exact same optimistic local + queue + processSyncQueue pattern as jobs/clients.
// File handling (primaryInvoiceFile + supportingDocuments) is intentionally left as metadata only here;
// the actual PB file upload logic will be added in Phase 2 (per spec).
// All dates are normalized to Date objects. Snapshots (billableItems) are cloned.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md

export async function createInvoice(
	invoiceData: Partial<Invoice> & { id?: string },
	files?: {
		primary?: { blob: Blob; filename: string };
		supporting?: Array<{ blob: Blob; filename: string; type?: string }>;
	}
): Promise<string> {
	const newId = invoiceData.id || crypto.randomUUID();

	// Resolve both client and job to their real (PB-preferred) ids for sync consistency.
	const realClientId = await resolveClientPbId(invoiceData.clientId || '');

	// Try to get the canonical job id (prefer pbId if the job has been synced)
	const job = invoiceData.jobId ? await db.jobs.get(invoiceData.jobId) : null;
	const realJobId = job?.pbId || job?.id || invoiceData.jobId || '';

	// )=- Build metadata-only record for Dexie (no blobs stored locally per spec: only avatars keep data URLs).
	// File blobs (for .docx and scans) are passed only via the queue data for sync (see _files below).
	const newInvoice = safeClone({
		...invoiceData,
		id: newId,
		clientId: realClientId || invoiceData.clientId || '',
		jobId: realJobId,
		createdAt: new Date(),
		updatedAt: new Date(),
		status: invoiceData.status || 'draft',
		dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : new Date(),
		amount: Number(invoiceData.amount) || 0,
		billableItems: invoiceData.billableItems
			? invoiceData.billableItems.map((item: any) => ({ ...item }))
			: undefined,
		// Store only filenames in the persistent Dexie record
		primaryInvoiceFile: files?.primary
			? { filename: files.primary.filename }
			: invoiceData.primaryInvoiceFile,
		supportingDocuments: files?.supporting
			? files.supporting.map((s) => ({ filename: s.filename, type: s.type }))
			: invoiceData.supportingDocuments
	});

	const id = await db.invoices.add(newInvoice);

	// )=- Queue data includes _files (blobs) only for the sync step. The actual invoice record in Dexie stays metadata-only.
	// This matches the pattern used for user passwords (only in queueData) and follows "don't keep image/document files locally".
	const queueData = {
		...newInvoice,
		...(files && { _files: files })
	};

	await addToSyncQueue({
		type: 'create',
		collection: 'invoices',
		recordId: String(id),
		data: queueData
	});

	if (navigator.onLine) await processSyncQueue();

	// )=- Cast to string because Dexie add can return the key type which the project's other create* functions also rely on.
	// We guarantee a string id via crypto.randomUUID() fallback.
	const returnedId = String(id);
	console.log(`✅ Invoice created locally (optimistic): ${returnedId}`);
	return returnedId;
}

export async function updateInvoice(
	invoiceId: string,
	updates: Partial<Invoice>,
	files?: {
		primary?: { blob: Blob; filename: string };
		supporting?: Array<{ blob: Blob; filename: string; type?: string }>;
	}
) {
	const safeUpdates = safeClone({ ...updates, updatedAt: new Date() });

	// If clientId or jobId are being updated, resolve them
	if (safeUpdates.clientId) {
		safeUpdates.clientId = await resolveClientPbId(safeUpdates.clientId);
	}
	if (safeUpdates.jobId) {
		const job = await db.jobs.get(safeUpdates.jobId);
		if (job) {
			safeUpdates.jobId = job.pbId || job.id || safeUpdates.jobId;
		}
	}

	// )=- Apply filename metadata for any new/replaced files without storing blobs in Dexie.
	// Primary is always a full replace (the editable .docx).
	// Supporting is additive (append new scans/PDFs for legacy or extras) so we don't lose previous entries in Dexie.
	// The actual new blobs go in _files for the queue/FormData; PB multi-file update receives only the delta files (existing stay on server).
	// On next pull the full authoritative list comes back.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md
	if (files?.primary) {
		safeUpdates.primaryInvoiceFile = { filename: files.primary.filename };
	}
	if (files?.supporting?.length) {
		const current = await db.invoices.get(invoiceId);
		const prev = current?.supportingDocuments || [];
		const added = files.supporting.map((s) => ({ filename: s.filename, type: s.type }));
		safeUpdates.supportingDocuments = [...prev, ...added];
	}

	await db.invoices.update(invoiceId, safeUpdates);

	// )=- Include _files (blobs) only in queue data for the sync step. Dexie record keeps only metadata.
	// )=- If this invoice currently has no pbId (local-only, original create never landed on PB, or this is the first
	// mutation like Regenerate on a draft that was only local), promote the queue item to 'create' and enrich
	// the data with the full current Dexie record. This ensures the processor create branch runs (with the new
	// primary/supporting files) instead of queuing an 'update' that would target a non-existent PB id and 404.
	// The processor will still handle races (if a create landed between queue and process, the create branch can
	// be extended later to fall back to update if pbId now present).
	// This eliminates the 404 PATCH the user is seeing in logs for "regenerate on local invoice without PB row".
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md
	const current = await db.invoices.get(invoiceId);
	const hasPbId = !!current?.pbId;
	const effectiveType = hasPbId ? 'update' : 'create';

	let queueData = {
		...safeUpdates,
		...(files && { _files: files })
	};

	if (!hasPbId && current) {
		// Enrich so create processor gets jobId, clientId, amount, billableItems, status, dueDate etc. + the _files delta.
		queueData = {
			...current,
			...safeUpdates,
			...(files && { _files: files })
		};
	}

	await addToSyncQueue({
		type: effectiveType,
		collection: 'invoices',
		recordId: invoiceId,
		data: queueData
	});

	if (navigator.onLine) await processSyncQueue();
	console.log(`✅ Invoice ${invoiceId} updated locally (optimistic)`);
}

// )=- Shared helper for overdue computation (used in jobs cards, clients related jobs, modal, facets).
// Overdue = has invoice, not 'paid', and dueDate in the past.
// Kept here so it's consistent and easy to unit test / reuse. Matches the derived in JobDetailsModal.
// )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 (overdue visual treatment everywhere) + Remedine/Svelte_FullCalendar_Dexie_Scheduling
export function isInvoiceOverdue(invoice?: Invoice | null): boolean {
	if (!invoice) return false;
	if (invoice.status === 'paid') return false;
	const due = invoice.dueDate instanceof Date ? invoice.dueDate : new Date(invoice.dueDate);
	return due < new Date();
}

export async function getInvoiceForJob(jobId: string): Promise<Invoice | undefined> {
	if (!jobId) return undefined;

	// Direct match (most common case)
	let invoice = await db.invoices.where('jobId').equals(jobId).first();
	if (invoice) return invoice;

	// Defensive: if the passed jobId is a local id, try the job's pbId (or vice versa)
	const job = await db.jobs.get(jobId);
	if (job?.pbId) {
		invoice = await db.invoices.where('jobId').equals(job.pbId).first();
		if (invoice) return invoice;
	}

	// Also try the reverse: if jobId passed is a pbId, see if any invoice points to the local job id
	// (rare after normalization, but cheap)
	const localJob = await db.jobs.where('pbId').equals(jobId).first();
	if (localJob) {
		invoice = await db.invoices.where('jobId').equals(localJob.id!).first();
		if (invoice) return invoice;
	}

	return undefined;
}

export async function getInvoicesForClient(clientId: string, limit = 50): Promise<Invoice[]> {
	const client = await db.clients.get(clientId);
	const possibleIds = new Set<string>();
	if (clientId) possibleIds.add(clientId);
	if (client?.pbId) possibleIds.add(client.pbId);

	return await db.invoices
		.where('clientId')
		.anyOf([...possibleIds])
		.sortBy('dueDate')
		.then((invs: Invoice[]) => invs.slice(0, limit));
}

// )=- generateInvoiceDocx helper (Phase 4).
// Uses the existing docx + file-saver dependencies to produce an editable .docx the user can open in Word.
// Called from the JobInvoicePanel (or directly from modal for the "Generate Draft" button).
// The returned Blob is immediately downloadable and can be passed to createInvoice/updateInvoice via the files param
// so it gets stored in PB as the primaryInvoiceFile.
// We keep the document simple but professional for now (title, client info, billables table, totals, notes).
// This is the implementation of the "one-click Mark Complete → auto-generated editable Word invoice" promise in the readme.
// Uses browser-safe Packer.toBlob() (not toBuffer) so it runs in the SvelteKit/Vite client without nodebuffer errors.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md
export async function generateInvoiceDocx(
	job: Job,
	client: Client | null | undefined,
	opts: { taxRate?: number; invoiceDueDays?: number; businessName?: string } = {}
): Promise<Blob> {
	// Dynamic import so we don't pull docx into every bundle that imports db
	const {
		Document,
		Packer,
		Paragraph,
		Table,
		TableRow,
		TableCell,
		TextRun,
		AlignmentType,
		BorderStyle
	} = await import('docx');

	const businessName = opts.businessName || 'Capital City Windows';
	const dueDate = job.end
		? new Date(new Date(job.end).getTime() + (opts.invoiceDueDays ?? 30) * 86400000)
		: null;

	const billableRows = (job.billableItems || []).map(
		(item: any, idx: number) =>
			new TableRow({
				children: [
					new TableCell({
						children: [
							new Paragraph({
								children: [new TextRun({ text: item.title || `Item ${idx + 1}` })]
							})
						]
					}),
					new TableCell({
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								children: [new TextRun({ text: String(item.quantity || 1) })]
							})
						]
					}),
					new TableCell({
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								children: [new TextRun({ text: `$${(item.price || 0).toFixed(2)}` })]
							})
						]
					}),
					new TableCell({
						children: [
							new Paragraph({
								alignment: AlignmentType.RIGHT,
								children: [new TextRun({ text: `$${(item.total || 0).toFixed(2)}` })]
							})
						]
					})
				]
			})
	);

	const doc = new Document({
		sections: [
			{
				properties: {},
				children: [
					new Paragraph({
						alignment: AlignmentType.CENTER,
						children: [new TextRun({ text: businessName, bold: true, size: 36 })]
					}),
					new Paragraph({
						alignment: AlignmentType.CENTER,
						children: [new TextRun({ text: 'INVOICE', bold: true, size: 28, color: '1e40af' })]
					}),
					new Paragraph({ text: '' }),
					new Paragraph({
						children: [new TextRun({ text: `Job: ${job.title || 'Untitled'}`, bold: true })]
					}),
					new Paragraph({
						children: [new TextRun({ text: `Date: ${new Date(job.start).toLocaleDateString()}` })]
					}),
					new Paragraph({
						children: [new TextRun({ text: `Client: ${client?.name || job.clientId}` })]
					}),
					new Paragraph({ text: '' }),
					new Table({
						rows: [
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph({
												children: [new TextRun({ text: 'Description', bold: true })]
											})
										]
									}),
									new TableCell({
										children: [
											new Paragraph({
												alignment: AlignmentType.RIGHT,
												children: [new TextRun({ text: 'Qty', bold: true })]
											})
										]
									}),
									new TableCell({
										children: [
											new Paragraph({
												alignment: AlignmentType.RIGHT,
												children: [new TextRun({ text: 'Unit', bold: true })]
											})
										]
									}),
									new TableCell({
										children: [
											new Paragraph({
												alignment: AlignmentType.RIGHT,
												children: [new TextRun({ text: 'Total', bold: true })]
											})
										]
									})
								]
							}),
							...billableRows,
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph({ children: [new TextRun({ text: 'Subtotal', bold: true })] })
										]
									}),
									new TableCell({ children: [] }),
									new TableCell({ children: [] }),
									new TableCell({
										children: [
											new Paragraph({
												alignment: AlignmentType.RIGHT,
												children: [
													new TextRun({ text: `$${(job.subtotal || 0).toFixed(2)}`, bold: true })
												]
											})
										]
									})
								]
							}),
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph({
												children: [new TextRun({ text: `Tax (${(job.taxRate || 0).toFixed(1)}%)` })]
											})
										]
									}),
									new TableCell({ children: [] }),
									new TableCell({ children: [] }),
									new TableCell({
										children: [
											new Paragraph({
												alignment: AlignmentType.RIGHT,
												children: [new TextRun({ text: `$${(job.taxAmount || 0).toFixed(2)}` })]
											})
										]
									})
								]
							}),
							new TableRow({
								children: [
									new TableCell({
										children: [
											new Paragraph({ children: [new TextRun({ text: 'TOTAL', bold: true })] })
										]
									}),
									new TableCell({ children: [] }),
									new TableCell({ children: [] }),
									new TableCell({
										children: [
											new Paragraph({
												alignment: AlignmentType.RIGHT,
												children: [
													new TextRun({ text: `$${(job.totalAmount || 0).toFixed(2)}`, bold: true })
												]
											})
										]
									})
								]
							})
						]
					}),
					new Paragraph({ text: '' }),
					new Paragraph({
						children: [
							new TextRun({ text: `Due Date: ${dueDate ? dueDate.toLocaleDateString() : '—'}` })
						]
					}),
					new Paragraph({ text: '' }),
					new Paragraph({
						children: [new TextRun({ text: job.notes ? `Notes: ${job.notes}` : '' })]
					}),
					new Paragraph({ text: 'Thank you for your business!' })
				]
			}
		]
	});

	const blob = await Packer.toBlob(doc);
	// )=- Switched from Packer.toBuffer() (Node-only, causes "nodebuffer is not supported by this platform" in browser via jszip/docx internals) to Packer.toBlob().
	// toBlob() is the official browser path, returns a proper Blob directly (correct mime). Matches exactly what JobInvoicePanel passes to createInvoice/updateInvoice _files.primary and what saveAs expects.
	// This fixes the exact error from the pasted logs (JobInvoicePanel:69 during handleGenerateDraft / handleRegenerate).
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md Phase 4. Also keeps the dynamic import.
	return blob;
}

// )=- Convenience helper used by "Mark Complete" flow and draft generation.
// Creates (or returns existing) invoice linked to the job, with proper dueDate from options.
// Does NOT generate the .docx here — that will live in the UI layer / dedicated helper (Phase 4).
export async function ensureInvoiceForJob(
	job: Job,
	status: Invoice['status'] = 'generated'
): Promise<string> {
	const existing = await getInvoiceForJob(job.id!);
	if (existing) {
		// If we are "completing" a job that only had a draft, bump the status
		if (existing.status === 'draft' && status === 'generated') {
			await updateInvoice(existing.id!, { status: 'generated', updatedAt: new Date() });
		}
		return existing.id!;
	}

	const optionsRecord = await db.options.get('1');
	const dueDays = optionsRecord?.invoiceDueDays ?? 30;
	// )=- Now uses the extracted pure calculateDueDate (Phase 2 improvement for testability).
	// The math itself is covered by dedicated unit tests in dates.test.ts.
	const dueDate = calculateDueDate(new Date(job.end), dueDays);

	const invoiceData: Partial<Invoice> = {
		jobId: job.id,
		clientId: job.clientId,
		status,
		dueDate,
		amount: job.totalAmount,
		billableItems: job.billableItems ? job.billableItems.map((i: any) => ({ ...i })) : undefined,
		notes: job.notes,
		importSource: job.importSource
	};

	return await createInvoice(invoiceData);
}

// ==================== CLIENT FUNCTIONS ====================

export async function createClient(
	clientData: Omit<Client, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<string> {
	const newId = clientData.id || crypto.randomUUID();

	const newClient = safeClone({
		...clientData,
		areaOfTown: getValidAreaOfTown(clientData.areaOfTown),
		id: newId,
		createdAt: new Date(),
		updatedAt: new Date()
	});

	const id = await db.clients.add(newClient);

	await addToSyncQueue({
		type: 'create',
		collection: 'clients',
		recordId: String(id),
		data: newClient
	});

	if (navigator.onLine) await processSyncQueue();

	return String(id);
}

export async function updateClient(clientId: string, updates: Partial<Client>) {
	const mergedUpdates = safeClone({
		...updates,
		areaOfTown: getValidAreaOfTown(updates.areaOfTown),
		updatedAt: new Date()
	});

	await db.clients.update(clientId, mergedUpdates);

	await addToSyncQueue({
		type: 'update',
		collection: 'clients',
		recordId: clientId,
		data: mergedUpdates
	});

	if (navigator.onLine) await processSyncQueue();
	console.log(`✅ Client ${clientId} updated locally (optimistic)`);
}

export async function deleteClient(clientId: string) {
	const exists = await db.clients.get(clientId);
	if (!exists) return;

	const idToDelete = await resolveClientPbId(clientId);

	await db.clients.delete(clientId);

	await addToSyncQueue({
		type: 'delete',
		collection: 'clients',
		recordId: idToDelete
	});

	if (navigator.onLine) await processSyncQueue();
}

// )=- Updated createUser for email/password only auth flow: requires firstName, lastName, email, password (for PB auth record + verification).
// Sets derived 'name'. No pinHash/forcePinUpdate/verified set here (those are legacy).
// Password is passed only in queue data for PB create (PB handles hashing; not stored in local Dexie user).
// Follows clients/jobs pattern exactly for local id vs PB id.
export async function createUser(
	// )=- PIN login removed; creation no longer emits verified/forcePinUpdate/pinHash.
	userData: Omit<User, 'id' | 'createdAt' | 'updatedAt' | 'pbId' | 'name' | 'verified'> & {
		password: string;
	}
): Promise<string> {
	const { password, firstName, lastName, ...rest } = userData;
	const newId = crypto.randomUUID();
	const fullName = `${firstName} ${lastName}`.trim();

	// Normalize email to lowercase early (prevents PB validation issues with mixed case and keeps consistent storage).
	if (typeof (rest as any).email === 'string') {
		(rest as any).email = (rest as any).email.trim().toLowerCase();
	}

	const newUser = safeClone({
		...rest,
		id: newId,
		firstName,
		lastName,
		name: fullName,
		// )=- Do not set pinHash/forcePinUpdate/verified on new records (PIN login completely removed).
		// Interface + Dexie schema retain the columns purely for reading old migrated data without errors.
		createdAt: new Date(),
		updatedAt: new Date()
	});

	const id = await db.users.add(newUser);

	// Queue data includes password only for the PB side create (not persisted locally).
	const queueData = {
		...newUser,
		password
	};

	await addToSyncQueue({
		type: 'create',
		collection: 'users',
		recordId: String(id),
		data: queueData
	});

	if (navigator.onLine) await processSyncQueue();

	return String(id);
}

export async function updateUser(userId: string, updates: Partial<User>) {
	const safeUpdates = safeClone({ ...updates, updatedAt: new Date() });
	await db.users.update(userId, safeUpdates);

	await addToSyncQueue({
		type: 'update',
		collection: 'users',
		recordId: userId,
		data: safeUpdates
	});

	if (navigator.onLine) await processSyncQueue();
}

export async function deleteUser(userId: string) {
	const exists = await db.users.get(userId);
	if (!exists) return;

	const idToDelete = exists.pbId || userId;

	await db.users.delete(userId);

	await addToSyncQueue({
		type: 'delete',
		collection: 'users',
		recordId: idToDelete
	});

	if (navigator.onLine) await processSyncQueue();
}

export async function resolveClientPbId(localClientId: string): Promise<string> {
	if (!localClientId) return localClientId;

	let client = await db.clients.get(localClientId);
	if (client?.pbId) return client.pbId;

	await new Promise((r) => setTimeout(r, 60));
	client = await db.clients.get(localClientId);
	return client?.pbId || client?.id || localClientId;
}

// ==================== SYNC QUEUE ====================

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'createdAt'>) {
	await db.syncQueue.add({ ...item, createdAt: new Date() });
}

export async function processSyncQueue() {
	const items = await db.syncQueue.orderBy('createdAt').toArray();

	for (const item of items) {
		try {
			if (item.collection === 'jobs') {
				if (item.type === 'create') {
					const data = item.data;
					const realClientId = await resolveClientPbId(data.clientId || data.client);

					const pbPayload = safeClone({
						title: data.title,
						start: data.start instanceof Date ? data.start.toISOString() : data.start,
						end: data.end instanceof Date ? data.end.toISOString() : data.end,
						client: realClientId,
						assignedCrew: data.assignedCrew || [],
						areaOfTown: data.areaOfTown,
						notes: data.notes || undefined,
						billableItems: data.billableItems || [],
						subtotal: Number(data.subtotal) || 0,
						taxRate: Number(data.taxRate) || 0.08,
						taxAmount: Number(data.taxAmount) || 0,
						totalAmount: Number(data.totalAmount) || 0,
						status: data.status || 'scheduled'
					});

					try {
						const record = await pb.collection('jobs').create(pbPayload);
						await db.jobs.update(item.recordId, { pbId: record.id });
						console.log(`✅ Job pushed to PocketBase: ${record.id}`);
					} catch (err: any) {
						console.error('❌ Job create failed:', JSON.stringify(err.response?.data, null, 2));
					}
				} else if (item.type === 'update') {
					const job = await db.jobs.get(item.recordId);
					const realId = job?.pbId || job?.id || item.recordId;

					try {
						await pb.collection('jobs').update(realId, item.data);
						console.log(`✅ Job updated in PocketBase: ${realId}`);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							console.error('❌ Job update failed:', JSON.stringify(err.response?.data, null, 2));
						}
					}
				} else if (item.type === 'delete') {
					const job = await db.jobs.get(item.recordId);
					const realId = job?.pbId || job?.id || item.recordId;

					try {
						await pb.collection('jobs').delete(realId);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				}
			}

			if (item.collection === 'clients') {
				if (item.type === 'create') {
					const { id, ...clientData } = item.data;

					const safeClientData = safeClone({
						...clientData,
						areaOfTown: getValidAreaOfTown(clientData.areaOfTown)
					});

					try {
						const record = await pb.collection('clients').create(safeClientData);

						const existing = await db.clients.get(item.recordId);
						if (existing) {
							await db.clients.put({ ...existing, pbId: record.id });
						} else {
							await db.clients.update(item.recordId, { pbId: record.id });
						}

						console.log(`✅ Client synced to PocketBase: ${record.id}`);

						const pendingDeletes = await db.syncQueue
							.where('recordId')
							.equals(item.recordId)
							.and((q) => q.type === 'delete' && q.collection === 'clients')
							.toArray();

						for (const q of pendingDeletes) {
							await db.syncQueue.update(q.id!, { recordId: record.id });
						}
					} catch (err: any) {
						console.error('❌ Client sync failed with 400:', err.response?.data);
						throw err;
					}
				} else if (item.type === 'update') {
					try {
						const currentClient = await db.clients.get(item.recordId);
						const realId = currentClient?.pbId || currentClient?.id || item.recordId;

						const { id, pbId, createdAt: _createdAt, updatedAt: _updatedAt, ...cleanData } = item.data;

						const safeCleanData = safeClone({
							...cleanData,
							areaOfTown: getValidAreaOfTown(cleanData.areaOfTown)
						});

						await pb.collection('clients').update(realId, safeCleanData);
						console.log(`✅ Client updated in PocketBase: ${realId}`);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							console.error(
								'❌ Client update failed:',
								JSON.stringify(err.response?.data, null, 2)
							);
							throw err;
						}
					}
				} else if (item.type === 'delete') {
					if (!item.recordId) {
						await db.syncQueue.delete(item.id!);
						continue;
					}

					const realId = await resolveClientPbId(item.recordId);

					try {
						await pb.collection('clients').delete(realId);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				}
			}

			// )=- users handling inserted here (inside the per-item try, before the shared delete).
			// This ensures every queued users item gets processed like jobs/clients.
			if (item.collection === 'users') {
				if (item.type === 'create') {
					const { id, password: providedPassword, ...userData } = item.data;

					// )=- Use the real password provided at creation (from admin modal) instead of random.
					// firstName/lastName now sent to PB (assume collection has these fields or map to 'name' if needed).
					// PB still requires password + passwordConfirm for auth record creation.
					const password = providedPassword || crypto.randomUUID().slice(0, 16) + 'Aa1!';
					const email =
						(userData.email || '').trim().toLowerCase() ||
						`${(userData.firstName || userData.name || 'user').toLowerCase().replace(/\s+/g, '')}@crew.local`;

					const safeUserData = safeClone({
						...userData,
						email,
						password,
						passwordConfirm: password
						// If your PB users collection doesn't have firstName/lastName yet, you can map:
						// name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
					});

					// )=- Also convert photo for create path (defensive).
					if (typeof safeUserData.photo === 'string' && safeUserData.photo.startsWith('data:')) {
						safeUserData.photo = dataUrlToBlob(safeUserData.photo);
					}

					// Never include verified / emailConfirm / similar system auth fields in the *create* payload.
					// PocketBase auth collections frequently reject them at create time (400 on "verified") depending on
					// collection options, email confirmation settings, and whether the caller is a full superuser vs role-based admin.
					// We create cleanly, then attempt a follow-up update (as the logged-in admin) to set verified:true on the server record.
					// The local Dexie copy (created in createUser) keeps verified:false as the explicit marker for the
					// first-login WelcomeModal (set real password) + ForcePhotoUpdate gate. Merge logic in pb.ts protects the marker.
					delete (safeUserData as any).verified;
					delete (safeUserData as any).emailConfirm;
					delete (safeUserData as any).emailVisibility;

					try {
						const record = await pb.collection('users').create(safeUserData);

						// Note: We no longer attempt direct verified update here (often 400s due to collection rules on non-superuser tokens).
						// Instead, NewUserModal (after awaiting createUser which processes the queue) calls the elevated
						// /api/auth/mark-verified route using the internal secret to set verified on PB reliably.
						// The local Dexie marker (verified:false) is what drives the first-login Welcome gate.

						const existing = await db.users.get(item.recordId);
						if (existing) {
							await db.users.put({ ...existing, pbId: record.id });
						} else {
							await db.users.update(item.recordId, { pbId: record.id });
						}

						console.log(`✅ User synced to PocketBase: ${record.id}`);

						const pendingDeletes = await db.syncQueue
							.where('recordId')
							.equals(item.recordId)
							.and((q) => q.type === 'delete' && q.collection === 'users')
							.toArray();

						for (const q of pendingDeletes) {
							await db.syncQueue.update(q.id!, { recordId: record.id });
						}
					} catch (err: any) {
						console.error('❌ User sync failed with 400:', err.response?.data);
						// Clean up the bad/stale queue item (e.g. old pending NewUser create that included fields PB rules reject).
						// Prevents the item from retrying (and spamming errors) on every subsequent login / processSyncQueue.
						await db.syncQueue.delete(item.id!);
						throw { __intentionallyDropped: true, reason: 'User create 400 (likely schema/rule on verified or similar); queue item removed' };
					}
				} else if (item.type === 'update') {
					try {
						const currentUser = await db.users.get(item.recordId);
						const realId = currentUser?.pbId || currentUser?.id || item.recordId;

						const { id, pbId, createdAt: _createdAt, updatedAt: _updatedAt, ...cleanData } = item.data;

						const pbPayload = safeClone(cleanData);

						// )=- Convert any data URL photo to Blob so PB accepts it as a valid file upload.
						// This fixes the 400 "validation_invalid_file" when crew uploads photo from /profile.
						if (typeof pbPayload.photo === 'string' && pbPayload.photo.startsWith('data:')) {
							pbPayload.photo = dataUrlToBlob(pbPayload.photo);
						}

						// )=- Never send 'email' in a generic users update payload.
						// Direct { email: 'new@...' } on an auth collection while authenticated as that user
						// triggers "validation_values_mismatch" (because email change confirmation is enabled by default).
						// Email changes are handled via pb.collection('users').requestEmailChange() in the profile UI
						// (the secure flow that sends a confirmation to the new address).
						// We still update the email locally in Dexie for immediate app use.
						if ('email' in pbPayload) {
							delete (pbPayload as any).email;
						}

						// Avoid sending an empty (or only-meta) payload which can happen for email-only changes.
						const keys = Object.keys(pbPayload);
						if (keys.length === 0 || keys.every((k) => k === 'updatedAt')) {
							console.log(
								`ℹ️ Skipping empty PB user update for ${realId} (email change handled via requestEmailChange)`
							);
						} else {
							await pb.collection('users').update(realId, pbPayload);
							console.log(`✅ User updated in PocketBase: ${realId}`);
						}
					} catch (err: any) {
						if (err.status === 404) {
							// The pbId on this local record is stale/dead (common after dups, cleanups, or server deletes of test users).
							// Clean the bad pbId so future queues/pulls can recover the correct one. Delete the queue item
							// to stop repeated 404 spam on every login/sync.
							await db.syncQueue.delete(item.id!);
							const local = await db.users.get(item.recordId);
							if (local?.pbId) {
								await db.users.update(item.recordId, { pbId: undefined as any, updatedAt: new Date() });
								console.warn(`🧹 Cleared stale pbId from local user ${item.recordId} after 404 on PB update`);
							}
						} else {
							console.error('❌ User update failed:', JSON.stringify(err.response?.data, null, 2));
							throw err;
						}
					}
				} else if (item.type === 'delete') {
					if (!item.recordId) {
						await db.syncQueue.delete(item.id!);
						continue;
					}

					const realId = item.recordId;

					try {
						await pb.collection('users').delete(realId);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				}
			}

			// )=- Phase 2: Real invoice sync including PB file handling for primaryInvoiceFile + supportingDocuments.
			// Uses FormData when files (_files) are present in queue data so PB correctly receives the Blobs as file fields.
			// For plain metadata (no files) we fall back to regular object create/update (cheaper).
			// Blobs in _files are converted to File (with proper name) before sending.
			// After successful push we store the pbId back to the local Dexie record (like jobs/clients).
			// Note: We never store the actual file blobs in the persistent invoices Dexie table — only in the transient queue item.
			// Pull of file metadata happens via future pullInvoices or on-demand via pb.files.getUrl in the UI.
			// Reference: JOBS_AND_INVOICES_SPEC.md + "don't keep any image files locally (except avatars)".
			if (item.collection === 'invoices') {
				if (item.type === 'create') {
					try {
						const data = item.data;
						const localAtProcess = await db.invoices.get(item.recordId);

						// )=- If by the time this create item is processed the local now has a pbId (e.g. the original
						// create from Generate ran, or a promoted update fallback created it), treat this as an update
						// instead so we don't create duplicate records on PB. Use the files from this item if present.
						if (localAtProcess?.pbId) {
							const realId = localAtProcess.pbId;
							const hasFiles = !!data._files;
							if (hasFiles) {
								const formData = new FormData();
								Object.keys(data).forEach((key) => {
									if (key === '_files') return;
									const val = data[key];
									if (val == null) return;
									if (val instanceof Date) formData.append(key, val.toISOString());
									else if (typeof val === 'object' && !Array.isArray(val))
										formData.append(key, JSON.stringify(val));
									else formData.append(key, String(val));
								});
								if (data._files?.primary) {
									const f = data._files.primary;
									formData.append(
										'primaryInvoiceFile',
										new File([f.blob], f.filename, {
											type:
												f.blob.type ||
												'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
										})
									);
								}
								if (data._files?.supporting?.length) {
									for (const s of data._files.supporting) {
										formData.append(
											'supportingDocuments',
											new File([s.blob], s.filename, {
												type: s.type || s.blob.type || 'application/octet-stream'
											})
										);
									}
								}
								await pb.collection('invoices').update(realId, formData);
								console.log(
									`✅ Invoice (with files) updated in PocketBase (create item promoted to update): ${realId}`
								);
							} else {
								await pb.collection('invoices').update(realId, data);
								console.log(
									`✅ Invoice updated in PocketBase (create item promoted to update): ${realId}`
								);
							}
						} else {
							const hasFiles = !!data._files;

							if (hasFiles) {
								// Use FormData for reliable multi-file + scalar upload
								const formData = new FormData();

								// Append scalar fields (PB will interpret relations by id)
								if (data.jobId) formData.append('job', data.jobId);
								if (data.clientId) formData.append('client', data.clientId);
								if (data.status) formData.append('status', data.status);
								if (data.dueDate)
									formData.append(
										'dueDate',
										data.dueDate instanceof Date ? data.dueDate.toISOString() : data.dueDate
									);
								if (data.paidAt)
									formData.append(
										'paidAt',
										data.paidAt instanceof Date ? data.paidAt.toISOString() : data.paidAt
									);
								if (data.amount != null) formData.append('amount', String(data.amount));
								if (data.billableItems)
									formData.append('billableItems', JSON.stringify(data.billableItems));
								if (data.notes) formData.append('notes', data.notes);
								if (data.importSource) formData.append('importSource', data.importSource);

								// Primary .docx (the editable one)
								if (data._files.primary) {
									const f = data._files.primary;
									const file = new File([f.blob], f.filename, {
										type:
											f.blob.type ||
											'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
									});
									formData.append('primaryInvoiceFile', file);
								}

								// Supporting scans / other docs (multiple)
								if (data._files.supporting?.length) {
									for (const s of data._files.supporting) {
										const file = new File([s.blob], s.filename, {
											type: s.type || s.blob.type || 'application/octet-stream'
										});
										formData.append('supportingDocuments', file);
									}
								}

								const record = await pb.collection('invoices').create(formData);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(`✅ Invoice (with files) pushed to PocketBase: ${record.id}`);
							} else {
								// No files — plain JSON create (faster)
								const pbPayload: any = {
									job: data.jobId,
									client: data.clientId,
									status: data.status || 'draft',
									dueDate: data.dueDate instanceof Date ? data.dueDate.toISOString() : data.dueDate,
									paidAt: data.paidAt
										? data.paidAt instanceof Date
											? data.paidAt.toISOString()
											: data.paidAt
										: null,
									amount: Number(data.amount) || 0,
									billableItems: data.billableItems || [],
									notes: data.notes || undefined,
									importSource: data.importSource || undefined
								};
								const record = await pb.collection('invoices').create(pbPayload);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(`✅ Invoice pushed to PocketBase: ${record.id}`);
							}
						}
					} catch (err: any) {
						console.error('❌ Invoice create sync failed:', err?.response?.data || err);
					}
				} else if (item.type === 'update') {
					try {
						const localInvoice = await db.invoices.get(item.recordId);
						const data = item.data;
						const hasFiles = !!data._files;

						if (!localInvoice) {
							// Local record disappeared between queuing and processing — drop the item.
							await db.syncQueue.delete(item.id!);
							throw {
								__intentionallyDropped: true,
								reason: 'local invoice record missing during sync'
							};
						}

						if (!localInvoice.pbId) {
							// )=- Fallback create for invoices that only exist locally (no pbId yet).
							// This happens when the original createInvoice (from Generate Draft) never successfully
							// landed on PocketBase (offline, previous error, strict collection rules, or the row was
							// deleted on server), but the user later does "Regenerate" (or other update with files).
							// Previously this would do .update(realId=localUUID) → 404 on PB (see the exact error
							// the user reported: 404 on /invoices/records/<uuid> then misleading "Synced update").
							// Now we promote the pending update to a create using the *current full state* from Dexie
							// (which has the latest snapshot + any local changes) + the files from *this* queue item
							// (the newly regenerated .docx). After success we stamp pbId exactly like the normal create path.
							// This makes "regenerate on a local-only invoice" work and is resilient for the sync queue.
							// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md
							if (hasFiles) {
								const formData = new FormData();

								// Full fields from the current local record (the authoritative state for initial create)
								if (localInvoice.jobId) formData.append('job', localInvoice.jobId);
								if (localInvoice.clientId) formData.append('client', localInvoice.clientId);
								if (localInvoice.status) formData.append('status', localInvoice.status);
								if (localInvoice.dueDate)
									formData.append(
										'dueDate',
										localInvoice.dueDate instanceof Date
											? localInvoice.dueDate.toISOString()
											: localInvoice.dueDate
									);
								if (localInvoice.paidAt)
									formData.append(
										'paidAt',
										localInvoice.paidAt instanceof Date
											? localInvoice.paidAt.toISOString()
											: localInvoice.paidAt
									);
								if (localInvoice.amount != null)
									formData.append('amount', String(localInvoice.amount));
								if (localInvoice.billableItems)
									formData.append('billableItems', JSON.stringify(localInvoice.billableItems));
								if (localInvoice.notes) formData.append('notes', localInvoice.notes);
								if (localInvoice.importSource)
									formData.append('importSource', localInvoice.importSource);

								// The delta files from this update (e.g. the regenerated primary docx)
								if (data._files.primary) {
									const f = data._files.primary;
									const file = new File([f.blob], f.filename, {
										type:
											f.blob.type ||
											'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
									});
									formData.append('primaryInvoiceFile', file);
								}
								if (data._files.supporting?.length) {
									for (const s of data._files.supporting) {
										const file = new File([s.blob], s.filename, {
											type: s.type || s.blob.type || 'application/octet-stream'
										});
										formData.append('supportingDocuments', file);
									}
								}

								const record = await pb.collection('invoices').create(formData);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(
									`✅ Invoice (with files) pushed to PocketBase (regenerate/create fallback): ${record.id}`
								);
							} else {
								const pbPayload: any = {
									job: localInvoice.jobId,
									client: localInvoice.clientId,
									status: localInvoice.status || 'draft',
									dueDate:
										localInvoice.dueDate instanceof Date
											? localInvoice.dueDate.toISOString()
											: localInvoice.dueDate,
									paidAt: localInvoice.paidAt
										? localInvoice.paidAt instanceof Date
											? localInvoice.paidAt.toISOString()
											: localInvoice.paidAt
										: null,
									amount: Number(localInvoice.amount) || 0,
									billableItems: localInvoice.billableItems || [],
									notes: localInvoice.notes || undefined,
									importSource: localInvoice.importSource || undefined
								};
								const record = await pb.collection('invoices').create(pbPayload);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(
									`✅ Invoice pushed to PocketBase (regenerate/create fallback): ${record.id}`
								);
							}
						} else {
							// Normal update path — we have a pbId so the record should exist on PB.
							const realId = localInvoice.pbId;
							let updateSucceeded = false;

							try {
								if (hasFiles) {
									const formData = new FormData();

									// Only append fields that are being updated
									Object.keys(data).forEach((key) => {
										if (key === '_files') return;
										const val = data[key];
										if (val == null) return;
										if (val instanceof Date) {
											formData.append(key, val.toISOString());
										} else if (typeof val === 'object' && !Array.isArray(val)) {
											formData.append(key, JSON.stringify(val));
										} else {
											formData.append(key, String(val));
										}
									});

									if (data._files.primary) {
										const f = data._files.primary;
										const file = new File([f.blob], f.filename, {
											type:
												f.blob.type ||
												'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
										});
										formData.append('primaryInvoiceFile', file);
									}
									if (data._files.supporting?.length) {
										for (const s of data._files.supporting) {
											const file = new File([s.blob], s.filename, {
												type: s.type || s.blob.type || 'application/octet-stream'
											});
											formData.append('supportingDocuments', file);
										}
									}

									await pb.collection('invoices').update(realId, formData);
									console.log(`✅ Invoice (with files) updated in PocketBase: ${realId}`);
								} else {
									await pb.collection('invoices').update(realId, data);
									console.log(`✅ Invoice updated in PocketBase: ${realId}`);
								}
								updateSucceeded = true;
							} catch (updateErr: any) {
								const is404 =
									updateErr?.status === 404 ||
									updateErr?.response?.status === 404 ||
									updateErr?.statusCode === 404;
								if (is404) {
									// )=- The PB record for this pbId no longer exists on the server (was deleted in Admin UI,
									// or create never fully committed, or collection was reset), but we have a stale pbId locally
									// and this update (e.g. Regenerate) carries the latest file.
									// Fall back to create using the current full localInvoice data + the files from this queue item.
									// This prevents the 404 the user saw when regenerating a locally-existing invoice that has
									// no row (anymore) on PocketBase.
									// After create we will overwrite the (stale) pbId.
									// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
									console.warn(
										`Invoice ${realId} 404 on update — falling back to create from current local state + delta files`
									);
									// proceed to fallback create below by setting flag
								} else {
									throw updateErr;
								}
							}

							if (!updateSucceeded) {
								// Fallback create path (triggered either by no pbId above, or by 404 on update here)
								if (hasFiles) {
									const formData = new FormData();

									if (localInvoice.jobId) formData.append('job', localInvoice.jobId);
									if (localInvoice.clientId) formData.append('client', localInvoice.clientId);
									if (localInvoice.status) formData.append('status', localInvoice.status);
									if (localInvoice.dueDate)
										formData.append(
											'dueDate',
											localInvoice.dueDate instanceof Date
												? localInvoice.dueDate.toISOString()
												: localInvoice.dueDate
										);
									if (localInvoice.paidAt)
										formData.append(
											'paidAt',
											localInvoice.paidAt instanceof Date
												? localInvoice.paidAt.toISOString()
												: localInvoice.paidAt
										);
									if (localInvoice.amount != null)
										formData.append('amount', String(localInvoice.amount));
									if (localInvoice.billableItems)
										formData.append('billableItems', JSON.stringify(localInvoice.billableItems));
									if (localInvoice.notes) formData.append('notes', localInvoice.notes);
									if (localInvoice.importSource)
										formData.append('importSource', localInvoice.importSource);

									if (data._files.primary) {
										const f = data._files.primary;
										const file = new File([f.blob], f.filename, {
											type:
												f.blob.type ||
												'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
										});
										formData.append('primaryInvoiceFile', file);
									}
									if (data._files.supporting?.length) {
										for (const s of data._files.supporting) {
											const file = new File([s.blob], s.filename, {
												type: s.type || s.blob.type || 'application/octet-stream'
											});
											formData.append('supportingDocuments', file);
										}
									}

									const record = await pb.collection('invoices').create(formData);
									await db.invoices.update(item.recordId, { pbId: record.id });
									console.log(
										`✅ Invoice (with files) pushed to PocketBase (regenerate/create fallback after 404): ${record.id}`
									);
								} else {
									const pbPayload: any = {
										job: localInvoice.jobId,
										client: localInvoice.clientId,
										status: localInvoice.status || 'draft',
										dueDate:
											localInvoice.dueDate instanceof Date
												? localInvoice.dueDate.toISOString()
												: localInvoice.dueDate,
										paidAt: localInvoice.paidAt
											? localInvoice.paidAt instanceof Date
												? localInvoice.paidAt.toISOString()
												: localInvoice.paidAt
											: null,
										amount: Number(localInvoice.amount) || 0,
										billableItems: localInvoice.billableItems || [],
										notes: localInvoice.notes || undefined,
										importSource: localInvoice.importSource || undefined
									};
									const record = await pb.collection('invoices').create(pbPayload);
									await db.invoices.update(item.recordId, { pbId: record.id });
									console.log(
										`✅ Invoice pushed to PocketBase (regenerate/create fallback after 404): ${record.id}`
									);
								}
							}
						}
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
							// Prevent the unconditional "✅ Synced update" log below and the outer "Failed to sync" log.
							// This 404 means the PB record didn't exist (either never created or was deleted on server).
							// For the !pbId case we already did the fallback create above; for has-pbId case we abandon this queue item.
							throw { __intentionallyDropped: true, reason: '404 on invoice update (no PB row)' };
						} else {
							console.error('❌ Invoice update sync failed:', err?.response?.data || err);
						}
					}
				} else if (item.type === 'delete') {
					try {
						const invoice = await db.invoices.get(item.recordId);
						const realId = invoice?.pbId || invoice?.id || item.recordId;
						await pb.collection('invoices').delete(realId);
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				}
			}

			await db.syncQueue.delete(item.id!);
			console.log(`✅ Synced ${item.type} ${item.collection} ${item.recordId}`);
		} catch (err) {
			if (err && (err as any).__intentionallyDropped) {
				// Expected drop, e.g. 404 on invoice update for a local-only record (the regenerate/create fallback handled it)
				// or other cases where we deliberately removed the queue item without considering it a failure.
			} else {
				console.error(`Failed to sync queue item ${item.id}`, err);
			}
		}
	}
}

export async function cleanupDuplicateUsers() {
	// )=- General dedup for users by email to handle cases where loginWithEmail created a shadow record (PB id as key) alongside a local UUID record from admin creation.
	// Prefers keeping a record with firstName/lastName (from creation), ensures pbId is on kept, deletes others.
	// Called from user list loads and login to keep Dexie clean. UI also has per-list dedup.
	const allUsers = await db.users.toArray();
	const byEmail: { [k: string]: any[] } = {};
	for (const u of allUsers) {
		if (u.email) {
			(byEmail[u.email] ||= []).push(u);
		}
	}
	for (const email in byEmail) {
		const group = byEmail[email];
		if (group.length > 1) {
			const keep = group.find((g) => g.firstName && g.lastName) || group[0];
			console.log(
				`🧹 cleanupDuplicateUsers: keeping ${keep.id} for ${email}, removing ${group.length - 1} dup(s)`
			);
			for (const g of group) {
				if (g.id !== keep.id) {
					await db.users.delete(g.id!);
				}
			}
			const pbIdCandidate = group.find((g) => g.pbId)?.pbId;
			if (pbIdCandidate && !keep.pbId) {
				await db.users.update(keep.id!, { pbId: pbIdCandidate });
			}
		}
	}
}

export { db };
// )=- No need for extra "export type" re-export. The `export interface Invoice` declaration (above) already makes
// `import { Invoice } from '$lib/db'` work. The previous export type line was causing duplicate export conflicts
// in svelte-check even for a single name.
// Reference: JOBS_AND_INVOICES_SPEC.md (Phase 1)

// )=- Helper to turn a user.photo (which may be data: URL, full http, or bare PB filename like "blob_xxx.png")
// into a usable <img src> value.
// When bare filename, use pb.files.getURL (note capital URL per current SDK) to build the API URL.
// This is the central fix for crew/user avatar 404s showing as relative /blob_... paths in layout, jobs cards,
// calendar event cards, and job details modal.
// Call this in templates or when building photo maps.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
export function getUserPhotoSrc(photo: string | undefined, user: any): string | undefined {
	if (!photo) return undefined;
	if (photo.startsWith('data:') || photo.startsWith('http')) return photo;
	const uid = user?.pbId || user?.id;
	if (!uid) return photo;
	try {
		return pb.files.getURL({ id: uid, collectionName: 'users' }, photo);
	} catch {
		return photo;
	}
}
