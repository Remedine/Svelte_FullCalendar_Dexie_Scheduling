import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { patchOptionsRecord } from '$lib/server/backups';

/** Upload Dexie sync queue snapshot from admin device (bundled with next backup). */
export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let body: { items?: unknown[] };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const items = Array.isArray(body.items) ? body.items : [];
	const ok = await patchOptionsRecord({
		syncQueueSnapshot: items,
		syncQueueSnapshotAt: new Date().toISOString()
	});

	if (!ok) {
		return json({ error: 'Failed to store sync queue snapshot' }, { status: 500 });
	}

	return json({ success: true, count: items.length });
}