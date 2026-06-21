// src/lib/db/index.ts

import Dexie, { type EntityTable } from 'dexie';
import { pb, pullJobsFromServer } from '$lib/db/pb';
// )=- Import pure date helper extracted in Phase 2 so due date logic is testable and not duplicated.
// Reference: TESTING_PLAN.md + JOBS_AND_INVOICES_SPEC.md
import { getInvoiceDueDateForJob } from '$lib/utils/dates';
import {
	normalizeTaxRateToPercent,
	taxRatePercentToPbDecimal
} from '$lib/utils/tax';
import type {
	InvoiceBillableItem,
	InvoiceClientSnapshot,
	InvoiceDiscount
} from '$lib/utils/invoiceTypes';
import {
	buildClientSnapshotFromClient,
	buildSnapshotDefaults,
	billableItemsFromJob,
	formatInvoiceNumber
} from '$lib/utils/invoiceSnapshot';
import { calculateInvoiceTotals, normalizeBillableItems } from '$lib/utils/invoiceTotals';
export type {
	InvoiceBillableItem,
	InvoiceClientSnapshot,
	InvoiceDiscount
} from '$lib/utils/invoiceTypes';
export {
	formatInvoiceNumber,
	buildSnapshotDefaults,
	clientFromSnapshot,
	isDocxStale
} from '$lib/utils/invoiceSnapshot';
export { calculateInvoiceTotals, normalizeBillableItems } from '$lib/utils/invoiceTotals';
export { validateInvoiceSnapshot } from '$lib/utils/invoiceSchema';
export { normalizeTaxRateToPercent } from '$lib/utils/tax';
export {
	generateInvoiceDocx,
	generateInvoiceDocxFromSnapshot,
	businessInfoFromOptions,
	buildPaymentInstructions,
	type InvoiceDocxContext,
	type InvoiceDocxBusinessInfo
} from '$lib/utils/invoiceDocx';
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
	/** When true, invoices use billingAddress* instead of service address for Bill To. */
	useBillingAddress?: boolean;
	billingAddressStreet?: string;
	billingAddressCity?: string;
	billingAddressState?: string;
	billingAddressZip?: string;
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

/** Durable session marker (IndexedDB) — survives iOS PWA localStorage eviction better than localStorage alone. */
export interface AppSession {
	id: 'current';
	currentUserId: string;
}

/** Local quick-unlock settings (PIN / device biometric gate on reopen). */
export interface DeviceAuthSettings {
	id: 'current';
	enabled: boolean;
	pinEnabled: boolean;
	biometricEnabled: boolean;
	pinHash?: string;
	biometricCredentialId?: string;
	userId?: string;
	email?: string;
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
	/** Days before job start to email assigned crew (at crewAssignmentHour). */
	crewAssignmentDaysBefore?: number;
	/** Hour of day (0–23, local) to send crew assignment emails. */
	crewAssignmentHour?: number;
	/** Calendar day view starts at this hour (0–23, local). */
	calendarDayStartHour?: number;
	/** Calendar day view ends at this hour (1–24, local; e.g. 22 = 10 PM). */
	calendarDayEndHour?: number;
	/** Letterhead + invoice numbering (Admin → Options → Invoice). */
	businessName?: string;
	businessStreet?: string;
	businessCity?: string;
	businessState?: string;
	businessZip?: string;
	businessPhone?: string;
	businessEmail?: string;
	businessWebsite?: string;
	businessMailingStreet?: string;
	businessMailingCity?: string;
	businessMailingState?: string;
	businessMailingZip?: string;
	businessSalesTaxAccount?: string;
	salesTaxJurisdiction?: string;
	invoiceNumberPrefix?: string;
	nextInvoiceNumber?: number;
	invoiceNumberYear?: number;
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
	/** Human-readable sequential number, e.g. CCW-2026-0001 */
	invoiceNumber?: string;
	dueDate: Date;
	paidAt?: Date;
	amount: number;
	subtotal?: number;
	taxAmount?: number;
	billableItems?: InvoiceBillableItem[];
	/** Editable client block for docx (snapshot; does not mutate Client unless write-back). */
	clientSnapshot?: InvoiceClientSnapshot;
	invoiceDiscount?: InvoiceDiscount;
	/** User-editable date printed on docx; sticky across regenerate. */
	invoiceDate?: Date;
	/** Increments on each generate/regenerate for invoice number suffix. */
	version?: number;
	/** Set when primary .docx last generated/uploaded (stale-docx detection). */
	lastGeneratedAt?: Date;
	/** Invoice-specific notes for the .docx (not job or client notes). */
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
	crewNotifications: EntityTable<
		import('$lib/notifications/crewSchedule').CrewNotificationPending,
		'id'
	>;
	appSession: EntityTable<AppSession, 'id'>;
	deviceAuth: EntityTable<DeviceAuthSettings, 'id'>;
};

// )=- Bumped to version 21 (was 20) to force schema upgrade on all clients for the *assignedCrew
// multiEntry index. Some production browsers had a local Dexie DB created under an older version
// declaration and were hitting "KeyPath assignedCrew on object store jobs is not indexed" (SchemaError)
// on .where('assignedCrew') calls (CrewManagement openEdit/delete + UserJobsModal).
// Declaring a higher version guarantees Dexie will run the upgrade transaction and add the index
// the next time the new bundle loads.
// The defensive getJobsForCrewMember helper below makes the app resilient even if a client's DB
// somehow misses the index after upgrade.
// Reference: previous live logs + Remedine/Svelte_FullCalendar_Dexie_Scheduling.
db.version(21).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown, importSource, pbId, *assignedCrew',
	users:
		'id, firstName, lastName, name, email, role, active, forcePhotoUpdate, forcePinUpdate, pbId, verified',
	syncQueue: '++id, type, collection, recordId, createdAt',
	options: 'id',
	invoices: 'id, jobId, clientId, status, dueDate, importSource, pbId'
});

db.version(22).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown, importSource, pbId, *assignedCrew',
	users:
		'id, firstName, lastName, name, email, role, active, forcePhotoUpdate, forcePinUpdate, pbId, verified',
	syncQueue: '++id, type, collection, recordId, createdAt',
	options: 'id',
	invoices: 'id, jobId, clientId, status, dueDate, importSource, pbId',
	crewNotifications: 'id, jobId, scheduledFor, crewName'
});

// v23: invoice editor snapshot fields (clientSnapshot, discounts, invoiceDate, version, etc.)
db.version(23).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown, importSource, pbId, *assignedCrew',
	users:
		'id, firstName, lastName, name, email, role, active, forcePhotoUpdate, forcePinUpdate, pbId, verified',
	syncQueue: '++id, type, collection, recordId, createdAt',
	options: 'id',
	invoices: 'id, jobId, clientId, status, dueDate, importSource, pbId',
	crewNotifications: 'id, jobId, scheduledFor, crewName'
});

// v24: durable session marker for PWA restore when localStorage is evicted
db.version(24).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown, importSource, pbId, *assignedCrew',
	users:
		'id, firstName, lastName, name, email, role, active, forcePhotoUpdate, forcePinUpdate, pbId, verified',
	syncQueue: '++id, type, collection, recordId, createdAt',
	options: 'id',
	invoices: 'id, jobId, clientId, status, dueDate, importSource, pbId',
	crewNotifications: 'id, jobId, scheduledFor, crewName',
	appSession: 'id'
});

// v25: device quick-unlock (local PIN / biometric gate)
db.version(25).stores({
	clients: 'id, name, areaOfTown, email, pbId',
	jobs: 'id, clientId, start, end, status, areaOfTown, importSource, pbId, *assignedCrew',
	users:
		'id, firstName, lastName, name, email, role, active, forcePhotoUpdate, forcePinUpdate, pbId, verified',
	syncQueue: '++id, type, collection, recordId, createdAt',
	options: 'id',
	invoices: 'id, jobId, clientId, status, dueDate, importSource, pbId',
	crewNotifications: 'id, jobId, scheduledFor, crewName',
	appSession: 'id',
	deviceAuth: 'id'
});

export async function persistSessionUserId(userId: string | null): Promise<void> {
	if (userId) {
		await db.appSession.put({ id: 'current', currentUserId: userId });
	} else {
		await db.appSession.delete('current').catch(() => {});
	}
}

export async function readPersistedSessionUserId(): Promise<string | null> {
	const row = await db.appSession.get('current');
	return row?.currentUserId?.trim() || null;
}

/**
 * Safe query for jobs assigned to a specific crew member (by the string name stored in assignedCrew arrays).
 * Uses the multiEntry index when available (fast). Falls back to a full scan + filter if the index
 * is missing (SchemaError) — this can happen transiently for users whose local DB was created before
 * the v20/v21 declaration reached them, or if an upgrade transaction was interrupted.
 * Always dedupes the result.
 */
export async function getJobsForCrewMember(crewName: string): Promise<Job[]> {
	try {
		const raw = await db.jobs.where('assignedCrew').equals(crewName).toArray();
		return dedupJobs(raw);
	} catch (err: any) {
		const msg = String(err?.message || '');
		if (err?.name === 'SchemaError' || /not indexed/i.test(msg) || /assignedCrew/i.test(msg)) {
			console.warn('[db] assignedCrew index missing or query failed — falling back to full scan for', crewName);
			const all = await db.jobs.toArray();
			const filtered = all.filter((j: any) => (j.assignedCrew || []).includes(crewName));
			return dedupJobs(filtered);
		}
		throw err;
	}
}

/** Display-name variants that may appear in job.assignedCrew for a user. */
export function getUserCrewNameAliases(
	user: Pick<User, 'name' | 'firstName' | 'lastName'>
): string[] {
	const names = new Set<string>();
	const full = (user.name || `${user.firstName || ''} ${user.lastName || ''}`).trim();
	if (full) names.add(full);
	if (user.firstName && user.lastName) {
		names.add(`${user.firstName} ${user.lastName}`.trim());
	}
	return [...names].filter(Boolean);
}

async function patchJobAssignedCrewList(
	job: Job,
	patch: (crew: string[]) => string[],
	opts?: { skipCrewNotify?: boolean }
): Promise<boolean> {
	const current = job.assignedCrew || [];
	const next = [...new Set(patch([...current]).map((s) => s.trim()).filter(Boolean))];
	const unchanged =
		next.length === current.length && next.every((n, i) => n === current[i]);
	if (unchanged) return false;
	await updateJob(job.id!, { assignedCrew: next }, { skipCrewNotify: opts?.skipCrewNotify });
	return true;
}

/** Replace old crew display names on all jobs (e.g. after admin renames a user). */
export async function renameCrewNamesOnJobs(fromNames: string[], toName: string): Promise<number> {
	const fromSet = new Set(fromNames.map((n) => n.trim()).filter(Boolean));
	const to = toName.trim();
	if (!fromSet.size || !to) return 0;

	const jobs = dedupJobs(await db.jobs.toArray());
	let count = 0;
	for (const job of jobs) {
		const changed = await patchJobAssignedCrewList(
			job,
			(crew) => crew.map((c) => (fromSet.has(c) ? to : c)),
			{ skipCrewNotify: true }
		);
		if (changed) count++;
	}
	if (count > 0) {
		console.log(`✅ Renamed crew on ${count} job(s): ${[...fromSet].join(', ')} → ${to}`);
	}
	return count;
}

/** Remove crew display names from all jobs (e.g. before deleting a user). */
export async function removeCrewNamesFromJobs(names: string[]): Promise<number> {
	const nameSet = new Set(names.map((n) => n.trim()).filter(Boolean));
	if (!nameSet.size) return 0;

	const jobs = dedupJobs(await db.jobs.toArray());
	let count = 0;
	for (const job of jobs) {
		const changed = await patchJobAssignedCrewList(
			job,
			(crew) => crew.filter((c) => !nameSet.has(c)),
			{ skipCrewNotify: true }
		);
		if (changed) count++;
	}
	if (count > 0) {
		console.log(`✅ Removed crew from ${count} job(s): ${[...nameSet].join(', ')}`);
	}
	return count;
}

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
	const taxRate = normalizeTaxRateToPercent(optionsRecord?.taxRate);

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

	if (newJob.assignedCrew?.length) {
		import('$lib/notifications/crewAssignment')
			.then((m) => m.refreshCrewNotificationQueueForJob(String(id)))
			.catch(() => {});
	}

	return String(id);
}

export async function updateJob(
	jobId: string,
	updates: Partial<Job>,
	opts?: { skipCrewNotify?: boolean }
) {
	const existing = await db.jobs.get(jobId);
	const resolvedUpdates = { ...updates };

	if (resolvedUpdates.clientId) {
		resolvedUpdates.clientId = await resolveClientPbId(resolvedUpdates.clientId);
	}

	const safeUpdates = safeClone({ ...resolvedUpdates, updatedAt: new Date() });
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

	if (
		!opts?.skipCrewNotify &&
		existing &&
		(updates.assignedCrew !== undefined || updates.start !== undefined)
	) {
		import('$lib/notifications/crewAssignment')
			.then((m) => m.refreshCrewNotificationQueueForJob(jobId))
			.catch(() => {});
	}
}

export async function cancelJob(jobId: string, cancelReason: string, notes?: string) {
	const currentUser = auth?.currentUser;

	let cancelledByPb: string | null = null;
	if (currentUser?.id) {
		cancelledByPb = (await resolveUserPbId(currentUser.id)) || currentUser.pbId || null;
	}

	// )=- Batch B: cancelNotes is separate from job notes (was incorrectly overwriting notes).
	const updates = safeClone({
		status: 'cancelled' as const,
		cancelReason,
		cancelledAt: new Date(),
		cancelledBy: cancelledByPb,
		cancelNotes: notes || undefined,
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
	import('$lib/notifications/crewAssignment')
		.then((m) => m.refreshCrewNotificationQueueForJob(jobId))
		.catch(() => {});
	console.log(`✅ Job ${jobId} cancelled by ${currentUser?.name || 'Unknown'}`);
}

/** Reschedule a cancelled job: new future dates, status back to scheduled, cancel metadata cleared. */
export async function rescheduleCancelledJob(jobId: string, jobData: Partial<Job>) {
	const existing = await db.jobs.get(jobId);
	if (!existing) {
		throw new Error(`rescheduleCancelledJob: job not found ${jobId}`);
	}

	const resolved = { ...jobData };
	if (resolved.clientId) {
		resolved.clientId = await resolveClientPbId(resolved.clientId);
	}

	const billableItems = (resolved.billableItems ?? existing.billableItems ?? []).map((item: any) =>
		safeClone({ ...item })
	);

	// safeClone strips Svelte proxies before IndexedDB put (same pattern as createJob / updateJob).
	const nextJob = safeClone({
		...existing,
		...resolved,
		assignedCrew: [...(resolved.assignedCrew ?? existing.assignedCrew ?? [])],
		billableItems,
		start: new Date(resolved.start ?? existing.start),
		end: new Date(resolved.end ?? existing.end),
		status: 'scheduled' as const,
		updatedAt: new Date()
	});
	delete (nextJob as Record<string, unknown>).cancelReason;
	delete (nextJob as Record<string, unknown>).cancelNotes;
	delete (nextJob as Record<string, unknown>).cancelledAt;
	delete (nextJob as Record<string, unknown>).cancelledBy;

	await db.jobs.put(nextJob);

	const queueData = safeClone({
		...resolved,
		status: 'scheduled',
		cancelReason: '',
		cancelNotes: '',
		cancelledAt: null,
		cancelledBy: null,
		updatedAt: new Date()
	});

	await addToSyncQueue({
		type: 'update',
		collection: 'jobs',
		recordId: jobId,
		data: queueData
	});

	if (navigator.onLine) await processSyncQueue();

	if (resolved.start !== undefined || resolved.assignedCrew !== undefined) {
		import('$lib/notifications/crewAssignment')
			.then((m) => m.refreshCrewNotificationQueueForJob(jobId))
			.catch(() => {});
	}
}

export async function updateJobDates(jobId: string, newStart: Date | null, newEnd: Date | null) {
	if (!newStart) {
		throw new Error('updateJobDates: newStart is null');
	}

	const job = await db.jobs.get(jobId);
	if (!job) {
		throw new Error(`updateJobDates: job not found ${jobId}`);
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
			const existingIsCanonical = existing.id === existing.pbId;
			const candidateIsCanonical = j.id === j.pbId;
			const existingUpdated = new Date(existing.updatedAt || 0).getTime();
			const candidateUpdated = new Date(j.updatedAt || 0).getTime();

			if (candidateIsCanonical && !existingIsCanonical) {
				byKey.set(key, j);
			} else if (!candidateIsCanonical && existingIsCanonical) {
				// keep existing canonical row
			} else if (candidateUpdated > existingUpdated) {
				byKey.set(key, j);
			}
		}
	}
	return Array.from(byKey.values());
}

/**
 * Delete duplicate Dexie job rows that share the same pbId (local-uuid + canonical pbId rows).
 * Returns the number of rows removed.
 */
export async function cleanupDuplicateJobs(): Promise<number> {
	const all = await db.jobs.toArray();
	const groups = new Map<string, Job[]>();

	for (const job of all) {
		if (!job.pbId) continue;
		const group = groups.get(job.pbId) || [];
		group.push(job);
		groups.set(job.pbId, group);
	}

	let removed = 0;
	for (const [, group] of groups) {
		if (group.length <= 1) continue;
		const keep = dedupJobs(group)[0];
		for (const job of group) {
			if (job.id !== keep.id) {
				await db.jobs.delete(job.id!);
				removed++;
				console.log(`🗑️ Removed duplicate job row ${job.id} (canonical pbId ${job.pbId})`);
			}
		}
	}

	return removed;
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
	},
	fileDeletes?: {
		primary?: boolean;
		supporting?: string[];
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

	if (fileDeletes?.primary) {
		safeUpdates.primaryInvoiceFile = undefined;
	}
	if (fileDeletes?.supporting?.length) {
		const current = await db.invoices.get(invoiceId);
		const removeSet = new Set(fileDeletes.supporting);
		safeUpdates.supportingDocuments = (current?.supportingDocuments || []).filter(
			(d) => !removeSet.has(d.filename)
		);
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
		...(files && { _files: files }),
		...(fileDeletes && { _fileDeletes: fileDeletes })
	};

	if (!hasPbId && current) {
		// Enrich so create processor gets jobId, clientId, amount, billableItems, status, dueDate etc. + the _files delta.
		queueData = {
			...current,
			...safeUpdates,
			...(files && { _files: files }),
			...(fileDeletes && { _fileDeletes: fileDeletes })
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

/** Delete an invoice locally and queue PocketBase delete (pbId preferred). */
export async function deleteInvoice(invoiceId: string): Promise<void> {
	const inv = await db.invoices.get(invoiceId);
	if (!inv) return;

	const idToDelete = inv.pbId || invoiceId;

	const pending = await db.syncQueue
		.where('recordId')
		.equals(invoiceId)
		.and((q) => q.collection === 'invoices')
		.toArray();
	for (const q of pending) {
		await db.syncQueue.delete(q.id!);
	}

	await db.invoices.delete(invoiceId);

	await addToSyncQueue({
		type: 'delete',
		collection: 'invoices',
		recordId: idToDelete
	});

	if (navigator.onLine) await processSyncQueue();
	console.log(`✅ Invoice ${invoiceId} deleted locally (optimistic)`);
}

/** Remove one or more supporting documents from an invoice (metadata + PB files). */
export async function removeInvoiceSupportingDocuments(
	invoiceId: string,
	filenames: string[]
): Promise<void> {
	if (!filenames.length) return;
	await updateInvoice(invoiceId, { updatedAt: new Date() }, undefined, {
		supporting: filenames
	});
}

/** Remove only the generated/uploaded primary .docx; keeps invoice shell, supporting docs, notes, etc. */
export async function removePrimaryInvoiceFile(invoiceId: string): Promise<void> {
	const inv = await db.invoices.get(invoiceId);
	if (!inv?.primaryInvoiceFile?.filename) return;
	await updateInvoice(invoiceId, { updatedAt: new Date() }, undefined, { primary: true });
}

/** Allocate the next sequential invoice number and persist the counter in options. */
export async function allocateInvoiceNumber(): Promise<string> {
	const opts = (await db.options.get('1')) || { id: '1' };
	const prefix = (opts.invoiceNumberPrefix || 'CCW').trim() || 'CCW';
	const year = new Date().getFullYear();
	const storedYear = opts.invoiceNumberYear ?? year;
	let seq = opts.nextInvoiceNumber ?? 1;
	if (storedYear !== year) seq = 1;

	const number = `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
	const updated = {
		...opts,
		id: '1',
		nextInvoiceNumber: seq + 1,
		invoiceNumberYear: year,
		lastUpdated: new Date()
	};
	await db.options.put(updated);

	if (navigator.onLine) {
		import('$lib/stores/options.svelte')
			.then(({ optionsStore }) => {
				optionsStore.data = updated;
				return optionsStore.syncToPB(updated);
			})
			.catch(() => {});
	}

	return number;
}

/** Attach supporting documents to a job, creating a draft invoice shell when none exists yet. */
export async function addSupportingDocumentsToJob(
	job: Job,
	files: Array<{ blob: Blob; filename: string; type?: string }>
): Promise<string> {
	if (!files.length) throw new Error('No files provided');
	if (!job.id) throw new Error('Job has no id');

	return ensureInvoiceForJob(job, 'draft', { supporting: files });
}

// )=- PocketBase file removal via FormData (`field-` prefix for multi-file fields).
function appendInvoiceFileDeletesToFormData(
	formData: FormData,
	fileDeletes?: { primary?: boolean; supporting?: string[] }
) {
	if (!fileDeletes) return;
	if (fileDeletes.primary) {
		formData.append('primaryInvoiceFile', '');
	}
	for (const fn of fileDeletes.supporting || []) {
		formData.append('supportingDocuments-', fn);
	}
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

async function resolveClientForJob(job: Job): Promise<Client | undefined> {
	if (!job.clientId) return undefined;
	let client = await db.clients.get(job.clientId);
	if (!client) client = await db.clients.where('pbId').equals(job.clientId).first();
	return client;
}

function applyTotalsToInvoiceDraft(
	draft: Partial<Invoice>,
	taxRatePercent: number
): Partial<Invoice> {
	const items = normalizeBillableItems(draft.billableItems || []);
	const totals = calculateInvoiceTotals({
		billableItems: items,
		invoiceDiscount: draft.invoiceDiscount,
		taxRatePercent
	});
	return {
		...draft,
		billableItems: items,
		subtotal: totals.subtotal,
		taxAmount: totals.taxAmount,
		amount: totals.total
	};
}

/** Backfill snapshot fields on legacy invoices or partial records. */
export function hydrateInvoiceFromJobClient(
	invoice: Invoice,
	job: Job,
	client: Client | null | undefined,
	invoiceDueDays = 30
): Invoice {
	const defaults = buildSnapshotDefaults(job, client, invoiceDueDays);
	return {
		...invoice,
		clientSnapshot: invoice.clientSnapshot?.name
			? invoice.clientSnapshot
			: defaults.clientSnapshot,
		billableItems:
			invoice.billableItems?.length ? invoice.billableItems : defaults.billableItems,
		dueDate: invoice.dueDate || defaults.dueDate,
		invoiceDate: invoice.invoiceDate || defaults.invoiceDate,
		version: invoice.version ?? 0
	};
}

/**
 * Ensure a draft invoice shell exists for the job with an editable snapshot.
 * Auto-fills from job+client on first create; hydrates legacy rows on read.
 */
export async function ensureInvoiceShell(
	job: Job,
	initialFiles?: {
		primary?: { blob: Blob; filename: string };
		supporting?: Array<{ blob: Blob; filename: string; type?: string }>;
	}
): Promise<Invoice> {
	if (!job.id) throw new Error('Job has no id');

	const optionsRecord = await db.options.get('1');
	const dueDays = optionsRecord?.invoiceDueDays ?? 30;
	const taxPercent = normalizeTaxRateToPercent(optionsRecord?.taxRate);
	const client = await resolveClientForJob(job);

	let invoice = await getInvoiceForJob(job.id);
	if (invoice) {
		const hydrated = applyTotalsToInvoiceDraft(
			hydrateInvoiceFromJobClient(invoice, job, client, dueDays),
			taxPercent
		);
		if (JSON.stringify(hydrated) !== JSON.stringify(invoice)) {
			await db.invoices.update(invoice.id!, {
				...hydrated,
				updatedAt: new Date()
			} as Invoice);
			invoice = (await db.invoices.get(invoice.id!))!;
		}
		return invoice;
	}

	const defaults = buildSnapshotDefaults(job, client, dueDays);
	const draft = applyTotalsToInvoiceDraft(
		{
			jobId: job.id,
			clientId: job.clientId,
			status: 'draft',
			dueDate: defaults.dueDate,
			invoiceDate: defaults.invoiceDate,
			clientSnapshot: defaults.clientSnapshot,
			billableItems: defaults.billableItems,
			invoiceDiscount: { type: 'amount', value: 0 },
			version: 0,
			notes: '',
			importSource: job.importSource
		},
		taxPercent
	);

	const id = await createInvoice(draft, initialFiles);
	return (await db.invoices.get(id))!;
}

/** Persist editable snapshot fields and recompute totals. */
export async function saveInvoiceSnapshot(
	invoiceId: string,
	patch: Partial<Invoice>
): Promise<Invoice> {
	const current = await db.invoices.get(invoiceId);
	if (!current) throw new Error(`Invoice not found: ${invoiceId}`);

	const optionsRecord = await db.options.get('1');
	const taxPercent = normalizeTaxRateToPercent(optionsRecord?.taxRate);

	const merged = applyTotalsToInvoiceDraft(
		{
			...current,
			...patch,
			billableItems: patch.billableItems ?? current.billableItems,
			clientSnapshot: patch.clientSnapshot ?? current.clientSnapshot
		},
		taxPercent
	);

	await updateInvoice(invoiceId, {
		clientSnapshot: merged.clientSnapshot,
		billableItems: merged.billableItems,
		invoiceDiscount: merged.invoiceDiscount,
		notes: merged.notes,
		dueDate: merged.dueDate,
		invoiceDate: merged.invoiceDate,
		subtotal: merged.subtotal,
		taxAmount: merged.taxAmount,
		amount: merged.amount,
		status: merged.status,
		paidAt: merged.paidAt,
		updatedAt: new Date()
	});

	const fresh = await db.invoices.get(invoiceId);
	if (!fresh) throw new Error(`Invoice missing after save: ${invoiceId}`);
	return fresh;
}

/** Overwrite snapshot from current job + client (Refresh from job). */
export async function refreshInvoiceSnapshotFromJob(
	invoiceId: string,
	job: Job
): Promise<Invoice> {
	const client = await resolveClientForJob(job);
	const optionsRecord = await db.options.get('1');
	const dueDays = optionsRecord?.invoiceDueDays ?? 30;
	const defaults = buildSnapshotDefaults(job, client, dueDays);
	return saveInvoiceSnapshot(invoiceId, {
		clientSnapshot: defaults.clientSnapshot,
		billableItems: defaults.billableItems,
		dueDate: defaults.dueDate
	});
}

/** Optional hybrid write-back: push snapshot client fields + billables to Client/Job. */
export async function writeInvoiceSnapshotToClientJob(invoiceId: string): Promise<void> {
	const invoice = await db.invoices.get(invoiceId);
	if (!invoice?.clientSnapshot) return;

	const job = invoice.jobId ? await db.jobs.get(invoice.jobId) : null;
	const clientId = job?.clientId || invoice.clientId;
	if (!clientId) return;

	const snap = invoice.clientSnapshot;
	await updateClient(clientId, {
		name: snap.name,
		serviceAddressStreet: snap.serviceAddressStreet,
		serviceAddressCity: snap.serviceAddressCity,
		serviceAddressState: snap.serviceAddressState,
		serviceAddressZip: snap.serviceAddressZip,
		useBillingAddress: snap.useBillingAddress,
		billingAddressStreet: snap.billingAddressStreet,
		billingAddressCity: snap.billingAddressCity,
		billingAddressState: snap.billingAddressState,
		billingAddressZip: snap.billingAddressZip,
		phone: snap.phone,
		email: snap.email
	});

	if (job?.id && invoice.billableItems?.length) {
		const totals = calculateInvoiceTotals({
			billableItems: invoice.billableItems,
			invoiceDiscount: invoice.invoiceDiscount,
			taxRatePercent: normalizeTaxRateToPercent(
				(await db.options.get('1'))?.taxRate
			)
		});
		await updateJob(job.id, {
			billableItems: invoice.billableItems.map(({ title, price, quantity, total, unit }) => ({
				title,
				price,
				quantity,
				total,
				...(unit ? { unit } : {})
			})) as Job['billableItems'],
			subtotal: totals.subtotal,
			taxAmount: totals.taxAmount,
			totalAmount: totals.total
		});
	}
}

/** Bump version + invoice number before generate/regenerate. */
export async function bumpInvoiceVersionForGenerate(
	invoiceId: string,
	generateDate = new Date()
): Promise<Invoice> {
	const invoice = await db.invoices.get(invoiceId);
	if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

	const optionsRecord = await db.options.get('1');
	const prefix = (optionsRecord?.invoiceNumberPrefix || 'CCW').trim() || 'CCW';
	const nextVersion = (invoice.version ?? 0) + 1;
	const invoiceNumber = formatInvoiceNumber(prefix, generateDate, nextVersion);

	await updateInvoice(invoiceId, {
		version: nextVersion,
		invoiceNumber,
		lastGeneratedAt: generateDate,
		updatedAt: new Date()
	});

	const fresh = await db.invoices.get(invoiceId);
	if (!fresh) throw new Error(`Invoice missing after version bump: ${invoiceId}`);
	return fresh;
}

// )=- Convenience helper used by "Mark Complete" flow and supporting docs.
export async function ensureInvoiceForJob(
	job: Job,
	status: Invoice['status'] = 'generated',
	files?: {
		primary?: { blob: Blob; filename: string };
		supporting?: Array<{ blob: Blob; filename: string; type?: string }>;
	}
): Promise<string> {
	const existing = await getInvoiceForJob(job.id!);
	const shell = await ensureInvoiceShell(job, existing ? undefined : files);
	if (status === 'generated' && shell.status === 'draft') {
		await updateInvoice(shell.id!, { status: 'generated', updatedAt: new Date() });
	}
	if (existing && (files?.supporting?.length || files?.primary)) {
		await updateInvoice(shell.id!, { updatedAt: new Date() }, files);
	}
	return shell.id!;
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
	const existing = await db.users.get(userId);
	const safeUpdates = safeClone({ ...updates, updatedAt: new Date() });
	await db.users.update(userId, safeUpdates);

	if (
		existing &&
		(updates.name !== undefined || updates.firstName !== undefined || updates.lastName !== undefined)
	) {
		const merged = { ...existing, ...safeUpdates };
		const newName =
			merged.name || `${merged.firstName || ''} ${merged.lastName || ''}`.trim();
		const oldAliases = getUserCrewNameAliases(existing);
		if (newName && oldAliases.some((a) => a !== newName)) {
			await renameCrewNamesOnJobs(oldAliases, newName);
		}
	}

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

	await removeCrewNamesFromJobs(getUserCrewNameAliases(exists));

	const idToDelete = exists.pbId || userId;
	const emailKey = exists.email?.toLowerCase();

	const siblings = await db.users
		.filter(
			(u) =>
				u.id === userId ||
				(exists.pbId && u.pbId === exists.pbId) ||
				(!!emailKey && u.email?.toLowerCase() === emailKey)
		)
		.toArray();

	for (const s of siblings) {
		await db.users.delete(s.id!);
	}

	await addToSyncQueue({
		type: 'delete',
		collection: 'users',
		recordId: idToDelete
	});

	if (navigator.onLine) await processSyncQueue();
}

export async function resolveUserPbId(localUserId: string): Promise<string | null> {
	if (!localUserId) return null;

	let user = await db.users.get(localUserId);
	if (user?.pbId) return user.pbId;

	await new Promise((r) => setTimeout(r, 60));
	user = await db.users.get(localUserId);
	if (user?.pbId) return user.pbId;

	const isUuid = (id: string) =>
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

	// Never PATCH PocketBase with a Dexie UUID — caller must skip or wait for sync.
	if (user?.id && isUuid(user.id)) return null;

	return user?.id || null;
}

export async function resolveClientPbId(localClientId: string): Promise<string> {
	if (!localClientId) return localClientId;

	let client = await db.clients.get(localClientId);
	if (client?.pbId) return client.pbId;

	await new Promise((r) => setTimeout(r, 60));
	client = await db.clients.get(localClientId);
	return client?.pbId || client?.id || localClientId;
}

// )=- Batch A (PLAN.md): Dexie UUID detector — never send these as PocketBase relation ids.
const isDexieUuid = (id: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Resolve a job to its PocketBase id for relation fields. Returns null if not synced yet. */
export async function resolveJobPbId(localJobId: string): Promise<string | null> {
	if (!localJobId) return null;

	let job = await db.jobs.get(localJobId);
	if (job?.pbId) return job.pbId;

	const byPb = await db.jobs.where('pbId').equals(localJobId).first();
	if (byPb?.pbId) return byPb.pbId;

	await new Promise((r) => setTimeout(r, 60));
	job = await db.jobs.get(localJobId);
	if (job?.pbId) return job.pbId;

	if (job?.id && isDexieUuid(job.id)) return null;
	if (job?.id && !isDexieUuid(job.id)) return job.id;

	return null;
}

/** Strict client resolver for PB relations — null when only a local Dexie row exists. */
export async function resolveClientPbIdForSync(localClientId: string): Promise<string | null> {
	if (!localClientId) return null;

	let client = await db.clients.get(localClientId);
	if (client?.pbId) return client.pbId;

	const byPb = await db.clients.where('pbId').equals(localClientId).first();
	if (byPb?.pbId) return byPb.pbId;

	await new Promise((r) => setTimeout(r, 60));
	client = await db.clients.get(localClientId);
	if (client?.pbId) return client.pbId;

	if (isDexieUuid(localClientId) || (client?.id && isDexieUuid(client.id))) return null;
	if (client?.id && !isDexieUuid(client.id)) return client.id;

	return null;
}

async function resolveInvoicePbRelations(
	jobId?: string,
	clientId?: string
): Promise<{ job: string; client: string } | null> {
	const jobPb = jobId ? await resolveJobPbId(jobId) : null;
	const clientPb = clientId ? await resolveClientPbIdForSync(clientId) : null;
	if (!jobPb || !clientPb) return null;
	return { job: jobPb, client: clientPb };
}

/** Map Dexie job queue data → PocketBase jobs collection payload (Batch B). */
async function jobDataToPbPayload(data: any): Promise<Record<string, unknown>> {
	const realClientId = await resolveClientPbId(data.clientId || data.client);
	const taxPercent = normalizeTaxRateToPercent(data.taxRate);

	const payload: Record<string, unknown> = {
		title: data.title,
		start: data.start instanceof Date ? data.start.toISOString() : data.start,
		end: data.end instanceof Date ? data.end.toISOString() : data.end,
		client: realClientId,
		assignedCrew: data.assignedCrew || [],
		areaOfTown: data.areaOfTown,
		notes: data.notes || undefined,
		billableItems: data.billableItems || [],
		subtotal: Number(data.subtotal) || 0,
		taxRate: taxRatePercentToPbDecimal(taxPercent),
		taxAmount: Number(data.taxAmount) || 0,
		totalAmount: Number(data.totalAmount) || 0,
		status: data.status || 'scheduled',
		cancelReason:
			data.cancelReason === '' ? '' : data.cancelReason || undefined,
		cancelNotes: data.cancelNotes === '' ? '' : data.cancelNotes || undefined,
		cancelledAt:
			data.cancelledAt === null
				? null
				: data.cancelledAt
					? data.cancelledAt instanceof Date
						? data.cancelledAt.toISOString()
						: data.cancelledAt
					: undefined,
		cancelledBy: data.cancelledBy === null ? null : data.cancelledBy || undefined,
		importSource: data.importSource || undefined
	};

	return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
}

// Dexie-only / transient queue keys — never send as PocketBase scalar fields.
const INVOICE_QUEUE_SKIP_KEYS = new Set([
	'_files',
	'_fileDeletes',
	'id',
	'pbId',
	'createdAt',
	'updatedAt',
	'jobId',
	'clientId',
	// File fields: blobs go via _files in FormData; metadata stays local-only.
	'supportingDocuments',
	'primaryInvoiceFile'
]);

function invoiceScalarToPbPayload(data: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(data)) {
		if (INVOICE_QUEUE_SKIP_KEYS.has(key) || val == null) continue;
		out[key] =
			val instanceof Date
				? val.toISOString()
				: typeof val === 'object' && !Array.isArray(val)
					? val
					: val;
	}
	return out;
}

function appendInvoiceQueueScalarsToFormData(formData: FormData, data: Record<string, unknown>) {
	for (const [key, val] of Object.entries(data)) {
		if (INVOICE_QUEUE_SKIP_KEYS.has(key) || val == null) continue;
		if (val instanceof Date) {
			formData.append(key, val.toISOString());
		} else if (typeof val === 'object') {
			formData.append(key, JSON.stringify(val));
		} else {
			formData.append(key, String(val));
		}
	}
}

// ==================== SYNC QUEUE ====================

export async function addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'createdAt'>) {
	await db.syncQueue.add({ ...item, createdAt: new Date() });
}

// )=- Batch A: single-flight guard so concurrent login/CRUD/online handlers cannot double-create on PB.
let syncQueueInFlight: Promise<void> | null = null;

export async function processSyncQueue(): Promise<void> {
	if (syncQueueInFlight) {
		return syncQueueInFlight;
	}
	syncQueueInFlight = runProcessSyncQueue().finally(() => {
		syncQueueInFlight = null;
	});
	return syncQueueInFlight;
}

async function runProcessSyncQueue(): Promise<void> {
	const items = await db.syncQueue.orderBy('createdAt').toArray();

	for (const item of items) {
		let itemSynced = false;

		try {
			if (item.collection === 'jobs') {
				if (item.type === 'create') {
					const pbPayload = await jobDataToPbPayload(item.data);

					try {
						const record = await pb.collection('jobs').create(pbPayload);
						await db.jobs.update(item.recordId, { pbId: record.id });
						console.log(`✅ Job pushed to PocketBase: ${record.id}`);
						itemSynced = true;
					} catch (err: any) {
						console.error('❌ Job create failed:', JSON.stringify(err.response?.data, null, 2));
					}
				} else if (item.type === 'update') {
					const job = await db.jobs.get(item.recordId);
					const realId = job?.pbId || job?.id || item.recordId;

					try {
						const merged = safeClone({ ...job, ...item.data });
						const pbPayload = await jobDataToPbPayload(merged);
						await pb.collection('jobs').update(realId, pbPayload);
						console.log(`✅ Job updated in PocketBase: ${realId}`);
						itemSynced = true;
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
						itemSynced = true;
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
						itemSynced = true;
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
						itemSynced = true;
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
						itemSynced = true;
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
						itemSynced = true;
					} catch (err: any) {
						console.error('❌ User sync failed with 400:', err.response?.data);
						// Clean up the bad/stale queue item (e.g. old pending NewUser create that included fields PB rules reject).
						// Prevents the item from retrying (and spamming errors) on every subsequent login / processSyncQueue.
						await db.syncQueue.delete(item.id!);
						throw { __intentionallyDropped: true, reason: 'User create 400 (likely schema/rule on verified or similar); queue item removed' };
					}
				} else if (item.type === 'update') {
					try {
						const realId = await resolveUserPbId(item.recordId);
						if (!realId) {
							console.warn(
								`ℹ️ Skipping user update for ${item.recordId} — no PocketBase id yet (awaiting create sync)`
							);
							continue;
						}

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
						itemSynced = true;
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
						itemSynced = true;
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

						// )=- Batch A: resolve PB relation ids before any invoice push (skip until job/client synced).
						const relationIds = await resolveInvoicePbRelations(
							data.jobId || localAtProcess?.jobId,
							data.clientId || localAtProcess?.clientId
						);
						if (!relationIds && !localAtProcess?.pbId) {
							console.warn(
								`ℹ️ Keeping invoice create queue item ${item.id} — job/client not on PocketBase yet`
							);
							continue;
						}

						// )=- If by the time this create item is processed the local now has a pbId (e.g. the original
						// create from Generate ran, or a promoted update fallback created it), treat this as an update
						// instead so we don't create duplicate records on PB. Use the files from this item if present.
						if (localAtProcess?.pbId) {
							const realId = localAtProcess.pbId;
							const hasFiles = !!data._files || !!data._fileDeletes;
							if (hasFiles) {
								const formData = new FormData();
								appendInvoiceQueueScalarsToFormData(formData, data);
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
								appendInvoiceFileDeletesToFormData(formData, data._fileDeletes);
								await pb.collection('invoices').update(realId, formData);
								console.log(
									`✅ Invoice (with files) updated in PocketBase (create item promoted to update): ${realId}`
								);
								itemSynced = true;
							} else {
								const rel = await resolveInvoicePbRelations(
									data.jobId || localAtProcess?.jobId,
									data.clientId || localAtProcess?.clientId
								);
								const pbPayload: Record<string, unknown> = {
									...invoiceScalarToPbPayload(data),
									...(rel ? { job: rel.job, client: rel.client } : {})
								};
								await pb.collection('invoices').update(realId, pbPayload);
								console.log(
									`✅ Invoice updated in PocketBase (create item promoted to update): ${realId}`
								);
								itemSynced = true;
							}
						} else if (relationIds) {
							const hasFiles = !!data._files || !!data._fileDeletes;

							if (hasFiles) {
								// Use FormData for reliable multi-file + scalar upload
								const formData = new FormData();

								// Append scalar fields (PB relations use resolved PocketBase ids)
								formData.append('job', relationIds.job);
								formData.append('client', relationIds.client);
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
								if (data.invoiceNumber) formData.append('invoiceNumber', data.invoiceNumber);
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
								appendInvoiceFileDeletesToFormData(formData, data._fileDeletes);

								const record = await pb.collection('invoices').create(formData);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(`✅ Invoice (with files) pushed to PocketBase: ${record.id}`);
								itemSynced = true;
							} else {
								// No files — plain JSON create (faster)
								const pbPayload: any = {
									job: relationIds.job,
									client: relationIds.client,
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
									invoiceNumber: data.invoiceNumber || undefined,
									importSource: data.importSource || undefined
								};
								const record = await pb.collection('invoices').create(pbPayload);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(`✅ Invoice pushed to PocketBase: ${record.id}`);
								itemSynced = true;
							}
						}
					} catch (err: any) {
						console.error('❌ Invoice create sync failed:', err?.response?.data || err);
					}
				} else if (item.type === 'update') {
					try {
						const localInvoice = await db.invoices.get(item.recordId);
						const data = item.data;
						const hasFiles = !!data._files || !!data._fileDeletes;

						if (!localInvoice) {
							// Local record disappeared between queuing and processing — drop the item.
							await db.syncQueue.delete(item.id!);
							throw {
								__intentionallyDropped: true,
								reason: 'local invoice record missing during sync'
							};
						}

						if (!localInvoice.pbId) {
							const fallbackRelations = await resolveInvoicePbRelations(
								localInvoice.jobId,
								localInvoice.clientId
							);
							if (!fallbackRelations) {
								console.warn(
									`ℹ️ Keeping invoice update queue item ${item.id} — job/client not on PocketBase yet`
								);
								continue;
							}

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
								formData.append('job', fallbackRelations.job);
								formData.append('client', fallbackRelations.client);
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
								if (localInvoice.invoiceNumber)
									formData.append('invoiceNumber', localInvoice.invoiceNumber);
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
								appendInvoiceFileDeletesToFormData(formData, data._fileDeletes);

								const record = await pb.collection('invoices').create(formData);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(
									`✅ Invoice (with files) pushed to PocketBase (regenerate/create fallback): ${record.id}`
								);
								itemSynced = true;
							} else {
								const pbPayload: any = {
									job: fallbackRelations.job,
									client: fallbackRelations.client,
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
									invoiceNumber: localInvoice.invoiceNumber || undefined,
									importSource: localInvoice.importSource || undefined
								};
								const record = await pb.collection('invoices').create(pbPayload);
								await db.invoices.update(item.recordId, { pbId: record.id });
								console.log(
									`✅ Invoice pushed to PocketBase (regenerate/create fallback): ${record.id}`
								);
								itemSynced = true;
							}
						} else {
							// Normal update path — we have a pbId so the record should exist on PB.
							const realId = localInvoice.pbId;
							let updateSucceeded = false;

							try {
								if (hasFiles) {
									const formData = new FormData();

									// Only append scalar fields (map Dexie names → PB relation fields)
									const rel = await resolveInvoicePbRelations(
										data.jobId ?? localInvoice.jobId,
										data.clientId ?? localInvoice.clientId
									);
									if (rel) {
										formData.append('job', rel.job);
										formData.append('client', rel.client);
									}
									appendInvoiceQueueScalarsToFormData(
										formData,
										invoiceScalarToPbPayload(data) as Record<string, unknown>
									);

									if (data._files?.primary) {
										const f = data._files.primary;
										const file = new File([f.blob], f.filename, {
											type:
												f.blob.type ||
												'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
										});
										formData.append('primaryInvoiceFile', file);
									}
									if (data._files?.supporting?.length) {
										for (const s of data._files.supporting) {
											const file = new File([s.blob], s.filename, {
												type: s.type || s.blob.type || 'application/octet-stream'
											});
											formData.append('supportingDocuments', file);
										}
									}
									appendInvoiceFileDeletesToFormData(formData, data._fileDeletes);

									await pb.collection('invoices').update(realId, formData);
									console.log(`✅ Invoice (with files) updated in PocketBase: ${realId}`);
								} else if (data._fileDeletes) {
									const formData = new FormData();
									appendInvoiceFileDeletesToFormData(formData, data._fileDeletes);
									await pb.collection('invoices').update(realId, formData);
									console.log(`✅ Invoice files removed in PocketBase: ${realId}`);
								} else {
									const rel = await resolveInvoicePbRelations(
										data.jobId ?? localInvoice.jobId,
										data.clientId ?? localInvoice.clientId
									);
									const pbPayload: Record<string, unknown> = {
										...invoiceScalarToPbPayload(data),
										...(rel ? { job: rel.job, client: rel.client } : {})
									};
									await pb.collection('invoices').update(realId, pbPayload);
									console.log(`✅ Invoice updated in PocketBase: ${realId}`);
								}
								updateSucceeded = true;
								itemSynced = true;
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
								const fallbackRelations = await resolveInvoicePbRelations(
									localInvoice.jobId,
									localInvoice.clientId
								);
								if (!fallbackRelations) {
									console.warn(
										`ℹ️ Keeping invoice update queue item ${item.id} — job/client not on PocketBase yet (404 fallback)`
									);
									continue;
								}

								// Fallback create path (triggered either by no pbId above, or by 404 on update here)
								if (hasFiles) {
									const formData = new FormData();

									formData.append('job', fallbackRelations.job);
									formData.append('client', fallbackRelations.client);
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
									if (localInvoice.invoiceNumber)
										formData.append('invoiceNumber', localInvoice.invoiceNumber);
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
									appendInvoiceFileDeletesToFormData(formData, data._fileDeletes);

									const record = await pb.collection('invoices').create(formData);
									await db.invoices.update(item.recordId, { pbId: record.id });
									console.log(
										`✅ Invoice (with files) pushed to PocketBase (regenerate/create fallback after 404): ${record.id}`
									);
									itemSynced = true;
								} else {
									const pbPayload: any = {
										job: fallbackRelations.job,
										client: fallbackRelations.client,
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
										invoiceNumber: localInvoice.invoiceNumber || undefined,
										importSource: localInvoice.importSource || undefined
									};
									const record = await pb.collection('invoices').create(pbPayload);
									await db.invoices.update(item.recordId, { pbId: record.id });
									console.log(
										`✅ Invoice pushed to PocketBase (regenerate/create fallback after 404): ${record.id}`
									);
									itemSynced = true;
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
					if (!item.recordId) {
						await db.syncQueue.delete(item.id!);
						continue;
					}
					try {
						await pb.collection('invoices').delete(item.recordId);
						itemSynced = true;
					} catch (err: any) {
						if (err.status === 404) {
							await db.syncQueue.delete(item.id!);
						} else {
							throw err;
						}
					}
				}
			}

			// )=- Batch A: only remove queue items after confirmed PocketBase success (never on swallowed errors).
			if (itemSynced) {
				await db.syncQueue.delete(item.id!);
				console.log(`✅ Synced ${item.type} ${item.collection} ${item.recordId}`);
			}
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

export { cleanupDuplicateUsers } from '$lib/db/userSync';

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
