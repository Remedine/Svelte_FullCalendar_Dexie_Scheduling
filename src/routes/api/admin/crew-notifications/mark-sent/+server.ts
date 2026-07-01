import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { appendCrewNotificationLog } from '$lib/server/crewNotificationLog';

/** Record that a crew assignment email was sent (dedup for cron + in-app poller). */
export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let body: { jobId?: string; crewName?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const jobId = body.jobId?.trim();
	const crewName = body.crewName?.trim();
	if (!jobId || !crewName) {
		return json({ error: 'jobId and crewName are required' }, { status: 400 });
	}

	const ok = await appendCrewNotificationLog(jobId, crewName);
	if (!ok) {
		return json({ error: 'Failed to update notification log' }, { status: 500 });
	}

	return json({ success: true });
}