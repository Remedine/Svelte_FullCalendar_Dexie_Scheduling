import { json } from '@sveltejs/kit';
import { shouldRunScheduledBackup } from '$lib/backups/schedule';
import { INTERNAL_SECRET } from '$env/static/private';
import { fetchOptionsRecord, runBackup } from '$lib/server/backups';

/** Railway cron: hourly tick; runs backup at configured Alaska hour (Options → Backups). */
export async function POST({ request }: { request: Request }) {
	const secret =
		request.headers.get('X-Internal-Secret') || request.headers.get('x-internal-secret');
	if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const options = await fetchOptionsRecord();
	const gate = shouldRunScheduledBackup(options ?? {});
	if (!gate.run) {
		return json({ skipped: true, reason: gate.reason ?? 'Not due' });
	}

	const result = await runBackup({ manual: false, scheduled: true });
	if (!result.ok) {
		return json({ error: result.error || 'Backup failed' }, { status: 500 });
	}

	return json(result);
}