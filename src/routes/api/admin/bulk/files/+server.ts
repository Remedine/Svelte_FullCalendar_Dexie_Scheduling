import { json } from '@sveltejs/kit';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';
import {
	commitFileAttachments,
	loadInvoiceFileTargets,
	planFileAttachments,
	type BulkFileInput
} from '$lib/bulk';

const MAX_FILES = 100;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

function authHeader(request: Request): string | null {
	return request.headers.get('Authorization');
}

/**
 * POST /api/admin/bulk/files
 *
 * Multipart:
 * - files: one or more files (field name "files" or "file")
 * - dryRun: "true" | "false" (default true)
 * - treatDocxAsPrimary: "true" | "false" (default true)
 * - mapping: optional JSON object { "filename.pdf": "CCW-2026-0001" }
 */
export async function POST({ request }: { request: Request }) {
	const token = authHeader(request);
	if (!(await assertAdminFromAuthHeader(token))) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	try {
		const contentType = request.headers.get('content-type') || '';
		if (!contentType.includes('multipart/form-data')) {
			return json({ error: 'Expected multipart/form-data' }, { status: 400 });
		}

		const form = await request.formData();
		const dryRaw = form.get('dryRun');
		const dryRun = !(dryRaw === 'false' || dryRaw === '0');
		const treatDocxAsPrimary = !(
			form.get('treatDocxAsPrimary') === 'false' || form.get('treatDocxAsPrimary') === '0'
		);

		let mapping: Record<string, string> | undefined;
		const mapRaw = form.get('mapping');
		if (typeof mapRaw === 'string' && mapRaw.trim()) {
			try {
				const parsed = JSON.parse(mapRaw) as unknown;
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					return json({ error: 'mapping must be a JSON object' }, { status: 400 });
				}
				mapping = parsed as Record<string, string>;
			} catch {
				return json({ error: 'mapping is not valid JSON' }, { status: 400 });
			}
		}

		const files: BulkFileInput[] = [];
		let totalBytes = 0;

		for (const [key, value] of form.entries()) {
			if (key !== 'files' && key !== 'file') continue;
			if (!(value instanceof File)) continue;
			if (!value.name || value.size === 0) continue;
			if (value.size > MAX_FILE_BYTES) {
				return json(
					{
						error: `File ${value.name} exceeds ${MAX_FILE_BYTES} bytes limit`
					},
					{ status: 413 }
				);
			}
			totalBytes += value.size;
			if (totalBytes > MAX_TOTAL_BYTES) {
				return json({ error: `Total upload exceeds ${MAX_TOTAL_BYTES} bytes` }, { status: 413 });
			}
			files.push({
				filename: value.name,
				blob: value,
				type: value.type || undefined
			});
		}

		if (!files.length) {
			return json({ error: 'No files provided (use field name files or file)' }, { status: 400 });
		}
		if (files.length > MAX_FILES) {
			return json({ error: `Too many files (max ${MAX_FILES})` }, { status: 400 });
		}

		const auth = token!;

		if (dryRun) {
			const invoices = await loadInvoiceFileTargets(auth);
			const result = planFileAttachments(files, invoices, {
				mapping,
				treatDocxAsPrimary
			});
			return json(result);
		}

		const result = await commitFileAttachments(auth, files, {
			mapping,
			treatDocxAsPrimary
		});
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'File attach failed';
		return json({ error: message }, { status: 500 });
	}
}
