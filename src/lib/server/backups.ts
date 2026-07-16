import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import {
	backupDateInAlaska,
	isFullBackupFilename,
	isNonFullBackupArtifact,
	isRestorableBackupFilename,
	parseAlertEmails
} from '$lib/backups/names';
import {
	dateFromBackupFilename,
	shouldKeepBackupDate,
	shouldKeepServerSafetyNetDate
} from '$lib/backups/retention';
import { sendBackupFailureAlert } from '$lib/server/brevo';
import {
	downloadGoogleDriveFileBuffer,
	isGoogleDriveConfigured,
	listGoogleDriveBackupFiles,
	openDriveRefreshToken,
	pruneGoogleDriveBackupsByRetention,
	pruneGoogleDriveNonFullArtifacts,
	resolveGoogleDriveFolderId,
	uploadBackupArtifactsToDrive,
	type DriveBackupFile,
	type GoogleDriveConnectionMeta
} from '$lib/server/googleDrive';

const INTERNAL_BACKUP_FILES = new Set(['_backup_file_manifest.json']);

export type BackupListItem = {
	name: string;
	size: number;
	created: string;
};

export type BackupArtifact = BackupListItem & {
	kind?: string;
};

export type OptionsBackupFields = {
	id?: string;
	businessName?: string;
	authEpoch?: number;
	backupScheduledEnabled?: boolean;
	backupScheduledHour?: number;
	lastScheduledBackupDate?: string;
	/** @deprecated Success/email attach disabled; field retained for schema compat. */
	backupDestEmail?: boolean;
	backupDestGoogleDrive?: boolean;
	backupGoogleDriveFolderId?: string;
	/** OAuth refresh token — server-only; never map into client options store. */
	backupGoogleDriveRefreshToken?: string;
	backupGoogleDriveEmail?: string;
	backupGoogleDriveFolderName?: string;
	backupAlertEmails?: string;
	lastBackupAt?: string;
	lastBackupSizeBytes?: number;
	lastBackupFilename?: string;
	lastBackupStatus?: string;
	lastBackupError?: string;
	syncQueueSnapshot?: unknown;
	syncQueueSnapshotAt?: string;
	crewAssignmentDaysBefore?: number;
	crewAssignmentHour?: number;
	crewNotificationLog?: string[];
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
	const res = await internalFetch('/api/internal/options');
	if (!res.ok) return null;
	return (await res.json()) as OptionsBackupFields;
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
	return ((data.items || []) as BackupListItem[]).filter(
		(item) => !INTERNAL_BACKUP_FILES.has(item.name)
	);
}

/**
 * Create a daily full native PocketBase backup.
 * Uses the PB create-split endpoint with includeFull=true, then removes any
 * fragment artifacts so only `_full.zip` remains.
 */
export async function createFullPbBackup(req: {
	datePrefix: string;
	business: string;
}): Promise<BackupArtifact> {
	const res = await internalFetch('/api/internal/backups/create-split', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			datePrefix: req.datePrefix,
			business: req.business,
			includeFull: true,
			forceFullFiles: true,
			syncQueueJson: ''
		})
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`Full backup create failed (${res.status}): ${text}`);
	}
	const data = await res.json();
	const artifacts = (data.artifacts || []) as BackupArtifact[];
	if (artifacts.length === 0) {
		throw new Error('Backup create returned no artifacts');
	}

	const full =
		artifacts.find((a) => a.kind === 'full' || isFullBackupFilename(a.name)) ?? null;

	// Drop fragments / sync_queue immediately so only full remains on the server.
	for (const a of artifacts) {
		if (full && a.name === full.name) continue;
		if (isFullBackupFilename(a.name)) continue;
		try {
			await deleteBackup(a.name);
		} catch (err) {
			console.warn('[backup] failed to remove non-full artifact after create:', a.name, err);
		}
	}

	if (!full) {
		throw new Error(
			'Backup create did not produce a _full.zip. Check PocketBase create-split (includeFull).'
		);
	}

	return full;
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

export type DriveConnectionContext = {
	ready: boolean;
	folderId: string | null;
	meta: GoogleDriveConnectionMeta;
	error?: string;
};

/** Resolve OAuth/service-account Drive connection from the options record. */
export async function getDriveConnectionFromOptions(): Promise<DriveConnectionContext> {
	const options = await fetchOptionsRecord();
	const refreshToken = openDriveRefreshToken(options?.backupGoogleDriveRefreshToken);
	const folderId = resolveGoogleDriveFolderId(options?.backupGoogleDriveFolderId);
	const meta: GoogleDriveConnectionMeta = {
		refreshToken,
		folderId,
		folderName: options?.backupGoogleDriveFolderName,
		email: options?.backupGoogleDriveEmail
	};
	const ready = isGoogleDriveConfigured(options?.backupGoogleDriveFolderId, refreshToken);
	if (!ready) {
		return {
			ready: false,
			folderId,
			meta,
			error:
				'Google Drive is not connected. Open Options → Backups → Connect Google Drive first.'
		};
	}
	if (!folderId) {
		return {
			ready: false,
			folderId: null,
			meta,
			error: 'No Google Drive backup folder is configured. Reconnect Google Drive.'
		};
	}
	return { ready: true, folderId, meta };
}

/** List backup files in the connected Drive folder. */
export async function listDriveBackups(): Promise<DriveBackupFile[]> {
	const conn = await getDriveConnectionFromOptions();
	if (!conn.ready || !conn.folderId) {
		throw new Error(conn.error || 'Google Drive is not connected');
	}
	return listGoogleDriveBackupFiles(conn.folderId, conn.meta);
}

/**
 * Download a restorable full archive from Google Drive, stage it on the PocketBase
 * server backup store, then start a normal restore (PB restarts).
 */
export async function restoreBackupFromGoogleDrive(
	fileId: string,
	name: string
): Promise<RestoreBackupResult & { stagedFromDrive: true }> {
	const trimmedId = fileId?.trim();
	const trimmedName = name?.trim();
	if (!trimmedId || !trimmedName) {
		throw new Error('Drive file id and name are required');
	}
	if (!isRestorableBackupFilename(trimmedName)) {
		throw new Error('Only _full.zip archives can be restored');
	}

	const conn = await getDriveConnectionFromOptions();
	if (!conn.ready || !conn.folderId) {
		throw new Error(conn.error || 'Google Drive is not connected');
	}

	const files = await listGoogleDriveBackupFiles(conn.folderId, conn.meta);
	const match = files.find((f) => f.id === trimmedId);
	if (!match) {
		throw new Error('That file was not found in the connected Google Drive backup folder');
	}
	if (match.name !== trimmedName) {
		throw new Error('Drive file name does not match the selected backup');
	}
	if (!match.restorable) {
		throw new Error('Only _full.zip archives can be restored');
	}

	console.log(`[backup] Downloading from Google Drive: ${trimmedName} (${match.size} bytes)`);
	const buffer = await downloadGoogleDriveFileBuffer(trimmedId, conn.meta);
	if (!buffer.length) {
		throw new Error('Downloaded empty file from Google Drive');
	}

	const blob = new Blob([new Uint8Array(buffer)], { type: 'application/zip' });
	const staged = await uploadPbBackup(blob, trimmedName);
	console.log(`[backup] Staged Drive backup on server as ${staged.name}; starting restore`);

	const result = await restorePbBackup(staged.name || trimmedName);
	return { ...result, stagedFromDrive: true };
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

/** Delete retired fragment/legacy artifacts from the server backup store. */
export async function pruneServerNonFullArtifacts(): Promise<string[]> {
	const items = await listBackups();
	const pruned: string[] = [];
	for (const item of items) {
		if (!isNonFullBackupArtifact(item.name)) continue;
		try {
			await deleteBackup(item.name);
			pruned.push(item.name);
		} catch (err) {
			console.error('[backup] non-full prune failed for', item.name, err);
		}
	}
	return pruned;
}

/** Prune server full zips outside the calendar retention policy (Drive off). */
export async function pruneBackupsByRetention(): Promise<{ pruned: string[]; kept: number }> {
	const items = await listBackups();
	const pruned: string[] = [];
	let kept = 0;
	for (const item of items) {
		if (isNonFullBackupArtifact(item.name)) {
			// Handled by pruneServerNonFullArtifacts
			continue;
		}
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

/**
 * When Drive is durable store: keep only recent full zips on the server (safety net).
 */
export async function pruneServerToSafetyNet(
	now = new Date()
): Promise<{ pruned: string[]; kept: number }> {
	const items = await listBackups();
	const pruned: string[] = [];
	let kept = 0;
	for (const item of items) {
		if (isNonFullBackupArtifact(item.name)) continue;
		const date = dateFromBackupFilename(item.name);
		if (!date) {
			// Keep undated (e.g. staged odd names) to avoid deleting restore stages blindly
			kept++;
			continue;
		}
		if (shouldKeepServerSafetyNetDate(date, now)) {
			kept++;
			continue;
		}
		try {
			await deleteBackup(item.name);
			pruned.push(item.name);
		} catch (err) {
			console.error('[backup] safety-net prune failed for', item.name, err);
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
	artifacts?: BackupArtifact[];
	error?: string;
	emailed?: boolean;
	uploadedToDrive?: string[];
	/** Set when Drive destination is on but upload was skipped or failed. */
	driveError?: string;
	drivePruned?: string[];
	pruned?: string[];
	serverSafetyNetPruned?: string[];
	nonFullPruned?: string[];
};

/** Create a daily full backup, upload to Drive when enabled, prune, alert on failure only. */
export async function runBackup(
	opts: { manual?: boolean; scheduled?: boolean } = {}
): Promise<RunBackupResult> {
	const options = await fetchOptionsRecord();
	const businessName = options?.businessName || 'Capital City Windows';
	const datePrefix = backupDateInAlaska();
	const alertEmails = parseAlertEmails(options?.backupAlertEmails);
	const destDrive = options?.backupDestGoogleDrive ?? false;
	const driveFolderId = resolveGoogleDriveFolderId(options?.backupGoogleDriveFolderId);
	const driveRefreshToken = openDriveRefreshToken(options?.backupGoogleDriveRefreshToken);
	const driveMeta = {
		refreshToken: driveRefreshToken,
		folderId: driveFolderId,
		folderName: options?.backupGoogleDriveFolderName,
		email: options?.backupGoogleDriveEmail
	};
	const driveReady = isGoogleDriveConfigured(
		options?.backupGoogleDriveFolderId,
		driveRefreshToken
	);

	try {
		const full = await createFullPbBackup({
			datePrefix,
			business: businessName
		});

		const now = new Date().toISOString();
		const patchFields: Record<string, unknown> = {
			lastBackupAt: now,
			lastBackupSizeBytes: full.size ?? 0,
			lastBackupFilename: full.name,
			lastBackupStatus: 'success',
			lastBackupError: '',
			// Success email attach retired — keep flag off
			backupDestEmail: false
		};
		if (opts.scheduled) {
			patchFields.lastScheduledBackupDate = datePrefix;
		}
		await patchOptionsRecord(patchFields);

		let uploadedToDrive: string[] | undefined;
		let driveError: string | undefined;
		let driveUploadOk = false;

		if (destDrive && driveFolderId && driveReady) {
			try {
				const buffer = await downloadBackupBuffer(full.name);
				uploadedToDrive = await uploadBackupArtifactsToDrive(
					driveFolderId,
					[{ name: full.name, buffer }],
					driveMeta
				);
				driveUploadOk = (uploadedToDrive?.length ?? 0) > 0;
			} catch (driveErr) {
				driveError =
					driveErr instanceof Error ? driveErr.message : String(driveErr);
				console.error('[backup] Google Drive upload failed:', driveErr);
				// Keep server copy when Drive fails (safety).
			}
		} else if (destDrive && !driveReady) {
			driveError =
				'Google Drive is enabled but not fully connected. Open Options → Backups → Connect Google Drive, then try Backup now again.';
			console.warn('[backup]', driveError);
		}

		const nonFullPruned = await pruneServerNonFullArtifacts();

		let pruned: string[] = [];
		let serverSafetyNetPruned: string[] | undefined;

		if (destDrive && driveUploadOk) {
			// Durable store is Drive: keep ~5 days on server only.
			const safety = await pruneServerToSafetyNet();
			serverSafetyNetPruned = safety.pruned;
			pruned = safety.pruned;
		} else {
			// Server is durable (or Drive failed): calendar retention on server.
			const ret = await pruneBackupsByRetention();
			pruned = ret.pruned;
		}

		let drivePruned: string[] | undefined;
		if (destDrive && driveFolderId && driveReady) {
			try {
				const nonFullDrive = await pruneGoogleDriveNonFullArtifacts(
					driveFolderId,
					driveMeta
				);
				const driveResult = await pruneGoogleDriveBackupsByRetention(
					driveFolderId,
					new Date(),
					driveMeta
				);
				drivePruned = [...nonFullDrive, ...driveResult.pruned];
			} catch (drivePruneErr) {
				console.error('[backup] Google Drive retention prune failed:', drivePruneErr);
			}
		}

		// Drive enabled but upload failed: alert like a failure for visibility
		if (destDrive && driveError && alertEmails.length > 0) {
			try {
				await sendBackupFailureAlert(alertEmails, {
					error: `Backup was created on the server, but Google Drive upload failed: ${driveError}`,
					manual: opts.manual ?? false
				});
			} catch (alertErr) {
				console.error('[backup] Drive failure alert email failed:', alertErr);
			}
		}

		return {
			ok: true,
			filename: full.name,
			size: full.size ?? 0,
			created: full.created,
			artifacts: [full],
			emailed: false,
			uploadedToDrive,
			driveError,
			drivePruned,
			pruned,
			serverSafetyNetPruned,
			nonFullPruned
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
