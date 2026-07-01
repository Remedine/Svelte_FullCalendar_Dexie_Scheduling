import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { uploadPbBackupStream } from '$lib/server/backups';

/** Upload a .zip backup from disk (e.g. email attachment) to the server backup store. */
export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const contentType = request.headers.get('content-type') || '';
	if (!contentType.toLowerCase().includes('multipart/form-data')) {
		return json({ error: 'Expected multipart form upload' }, { status: 400 });
	}

	try {
		const uploaded = await uploadPbBackupStream(request.body, contentType);
		return json(uploaded);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Upload failed';
		return json({ error: message }, { status: 500 });
	}
}