import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { buildBackupFilename, parseAlertEmails } from '$lib/backups/names';
import { dateFromBackupFilename, shouldKeepBackupDate } from '$lib/backups/retention';
import { sendBackupFailureAlert, sendBackupSuccessEmail } from '$lib/server/brevo';

const BREVO_MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export type BackupListItem = {
	name: string;
	size: number;
	created: string;
};

export type OptionsBackupFields = {
	id?: string;
	businessName?: string;
	authEpoch?: number;
	backupScheduledEnabled?: boolean;
	backupDestEmail?: boolean;
	backupAlertEmails?: string;
	lastBackupAt?: string;
	lastBackupSizeBytes?: number;
	lastBackupFilename?: string;
	lastBackupStatus?: string;
	lastBackupError?: string;
	syncQueueSnapshot?: unknown;
	syncQueueSnapshotAt?: string;
};

async function internalFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${PUBLIC_PB_URL}${path}`, {
		...init,
		headers: {
			'X-Internal-Secret': INTERNAL_SECRET,
			...(init?.headers || {})
		}
	});
}

export async function fetchOptionsRecord(): Promise<OptionsBackupFields | null> {
	const res = await internalFetch('/api/collections/options/records?perPage=1');
	if (!res.ok) return null;
	const data = await res.json();
	return data.items?.[0] ?? null;
}

export async function patchOptionsRecord(fields: Record<string, unknown>): Promise<boolean> {
	const res = await internalFetch('/api/internal/options/patch', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(fields)
	});
	return res.ok;
}

export async function listBackups(): Promise<BackupListItem[]> {
	const res = await internalFetch('/api/internal/backups');
	if (!res.ok) return [];
	const data = await res.json();
	return (data.items || []) as BackupListItem[];
}

export async function createPbBackup(name: string): Promise<BackupListItem> {
	const res = await internalFetch('/api/internal/backups/create', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name })
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Backup create failed (${res.status}): ${text}`);
	}
	return (await res.json()) as BackupListItem;
}

export async function downloadBackupBuffer(name: string): Promise<Buffer> {
	const res = await internalFetch(
		`/api/internal/backups/download?name=${encodeURIComponent(name)}`
	);
	if (!res.ok) {
		throw new Error(`Backup download failed (${res.status})`);
	}
	const ab = await res.arrayBuffer();
	return Buffer.from(ab);
}

export async function deleteBackup(name: string): Promise<void> {
	const res = await internalFetch(
		`/api/internal/backups?name=${encodeURIComponent(name)}`,
		{ method: 'DELETE' }
	);
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Backup delete failed (${res.status}): ${text}`);
	}
}

export async function uploadPbBackup(file: File | Blob, filename: string): Promise<BackupListItem> {
	const form = new FormData();
	form.append('file', file, filename);
	const res = await internalFetch('/api/internal/backups/upload', {
		method: 'POST',
		body: form
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Backup upload failed (${res.status}): ${text}`);
	}
	return (await res.json()) as BackupListItem;
}

/** Stream multipart body straight to PocketBase (avoids buffering large zips twice). */
export async function uploadPbBackupStream(
	body: ReadableStream<Uint8Array> | null,
	contentType: string | null
): Promise<BackupListItem> {
	if (!body) {
		throw new Error('Missing upload body');
	}
	const headers: Record<string, string> = {
		'X-Internal-Secret': INTERNAL_SECRET
	};
	if (contentType) {
		headers['Content-Type'] = contentType;
	}
	const res = await fetch(`${PUBLIC_PB_URL}/api/internal/backups/upload`, {
		method: 'POST',
		headers,
		body,
		// Required when streaming a request body in Node 18+ fetch.
		duplex: 'half'
	} as RequestInit);
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Backup upload failed (${res.status}): ${text}`);
	}
	return (await res.json()) as BackupListItem;
}

export type RestoreBackupResult = {
	started: boolean;
	name: string;
	message: string;
};

/** Restore a server-stored backup. PocketBase restarts asynchronously. */
export async function restorePbBackup(name: string): Promise<RestoreBackupResult> {
	const res = await internalFetch('/api/internal/backups/restore', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name })
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Restore failed (${res.status}): ${text}`);
	}
	return (await res.json()) as RestoreBackupResult;
}

/** Poll PocketBase until it responds after a restore restart. */
export async function waitForPbHealth(
	opts: { maxWaitMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
	const maxWaitMs = opts.maxWaitMs ?? 180_000;
	const intervalMs = opts.intervalMs ?? 5_000;
	const deadline = Date.now() + maxWaitMs;

	while (Date.now() < deadline) {
		try {
			const res = await fetch(`${PUBLIC_PB_URL}/api/health`, {
				signal: AbortSignal.timeout(8_000)
			});
			if (res.ok) return true;
		} catch {
			/* PB still restarting */
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	return false;
}

/** Increment global auth epoch so all app clients force-logout and re-sync. */
export async function bumpAuthEpoch(): Promise<number> {
	const options = await fetchOptionsRecord();
	const next = Math.max(0, Number(options?.authEpoch ?? 0)) + 1;
	const ok = await patchOptionsRecord({ authEpoch: next });
	if (!ok) {
		throw new Error('Failed to bump auth epoch after restore');
	}
	return next;
}

/**
 * After restore: wait for PocketBase, bump authEpoch, and let clients self-logout.
 * Safe to call multiple times (epoch only moves forward).
 */
export async function finalizeRestoreAfterPbRestart(): Promise<{
	healthy: boolean;
	authEpoch?: number;
}> {
	const healthy = await waitForPbHealth();
	if (!healthy) {
		console.error('[backup] PocketBase did not become healthy after restore');
		return { healthy: false };
	}

	try {
		const authEpoch = await bumpAuthEpoch();
		console.log(`[backup] Post-restore auth epoch bumped to ${authEpoch}`);
		return { healthy: true, authEpoch };
	} catch (err) {
		console.error('[backup] Post-restore auth epoch bump failed', err);
		return { healthy: true };
	}
}

/** Prune backups that fall outside the retention calendar (server store only). */
export async function pruneBackupsByRetention(): Promise<{ pruned: string[]; kept: number }> {
	const items = await listBackups();
	const pruned: string[] = [];
	let kept = 0;
	for (const item of items) {
		const date = dateFromBackupFilename(item.name);
		if (!date) {
			kept++;
			continue;
		}
		if (shouldKeepBackupDate(date)) {
			kept++;
			continue;
		}
		try {
			await deleteBackup(item.name);
			pruned.push(item.name);
		} catch (err) {
			console.error('[backup] prune failed for', item.name, err);
			kept++;
		}
	}
	return { pruned, kept };
}

export type RunBackupResult = {
	ok: boolean;
	filename?: string;
	size?: number;
	created?: string;
	error?: string;
	emailed?: boolean;
	pruned?: string[];
};

/** Create a backup, update options metadata, optionally email, then prune old server copies. */
export async function runBackup(opts: {
	manual?: boolean;
	filename?: string;
} = {}): Promise<RunBackupResult> {
	const options = await fetchOptionsRecord();
	const businessName = options?.businessName || 'Capital City Windows';
	const filename = opts.filename || buildBackupFilename(businessName);
	const alertEmails = parseAlertEmails(options?.backupAlertEmails);
	const destEmail = options?.backupDestEmail ?? false;

	try {
		const created = await createPbBackup(filename);
		const now = new Date().toISOString();

		await patchOptionsRecord({
			lastBackupAt: now,
			lastBackupSizeBytes: created.size ?? 0,
			lastBackupFilename: created.name,
			lastBackupStatus: 'success',
			lastBackupError: ''
		});

		let emailed = false;
		if (destEmail && alertEmails.length > 0 && (created.size ?? 0) <= BREVO_MAX_ATTACHMENT_BYTES) {
			try {
				const buf = await downloadBackupBuffer(created.name);
				await sendBackupSuccessEmail(alertEmails, {
					filename: created.name,
					sizeBytes: created.size ?? buf.length,
					manual: opts.manual ?? false,
					zipBase64: buf.toString('base64'),
					hasSyncQueue: Boolean(options?.syncQueueSnapshot)
				});
				emailed = true;
			} catch (emailErr) {
				console.error('[backup] email delivery failed:', emailErr);
			}
		} else if (destEmail && alertEmails.length > 0) {
			await sendBackupSuccessEmail(alertEmails, {
				filename: created.name,
				sizeBytes: created.size ?? 0,
				manual: opts.manual ?? false,
				zipBase64: null,
				hasSyncQueue: Boolean(options?.syncQueueSnapshot),
				tooLargeForEmail: true
			});
			emailed = true;
		}

		const { pruned } = await pruneBackupsByRetention();

		return {
			ok: true,
			filename: created.name,
			size: created.size,
			created: created.created,
			emailed,
			pruned
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const now = new Date().toISOString();
		await patchOptionsRecord({
			lastBackupAt: now,
			lastBackupStatus: 'failed',
			lastBackupError: message
		});

		if (alertEmails.length > 0) {
			try {
				await sendBackupFailureAlert(alertEmails, {
					error: message,
					manual: opts.manual ?? false
				});
			} catch (alertErr) {
				console.error('[backup] failure alert email failed:', alertErr);
			}
		}

		return { ok: false, error: message };
	}
}