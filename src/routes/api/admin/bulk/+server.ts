import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import {
	commitBulk,
	csvToBulkPayload,
	loadClientLookupIndex,
	loadInvoiceLookupIndex,
	loadJobLookupIndex,
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

async function parseRequestBody(
	request: Request
): Promise<{ dryRun: boolean; payload: BulkPayload } | { error: string; status: number }> {
	const contentType = request.headers.get('content-type') || '';
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
			return { error: 'multipart body requires a file field', status: 400 };
		}
		if (file.size > MAX_BULK_JSON_BYTES) {
			return { error: `File too large (max ${MAX_BULK_JSON_BYTES} bytes)`, status: 413 };
		}

		const text = await file.text();
		const name = (file.name || '').toLowerCase();
		const isCsv = name.endsWith('.csv') || file.type.includes('csv');

		if (isCsv) {
			if (!entity) {
				return { error: 'CSV uploads require entity=clients|jobs|invoices', status: 400 };
			}
			payload = csvToBulkPayload(entity, text);
		} else {
			const parsed = parseJsonToBulkPayload(text, entity);
			if (!parsed.ok) {
				return { error: parsed.error, status: 400 };
			}
			payload = parsed.payload;
		}
	} else {
		const buf = await request.arrayBuffer();
		if (buf.byteLength > MAX_BULK_JSON_BYTES) {
			return { error: `Body too large (max ${MAX_BULK_JSON_BYTES} bytes)`, status: 413 };
		}
		const text = new TextDecoder().decode(buf);
		if (!text.trim()) {
			return { error: 'Empty body', status: 400 };
		}

		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			return { error: 'Invalid JSON', status: 400 };
		}

		if (!body || typeof body !== 'object') {
			return { error: 'Body must be a JSON object', status: 400 };
		}

		const o = body as Record<string, unknown>;
		if (o.dryRun === false) dryRun = false;

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
			return {
				error:
					'Body must include clients, jobs, and/or invoices (or a payload object with those keys)',
				status: 400
			};
		}
	}

	return { dryRun, payload };
}

/**
 * POST /api/admin/bulk
 *
 * dryRun true: validate + match existing clients/jobs/invoices.
 * dryRun false: commit clients → jobs → invoices to PocketBase.
 */
export async function POST({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	try {
		const parsed = await parseRequestBody(request);
		if ('error' in parsed) {
			return json({ error: parsed.error }, { status: parsed.status });
		}

		const { dryRun, payload } = parsed;
		const auth = token!;

		if (dryRun) {
			let clientIndex;
			let jobIndex;
			let invoiceIndex;
			const loadErrors: string[] = [];
			try {
				clientIndex = await loadClientLookupIndex(auth);
			} catch (err) {
				loadErrors.push(
					`Client match skipped: ${err instanceof Error ? err.message : 'list failed'}`
				);
			}
			try {
				jobIndex = await loadJobLookupIndex(auth);
			} catch (err) {
				loadErrors.push(
					`Job match skipped: ${err instanceof Error ? err.message : 'list failed'}`
				);
			}
			try {
				invoiceIndex = await loadInvoiceLookupIndex(auth);
			} catch (err) {
				loadErrors.push(
					`Invoice match skipped: ${err instanceof Error ? err.message : 'list failed'}`
				);
			}

			const result = runBulkDryRun(payload, {
				clientIndex,
				jobIndex,
				invoiceIndex
			});
			return json({
				...result,
				payloadErrors: [...result.payloadErrors, ...loadErrors]
			});
		}

		const hasAny =
			(payload.clients?.length ?? 0) +
				(payload.jobs?.length ?? 0) +
				(payload.invoices?.length ?? 0) >
			0;
		if (!hasAny) {
			return json({ error: 'Nothing to commit' }, { status: 400 });
		}

		const result = await commitBulk(auth, payload);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Bulk request failed';
		return json({ error: message }, { status: 500 });
	}
}
