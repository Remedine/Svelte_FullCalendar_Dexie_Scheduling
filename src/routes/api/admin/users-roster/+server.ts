import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import type { PbUserRecord } from '$lib/db/userSync';

async function assertAdmin(token: string): Promise<boolean> {
	try {
		const authRes = await fetch(`${PUBLIC_PB_URL}/api/collections/users/auth-refresh`, {
			method: 'POST',
			headers: {
				Authorization: token,
				'Content-Type': 'application/json'
			}
		});
		if (!authRes.ok) {
			console.warn('[users-roster] auth-refresh failed:', authRes.status);
			return false;
		}
		const authData = await authRes.json();
		return authData?.record?.role === 'admin';
	} catch (e) {
		console.warn('[users-roster] auth-refresh error:', e);
		return false;
	}
}

async function fetchInternalRoster(): Promise<{ items: PbUserRecord[]; totalItems: number } | null> {
	const res = await fetch(`${PUBLIC_PB_URL}/api/internal/users-roster`, {
		headers: { 'X-Internal-Secret': INTERNAL_SECRET }
	});
	if (!res.ok) {
		console.warn('[users-roster] internal roster failed:', res.status, await res.text().catch(() => ''));
		return null;
	}
	const data = await res.json();
	return {
		items: (data.items || []) as PbUserRecord[],
		totalItems: data.totalItems ?? data.items?.length ?? 0
	};
}

/** Fallback: paginate standard PB list with internal secret. */
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
		if (!res.ok) {
			console.warn('[users-roster] internal list page failed:', res.status);
			return items.length ? { items, totalItems: totalItems || items.length } : null;
		}
		const data = await res.json();
		totalPages = data.totalPages ?? 1;
		totalItems = data.totalItems ?? items.length;
		items.push(...(data.items || []));
		page++;
	}

	return { items, totalItems: totalItems || items.length };
}

/** Per-user lookup when roster rows omit email (PB field privacy on some builds). */
async function enrichEmailByPbId(rec: PbUserRecord): Promise<PbUserRecord> {
	if ((rec.email || '').trim()) return rec;

	const filter = `(id='${rec.id}')`;
	const res = await fetch(
		`${PUBLIC_PB_URL}/api/collections/users/records?filter=${encodeURIComponent(filter)}&perPage=1`,
		{ headers: { 'X-Internal-Secret': INTERNAL_SECRET } }
	);
	if (!res.ok) return rec;

	const data = await res.json();
	const item = data.items?.[0];
	if (item?.email) {
		return { ...rec, email: item.email };
	}
	return rec;
}

async function enrichRosterEmails(items: PbUserRecord[]): Promise<PbUserRecord[]> {
	return Promise.all(items.map((rec) => enrichEmailByPbId(rec)));
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

	const items = await enrichRosterEmails(roster.items);
	const withEmail = items.filter((u) => (u.email || '').trim()).length;
	console.log(`[users-roster] Returning ${items.length} users (${withEmail} with email)`);

	return json({
		items,
		totalItems: roster.totalItems
	});
}