import { json } from '@sveltejs/kit';
import { isRestorableBackupFilename } from '$lib/backups/names';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import {
	finalizeRestoreAfterPbRestart,
	restoreBackupFromGoogleDrive
} from '$lib/server/backups';

/**
 * POST: download a restorable archive from Google Drive, stage it on the server,
 * then start PocketBase restore (same restart / authEpoch flow as server restore).
 */
export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let body: { fileId?: string; name?: string; confirmName?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const fileId = body.fileId?.trim();
	const name = body.name?.trim();
	const confirmName = body.confirmName?.trim();
	if (!fileId || !name) {
		return json({ error: 'Drive file id and name are required' }, { status: 400 });
	}
	if (!confirmName || confirmName !== name) {
		return json(
			{ error: 'Type the exact backup filename to confirm restore' },
			{ status: 400 }
		);
	}
	if (!isRestorableBackupFilename(name)) {
		return json(
			{ error: 'Only _full.zip or legacy _Backup.zip archives can be restored' },
			{ status: 400 }
		);
	}

	try {
		const result = await restoreBackupFromGoogleDrive(fileId, name);
		void finalizeRestoreAfterPbRestart();
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Restore from Google Drive failed';
		console.error('[backup] restore from Drive failed:', err);
		return json({ error: message }, { status: 500 });
	}
}
