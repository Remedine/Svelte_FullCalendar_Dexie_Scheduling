import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { uploadPbBackup } from '$lib/server/backups';

/** Upload a .zip backup from disk (e.g. email attachment) to the server backup store. */
export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const form = await request.formData();
	const file = form.get('file');
	if (!file || !(file instanceof File)) {
		return json({ error: 'Missing file' }, { status: 400 });
	}
	if (!file.name.toLowerCase().endsWith('.zip')) {
		return json({ error: 'Backup must be a .zip file' }, { status: 400 });
	}

	try {
		const uploaded = await uploadPbBackup(file, file.name);
		return json(uploaded);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Upload failed';
		return json({ error: message }, { status: 500 });
	}
}