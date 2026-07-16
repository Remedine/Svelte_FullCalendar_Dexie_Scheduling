import { bulkPayloadSchema, type BulkPayload } from './schema';

/**
 * Parse JSON text into a BulkPayload.
 * Accepts either a full package `{ clients?, jobs?, invoices? }` or a bare array
 * when `entity` is provided (single-entity file).
 */
export function parseJsonToBulkPayload(
	text: string,
	entity?: 'clients' | 'jobs' | 'invoices'
): { ok: true; payload: BulkPayload } | { ok: false; error: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, error: 'Invalid JSON' };
	}

	if (Array.isArray(raw)) {
		if (!entity) {
			return {
				ok: false,
				error: 'JSON array requires entity=clients|jobs|invoices (or wrap in { clients: [...] })'
			};
		}
		return { ok: true, payload: { [entity]: raw } };
	}

	if (raw && typeof raw === 'object') {
		const parsed = bulkPayloadSchema.safeParse(raw);
		if (!parsed.success) {
			const msg = parsed.error.issues.map((i) => i.message).join('; ') || 'Invalid payload';
			return { ok: false, error: msg };
		}
		return {
			ok: true,
			payload: {
				clients: parsed.data.clients,
				jobs: parsed.data.jobs,
				invoices: parsed.data.invoices
			}
		};
	}

	return { ok: false, error: 'JSON must be an object or array' };
}
