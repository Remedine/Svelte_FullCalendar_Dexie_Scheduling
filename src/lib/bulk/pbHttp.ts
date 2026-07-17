import { PUBLIC_PB_URL } from '$env/static/public';

export function pbBase(): string {
	return (PUBLIC_PB_URL || '').replace(/\/$/, '');
}

export function authHeaders(authHeader: string): HeadersInit {
	return {
		Authorization: authHeader.trim(),
		'Content-Type': 'application/json'
	};
}

/** Paginate a PB collection into a list of records. */
export async function listAllRecords(
	authHeader: string,
	collection: string
): Promise<Record<string, unknown>[]> {
	const base = pbBase();
	if (!base) throw new Error('PUBLIC_PB_URL is not configured');

	const items: Record<string, unknown>[] = [];
	let page = 1;
	let totalPages = 1;
	const perPage = 200;

	while (page <= totalPages) {
		const url = new URL(`${base}/api/collections/${collection}/records`);
		url.searchParams.set('page', String(page));
		url.searchParams.set('perPage', String(perPage));

		const res = await fetch(url.toString(), { headers: authHeaders(authHeader) });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Failed to list ${collection} (${res.status}): ${body.slice(0, 200)}`);
		}
		const data = (await res.json()) as {
			totalPages: number;
			items: Record<string, unknown>[];
		};
		totalPages = data.totalPages || 1;
		items.push(...(data.items || []));
		page++;
	}
	return items;
}

export async function pbCreate(
	authHeader: string,
	collection: string,
	body: Record<string, unknown>
): Promise<{ id: string }> {
	const base = pbBase();
	const res = await fetch(`${base}/api/collections/${collection}/records`, {
		method: 'POST',
		headers: authHeaders(authHeader),
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		const detail = err?.message || err?.data || JSON.stringify(err).slice(0, 300);
		throw new Error(`Create ${collection} failed (${res.status}): ${detail}`);
	}
	return (await res.json()) as { id: string };
}

export async function pbUpdate(
	authHeader: string,
	collection: string,
	id: string,
	body: Record<string, unknown>
): Promise<{ id: string }> {
	const base = pbBase();
	const res = await fetch(
		`${base}/api/collections/${collection}/records/${encodeURIComponent(id)}`,
		{
			method: 'PATCH',
			headers: authHeaders(authHeader),
			body: JSON.stringify(body)
		}
	);
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		const detail = err?.message || err?.data || JSON.stringify(err).slice(0, 300);
		throw new Error(`Update ${collection} ${id} failed (${res.status}): ${detail}`);
	}
	return (await res.json()) as { id: string };
}
