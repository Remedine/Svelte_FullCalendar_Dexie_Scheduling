import { describe, expect, it } from 'vitest';
import { runBulkDryRun } from './dryRun';
import { csvToBulkPayload, parseCsvText, normalizeHeader } from './parseCsv';
import { parseJsonToBulkPayload } from './parseJson';
import {
	FULL_PACKAGE_JSON_TEMPLATE,
	CLIENTS_CSV_TEMPLATE,
	JOBS_CSV_TEMPLATE
} from './templates';
import { bulkClientSchema, bulkJobSchema } from './schema';

describe('normalizeHeader', () => {
	it('maps spaced headers to camelCase', () => {
		expect(normalizeHeader('Service Address Street')).toBe('serviceAddressStreet');
		expect(normalizeHeader('external_id')).toBe('externalId');
	});

	it('keeps camelCase tokens', () => {
		expect(normalizeHeader('externalId')).toBe('externalId');
	});
});

describe('parseCsvText', () => {
	it('parses quoted commas and headers', () => {
		const rows = parseCsvText('name,city\n"Smith, Jane",Anchorage\n');
		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe('Smith, Jane');
		expect(rows[0].city).toBe('Anchorage');
	});

	it('parses clients template', () => {
		const payload = csvToBulkPayload('clients', CLIENTS_CSV_TEMPLATE);
		expect(payload.clients).toHaveLength(1);
		const parsed = bulkClientSchema.safeParse(payload.clients![0]);
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.externalId).toBe('demo-client-1');
			expect(parsed.data.name).toBe('Jane Example');
		}
	});

	it('parses jobs CSV with billableItems JSON column', () => {
		const clients = csvToBulkPayload('clients', CLIENTS_CSV_TEMPLATE);
		const jobs = csvToBulkPayload('jobs', JOBS_CSV_TEMPLATE);
		const result = runBulkDryRun({
			clients: clients.clients,
			jobs: jobs.jobs
		});
		expect(result.summary.totalError).toBe(0);
		expect(result.summary.jobs.valid).toBe(1);
	});
});

describe('parseJsonToBulkPayload', () => {
	it('parses full package template', () => {
		const parsed = parseJsonToBulkPayload(FULL_PACKAGE_JSON_TEMPLATE);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.payload.clients).toHaveLength(1);
			expect(parsed.payload.jobs).toHaveLength(1);
			expect(parsed.payload.invoices).toHaveLength(1);
		}
	});

	it('accepts bare array with entity', () => {
		const parsed = parseJsonToBulkPayload('[{"name":"A"}]', 'clients');
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.payload.clients).toHaveLength(1);
	});

	it('rejects bare array without entity', () => {
		const parsed = parseJsonToBulkPayload('[]');
		expect(parsed.ok).toBe(false);
	});

	it('rejects invalid JSON', () => {
		const parsed = parseJsonToBulkPayload('{');
		expect(parsed.ok).toBe(false);
	});
});

describe('runBulkDryRun', () => {
	it('reports would_create for valid full package', () => {
		const parsed = parseJsonToBulkPayload(FULL_PACKAGE_JSON_TEMPLATE);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;

		const result = runBulkDryRun(parsed.payload);
		expect(result.dryRun).toBe(true);
		expect(result.commitSupported.clients).toBe(true);
		expect(result.commitSupported.jobs).toBe(false);
		expect(result.summary.totalValid).toBe(3);
		expect(result.summary.totalError).toBe(0);
		expect(result.rows.every((r) => r.action === 'would_create')).toBe(true);
	});

	it('flags missing client fields', () => {
		const result = runBulkDryRun({
			clients: [{ name: 'Only name' }]
		});
		expect(result.summary.clients.error).toBe(1);
		expect(result.rows[0].action).toBe('error');
		expect(result.rows[0].errors?.length).toBeGreaterThan(0);
	});

	it('flags job without client ref', () => {
		const result = runBulkDryRun({
			jobs: [
				{
					title: 'No client',
					start: '2026-01-01T10:00:00.000Z',
					end: '2026-01-01T12:00:00.000Z'
				}
			]
		});
		expect(result.summary.jobs.error).toBe(1);
		expect(result.rows[0].errors?.some((e) => e.includes('clientExternalId'))).toBe(true);
	});

	it('flags job clientExternalId missing from payload clients', () => {
		const result = runBulkDryRun({
			clients: [
				{
					externalId: 'c1',
					name: 'A',
					serviceAddressStreet: '1 St',
					serviceAddressCity: 'Anchorage',
					serviceAddressState: 'AK',
					serviceAddressZip: '99501',
					areaOfTown: 'Downtown',
					preferredBillingMethod: 'email',
					phone: '',
					email: ''
				}
			],
			jobs: [
				{
					title: 'Job',
					start: '2026-01-01T10:00:00.000Z',
					end: '2026-01-01T12:00:00.000Z',
					clientExternalId: 'missing'
				}
			]
		});
		expect(result.summary.jobs.error).toBe(1);
		expect(result.rows.find((r) => r.entity === 'jobs')?.errors?.[0]).toMatch(/not found/);
	});

	it('flags duplicate externalIds', () => {
		const client = {
			externalId: 'dup',
			name: 'A',
			serviceAddressStreet: '1 St',
			serviceAddressCity: 'Anchorage',
			serviceAddressState: 'AK',
			serviceAddressZip: '99501',
			areaOfTown: 'Downtown',
			preferredBillingMethod: 'email' as const,
			phone: '',
			email: ''
		};
		const result = runBulkDryRun({ clients: [client, { ...client, name: 'B' }] });
		expect(result.summary.clients.error).toBe(1);
		expect(result.summary.clients.valid).toBe(1);
	});

	it('accepts valid job schema dates', () => {
		const parsed = bulkJobSchema.safeParse({
			title: 'T',
			start: '2026-06-01T09:00:00.000Z',
			end: '2026-06-01T11:00:00.000Z',
			clientExternalId: 'c1'
		});
		expect(parsed.success).toBe(true);
	});
});
