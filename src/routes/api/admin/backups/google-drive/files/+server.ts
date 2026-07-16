import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { listDriveBackups } from '$lib/server/backups';

/** GET: list backup artifacts in the connected Google Drive folder. */
export async function GET({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	try {
		const items = await listDriveBackups();
		return json({
			items,
			restorableCount: items.filter((i) => i.restorable).length
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to list Drive backups';
		const status = message.toLowerCase().includes('not connected') ? 400 : 500;
		return json({ error: message }, { status });
	}
}
