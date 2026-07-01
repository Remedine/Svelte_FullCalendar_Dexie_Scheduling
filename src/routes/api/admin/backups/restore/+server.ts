import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { finalizeRestoreAfterPbRestart, restorePbBackup } from '$lib/server/backups';

/** Restore a server-stored PocketBase backup (restarts PB). */
export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let body: { name?: string; confirmName?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const name = body.name?.trim();
	const confirmName = body.confirmName?.trim();
	if (!name) {
		return json({ error: 'Backup name is required' }, { status: 400 });
	}
	if (!confirmName || confirmName !== name) {
		return json(
			{ error: 'Type the exact backup filename to confirm restore' },
			{ status: 400 }
		);
	}

	try {
		const result = await restorePbBackup(name);
		// PocketBase restarts asynchronously; bump authEpoch when healthy so every
		// device (crew phones included) signs out through the app and re-syncs.
		void finalizeRestoreAfterPbRestart();
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Restore failed';
		return json({ error: message }, { status: 500 });
	}
}