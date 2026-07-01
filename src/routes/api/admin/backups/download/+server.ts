import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';

/** Proxy PocketBase backup zip download for authenticated admins. */
export async function GET({
	request,
	url
}: {
	request: Request;
	url: URL;
}) {
	const token = request.headers.get('Authorization');
	if (!(await assertAdminFromAuthHeader(token))) {
		return new Response('Forbidden', { status: 403 });
	}

	const name = url.searchParams.get('name')?.trim();
	if (!name) {
		return new Response('Missing name', { status: 400 });
	}

	const res = await fetch(
		`${PUBLIC_PB_URL}/api/internal/backups/download?name=${encodeURIComponent(name)}`,
		{ headers: { 'X-Internal-Secret': INTERNAL_SECRET } }
	);

	if (!res.ok) {
		return new Response('Backup not found', { status: res.status });
	}

	const headers = new Headers();
	const contentType = name.toLowerCase().endsWith('.json')
		? 'application/json'
		: 'application/zip';
	headers.set('Content-Type', contentType);
	headers.set('Content-Disposition', `attachment; filename="${name}"`);
	const len = res.headers.get('Content-Length');
	if (len) headers.set('Content-Length', len);

	return new Response(res.body, { status: 200, headers });
}