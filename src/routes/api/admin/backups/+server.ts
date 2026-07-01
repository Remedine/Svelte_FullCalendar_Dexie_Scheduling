import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { listBackups, runBackup } from '$lib/server/backups';
import { previewRetention, dateFromBackupFilename } from '$lib/backups/retention';

function authHeader(request: Request): string | null {
	return request.headers.get('Authorization');
}

/** GET: list backups + retention preview. POST: manual backup now. */
export async function GET({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const items = await listBackups();
	const dates = items
		.map((i) => dateFromBackupFilename(i.name))
		.filter((d): d is string => Boolean(d));
	const retention = previewRetention(dates);

	return json({ items, retention });
}

export async function POST({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	try {
		await request.json();
	} catch {
		// empty body is fine
	}

	const result = await runBackup({ manual: true });
	if (!result.ok) {
		return json({ error: result.error || 'Backup failed' }, { status: 500 });
	}

	return json(result);
}