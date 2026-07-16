import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import {
	csvToBulkPayload,
	MAX_BULK_JSON_BYTES,
	parseJsonToBulkPayload,
	runBulkDryRun,
	type BulkEntity,
	type BulkPayload
} from '$lib/bulk';

function authHeader(request: Request): string | null {
	return request.headers.get('Authorization');
}

const ENTITIES = new Set<BulkEntity>(['clients', 'jobs', 'invoices']);

function parseEntity(raw: string | null): BulkEntity | undefined {
	if (!raw) return undefined;
	const e = raw.trim().toLowerCase() as BulkEntity;
	return ENTITIES.has(e) ? e : undefined;
}

/**
 * POST /api/admin/bulk
 *
 * Slice 1: dry-run only (validate + report). Commit returns 501.
 *
 * Body options:
 * - application/json: { dryRun?: true, clients?, jobs?, invoices? }
 * - multipart/form-data: file, dryRun?, entity? (required for CSV; optional for full JSON package)
 */
export async function POST({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const contentType = request.headers.get('content-type') || '';

	try {
		let dryRun = true;
		let payload: BulkPayload;

		if (contentType.includes('multipart/form-data')) {
			const form = await request.formData();
			const dryRaw = form.get('dryRun');
			if (dryRaw === 'false' || dryRaw === '0') dryRun = false;

			const entity = parseEntity(
				typeof form.get('entity') === 'string' ? String(form.get('entity')) : null
			);

			const file = form.get('file');
			if (!(file instanceof File)) {
				return json({ error: 'multipart body requires a file field' }, { status: 400 });
			}
			if (file.size > MAX_BULK_JSON_BYTES) {
				return json(
					{ error: `File too large (max ${MAX_BULK_JSON_BYTES} bytes)` },
					{ status: 413 }
				);
			}

			const text = await file.text();
			const name = (file.name || '').toLowerCase();
			const isCsv = name.endsWith('.csv') || file.type.includes('csv');

			if (isCsv) {
				if (!entity) {
					return json(
						{ error: 'CSV uploads require entity=clients|jobs|invoices' },
						{ status: 400 }
					);
				}
				payload = csvToBulkPayload(entity, text);
			} else {
				const parsed = parseJsonToBulkPayload(text, entity);
				if (!parsed.ok) {
					return json({ error: parsed.error }, { status: 400 });
				}
				payload = parsed.payload;
			}
		} else {
			// JSON body
			const buf = await request.arrayBuffer();
			if (buf.byteLength > MAX_BULK_JSON_BYTES) {
				return json(
					{ error: `Body too large (max ${MAX_BULK_JSON_BYTES} bytes)` },
					{ status: 413 }
				);
			}
			const text = new TextDecoder().decode(buf);
			if (!text.trim()) {
				return json({ error: 'Empty body' }, { status: 400 });
			}

			let body: unknown;
			try {
				body = JSON.parse(text);
			} catch {
				return json({ error: 'Invalid JSON' }, { status: 400 });
			}

			if (!body || typeof body !== 'object') {
				return json({ error: 'Body must be a JSON object' }, { status: 400 });
			}

			const o = body as Record<string, unknown>;
			if (o.dryRun === false) dryRun = false;

			// Allow either package shape or { payload: { clients... } }
			if (o.clients || o.jobs || o.invoices) {
				payload = {
					clients: o.clients as unknown[] | undefined,
					jobs: o.jobs as unknown[] | undefined,
					invoices: o.invoices as unknown[] | undefined
				};
			} else if (o.payload && typeof o.payload === 'object') {
				const p = o.payload as BulkPayload;
				payload = {
					clients: p.clients,
					jobs: p.jobs,
					invoices: p.invoices
				};
			} else {
				return json(
					{
						error:
							'Body must include clients, jobs, and/or invoices (or a payload object with those keys)'
					},
					{ status: 400 }
				);
			}
		}

		if (!dryRun) {
			return json(
				{
					error: 'Commit is not implemented yet (slice 1 is dry-run only)',
					commitSupported: false,
					hint: 'Set dryRun: true (default) to validate and preview rows'
				},
				{ status: 501 }
			);
		}

		const result = runBulkDryRun(payload);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Bulk dry-run failed';
		return json({ error: message }, { status: 500 });
	}
}
