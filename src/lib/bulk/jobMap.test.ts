import { describe, expect, it } from 'vitest';
import { bulkJobToPbPayload } from './jobMap';
import { matchExistingJob, resolveJobClientPbId, type JobLookupIndex } from './pbJobs';
import type { ClientLookupIndex } from './pbClients';
import { matchExistingInvoice, resolveInvoiceJobPbId, type InvoiceLookupIndex } from './pbInvoices';
import { runBulkDryRun } from './dryRun';
import type { BulkJob } from './schema';

const sampleJob: BulkJob = {
	externalId: 'j1',
	title: 'Clean',
	start: new Date('2026-06-01T09:00:00.000Z'),
	end: new Date('2026-06-01T11:00:00.000Z'),
	status: 'completed',
	assignedCrew: [],
	clientExternalId: 'c1',
	billableItems: [{ title: 'Std', price: 450, quantity: 1, total: 450 }]
};

describe('bulkJobToPbPayload', () => {
	it('sets client relation, importKey, and decimal tax', () => {
		const p = bulkJobToPbPayload(sampleJob, 'pb-client-1', 5);
		expect(p.client).toBe('pb-client-1');
		expect(p.importKey).toBe('j1');
		expect(p.taxRate).toBe(0.05);
		expect(p.subtotal).toBe(450);
	});
});

describe('matchExistingJob', () => {
	const index: JobLookupIndex = {
		byImportKey: new Map([['j1', { id: 'pbj1', importKey: 'j1', client: 'pbc1' }]]),
		byId: new Map([['pbj1', { id: 'pbj1', importKey: 'j1', client: 'pbc1' }]])
	};

	it('updates when importKey exists', () => {
		const m = matchExistingJob(sampleJob, index);
		expect(m.kind).toBe('update');
	});

	it('creates when new', () => {
		const m = matchExistingJob({ ...sampleJob, externalId: 'new' }, index);
		expect(m.kind).toBe('create');
	});
});

describe('resolveJobClientPbId', () => {
	const clients: ClientLookupIndex = {
		byImportKey: new Map([['c1', { id: 'pbc1', importKey: 'c1' }]]),
		byEmail: new Map([['a@b.com', { id: 'pbc2', email: 'a@b.com' }]])
	};

	it('resolves clientExternalId', () => {
		const r = resolveJobClientPbId(sampleJob, clients);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.clientPbId).toBe('pbc1');
	});

	it('fails when missing', () => {
		const r = resolveJobClientPbId({ ...sampleJob, clientExternalId: 'nope' }, clients);
		expect(r.ok).toBe(false);
	});
});

describe('invoice match + job resolve', () => {
	const jobs: JobLookupIndex = {
		byImportKey: new Map([['j1', { id: 'pbj1', importKey: 'j1', client: 'pbc1' }]]),
		byId: new Map([['pbj1', { id: 'pbj1', importKey: 'j1', client: 'pbc1' }]])
	};
	const invIndex: InvoiceLookupIndex = {
		byImportKey: new Map(),
		byInvoiceNumber: new Map([
			['LEG-1', { id: 'pbi1', invoiceNumber: 'LEG-1', job: 'pbj1' }]
		]),
		byId: new Map()
	};

	it('matches invoice by number', () => {
		const m = matchExistingInvoice(
			{
				invoiceNumber: 'LEG-1',
				jobExternalId: 'j1',
				status: 'paid',
				amount: 100
			},
			invIndex
		);
		expect(m.kind).toBe('update');
	});

	it('resolves job from externalId', () => {
		const r = resolveInvoiceJobPbId({ jobExternalId: 'j1', status: 'sent', amount: 1 }, jobs);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.jobPbId).toBe('pbj1');
			expect(r.clientPbId).toBe('pbc1');
		}
	});
});

describe('runBulkDryRun job relations', () => {
	it('errors when clientExternalId missing from payload and index', () => {
		const result = runBulkDryRun({
			jobs: [
				{
					title: 'X',
					start: '2026-01-01T10:00:00.000Z',
					end: '2026-01-01T12:00:00.000Z',
					clientExternalId: 'missing'
				}
			]
		});
		expect(result.summary.jobs.error).toBe(1);
	});

	it('accepts clientExternalId from payload clients', () => {
		const result = runBulkDryRun({
			clients: [
				{
					externalId: 'c1',
					name: 'A',
					serviceAddressStreet: '1',
					serviceAddressCity: 'A',
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
					title: 'X',
					start: '2026-01-01T10:00:00.000Z',
					end: '2026-01-01T12:00:00.000Z',
					clientExternalId: 'c1'
				}
			]
		});
		expect(result.summary.jobs.error).toBe(0);
		expect(result.summary.jobs.valid).toBe(1);
	});
});
