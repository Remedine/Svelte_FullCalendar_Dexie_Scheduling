import { json } from '@sveltejs/kit';
import { isFullBackupFilename } from '$lib/backups/names';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { listDriveBackups } from '$lib/server/backups';

/** GET: list full backups in the connected Google Drive folder. */
export async function GET({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	try {
		const all = await listDriveBackups();
		const items = all.filter((i) => isFullBackupFilename(i.name));
		return json({
			items,
			restorableCount: items.length
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to list Drive backups';
		const status = message.toLowerCase().includes('not connected') ? 400 : 500;
		return json({ error: message }, { status });
	}
}
