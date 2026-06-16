import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import type { PbUserRecord } from '$lib/db/userSync';

async function assertAdmin(token: string): Promise<boolean> {
	const authRes = await fetch(`${PUBLIC_PB_URL}/api/collections/users/auth-refresh`, {
		method: 'POST',
		headers: { Authorization: token }
	});
	if (!authRes.ok) return false;
	const authData = await authRes.json();
	return authData?.record?.role === 'admin';
}

async function fetchInternalRoster(): Promise<{ items: PbUserRecord[]; totalItems: number } | null> {
	const res = await fetch(`${PUBLIC_PB_URL}/api/internal/users-roster`, {
		headers: { 'X-Internal-Secret': INTERNAL_SECRET }
	});
	if (!res.ok) return null;
	const data = await res.json();
	return {
		items: (data.items || []) as PbUserRecord[],
		totalItems: data.totalItems ?? data.items?.length ?? 0
	};
}

/** Fallback: paginate standard PB list with internal secret (may include emails on some PB builds). */
async function fetchInternalListRoster(): Promise<{ items: PbUserRecord[]; totalItems: number } | null> {
	const PAGE_SIZE = 100;
	let page = 1;
	let totalPages = 1;
	let totalItems = 0;
	const items: PbUserRecord[] = [];

	while (page <= totalPages) {
		const res = await fetch(
			`${PUBLIC_PB_URL}/api/collections/users/records?page=${page}&perPage=${PAGE_SIZE}&sort=-updated`,
			{ headers: { 'X-Internal-Secret': INTERNAL_SECRET } }
		);
		if (!res.ok) return items.length ? { items, totalItems: totalItems || items.length } : null;
		const data = await res.json();
		totalPages = data.totalPages ?? 1;
		totalItems = data.totalItems ?? items.length;
		items.push(...(data.items || []));
		page++;
	}

	return { items, totalItems: totalItems || items.length };
}

export async function GET({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!token) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (!(await assertAdmin(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const roster = (await fetchInternalRoster()) ?? (await fetchInternalListRoster());
	if (!roster) {
		return json({ error: 'Failed to load roster from PocketBase' }, { status: 502 });
	}

	return json(roster);
}