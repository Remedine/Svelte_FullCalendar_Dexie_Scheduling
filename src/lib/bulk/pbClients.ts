/**
 * Server-side PocketBase client lookups + writes for bulk import.
 * Uses the admin's JWT (forwarded Authorization header).
 */
import { PUBLIC_PB_URL } from '$env/static/public';
import { bulkClientToPbPayload, normalizeEmail } from './clientMap';
import type { BulkClient } from './schema';

export type ExistingClient = {
	id: string;
	importKey?: string;
	email?: string;
	name?: string;
};

export type ClientLookupIndex = {
	byImportKey: Map<string, ExistingClient>;
	byEmail: Map<string, ExistingClient>;
};

function pbBase(): string {
	return (PUBLIC_PB_URL || '').replace(/\/$/, '');
}

function authHeaders(authHeader: string): HeadersInit {
	return {
		Authorization: authHeader.trim(),
		'Content-Type': 'application/json'
	};
}

/** Load a compact index of all clients (id, importKey, email) for match decisions. */
export async function loadClientLookupIndex(authHeader: string): Promise<ClientLookupIndex> {
	const byImportKey = new Map<string, ExistingClient>();
	const byEmail = new Map<string, ExistingClient>();
	const base = pbBase();
	if (!base) throw new Error('PUBLIC_PB_URL is not configured');

	let page = 1;
	let totalPages = 1;
	const perPage = 200;

	while (page <= totalPages) {
		const url = new URL(`${base}/api/collections/clients/records`);
		url.searchParams.set('page', String(page));
		url.searchParams.set('perPage', String(perPage));

		const res = await fetch(url.toString(), { headers: authHeaders(authHeader) });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Failed to list clients (${res.status}): ${body.slice(0, 200)}`);
		}
		const data = (await res.json()) as {
			page: number;
			totalPages: number;
			items: Array<{ id: string; importKey?: string; email?: string; name?: string }>;
		};
		totalPages = data.totalPages || 1;

		for (const rec of data.items || []) {
			const existing: ExistingClient = {
				id: rec.id,
				importKey: rec.importKey || undefined,
				email: rec.email || undefined,
				name: rec.name || undefined
			};
			if (existing.importKey) byImportKey.set(existing.importKey, existing);
			const em = normalizeEmail(existing.email);
			if (em) byEmail.set(em, existing);
		}
		page++;
	}

	return { byImportKey, byEmail };
}

export type ClientMatch =
	| { kind: 'create' }
	| { kind: 'update'; existing: ExistingClient }
	| { kind: 'error'; message: string };

/** Resolve create vs update for one validated bulk client against the lookup index. */
export function matchExistingClient(
	client: BulkClient,
	index: ClientLookupIndex
): ClientMatch {
	const byKey = client.externalId ? index.byImportKey.get(client.externalId) : undefined;
	const em = normalizeEmail(client.email);
	const byEm = em ? index.byEmail.get(em) : undefined;

	if (byKey && byEm && byKey.id !== byEm.id) {
		return {
			kind: 'error',
			message: `importKey "${client.externalId}" matches client ${byKey.id} but email matches ${byEm.id}`
		};
	}
	const existing = byKey || byEm;
	if (existing) return { kind: 'update', existing };
	return { kind: 'create' };
}

export async function createPbClient(
	authHeader: string,
	client: BulkClient
): Promise<{ id: string }> {
	const base = pbBase();
	const res = await fetch(`${base}/api/collections/clients/records`, {
		method: 'POST',
		headers: authHeaders(authHeader),
		body: JSON.stringify(bulkClientToPbPayload(client))
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		const detail = err?.message || err?.data || JSON.stringify(err).slice(0, 300);
		throw new Error(`Create client failed (${res.status}): ${detail}`);
	}
	const rec = (await res.json()) as { id: string };
	return { id: rec.id };
}

export async function updatePbClient(
	authHeader: string,
	pbId: string,
	client: BulkClient
): Promise<{ id: string }> {
	const base = pbBase();
	const res = await fetch(`${base}/api/collections/clients/records/${encodeURIComponent(pbId)}`, {
		method: 'PATCH',
		headers: authHeaders(authHeader),
		body: JSON.stringify(bulkClientToPbPayload(client))
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		const detail = err?.message || err?.data || JSON.stringify(err).slice(0, 300);
		throw new Error(`Update client ${pbId} failed (${res.status}): ${detail}`);
	}
	const rec = (await res.json()) as { id: string };
	return { id: rec.id };
}
