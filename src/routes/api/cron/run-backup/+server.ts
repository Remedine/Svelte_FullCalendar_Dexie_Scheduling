import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { fetchOptionsRecord, runBackup } from '$lib/server/backups';

/** Railway cron: daily automated backup when enabled in Options → Backups. */
export async function POST({ request }: { request: Request }) {
	const secret =
		request.headers.get('X-Internal-Secret') || request.headers.get('x-internal-secret');
	if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const options = await fetchOptionsRecord();
	if (!options?.backupScheduledEnabled) {
		return json({ skipped: true, reason: 'Scheduled backup disabled' });
	}

	const result = await runBackup({ manual: false });
	if (!result.ok) {
		return json({ error: result.error || 'Backup failed' }, { status: 500 });
	}

	return json(result);
}