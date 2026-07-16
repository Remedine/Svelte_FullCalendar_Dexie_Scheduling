import { describe, expect, it } from 'vitest';
import { bulkClientToPbPayload, normalizeEmail } from './clientMap';
import { matchExistingClient, type ClientLookupIndex } from './pbClients';
import { runBulkDryRun } from './dryRun';
import type { BulkClient } from './schema';

const sampleClient: BulkClient = {
	externalId: 'ext-1',
	name: 'Jane',
	serviceAddressStreet: '1 St',
	serviceAddressCity: 'Anchorage',
	serviceAddressState: 'AK',
	serviceAddressZip: '99501',
	areaOfTown: 'Downtown',
	preferredBillingMethod: 'email',
	phone: '907',
	email: 'jane@example.com'
};

describe('bulkClientToPbPayload', () => {
	it('maps externalId to importKey and defaults importSource', () => {
		const p = bulkClientToPbPayload(sampleClient);
		expect(p.importKey).toBe('ext-1');
		expect(p.importSource).toBe('bulk-upload');
		expect(p.name).toBe('Jane');
		expect(p.email).toBe('jane@example.com');
	});
});

describe('matchExistingClient', () => {
	const index: ClientLookupIndex = {
		byImportKey: new Map([
			['ext-1', { id: 'pb1', importKey: 'ext-1', email: 'jane@example.com', name: 'Jane' }]
		]),
		byEmail: new Map([
			['jane@example.com', { id: 'pb1', importKey: 'ext-1', email: 'jane@example.com', name: 'Jane' }],
			['other@example.com', { id: 'pb2', email: 'other@example.com', name: 'Other' }]
		])
	};

	it('matches by importKey for update', () => {
		const m = matchExistingClient(sampleClient, index);
		expect(m.kind).toBe('update');
		if (m.kind === 'update') expect(m.existing.id).toBe('pb1');
	});

	it('matches by email when no externalId', () => {
		const m = matchExistingClient({ ...sampleClient, externalId: undefined }, index);
		expect(m.kind).toBe('update');
	});

	it('creates when no match', () => {
		const m = matchExistingClient(
			{ ...sampleClient, externalId: 'new', email: 'new@example.com' },
			index
		);
		expect(m.kind).toBe('create');
	});

	it('errors when key and email point at different records', () => {
		const m = matchExistingClient(
			{ ...sampleClient, externalId: 'ext-1', email: 'other@example.com' },
			index
		);
		expect(m.kind).toBe('error');
	});
});

describe('runBulkDryRun with clientIndex', () => {
	it('marks would_update when importKey exists', () => {
		const index: ClientLookupIndex = {
			byImportKey: new Map([['ext-1', { id: 'pb1', importKey: 'ext-1' }]]),
			byEmail: new Map()
		};
		const result = runBulkDryRun(
			{
				clients: [
					{
						externalId: 'ext-1',
						name: 'Jane',
						serviceAddressStreet: '1 St',
						serviceAddressCity: 'Anchorage',
						serviceAddressState: 'AK',
						serviceAddressZip: '99501',
						areaOfTown: 'Downtown',
						preferredBillingMethod: 'email',
						phone: '',
						email: ''
					}
				]
			},
			{ clientIndex: index }
		);
		expect(result.rows[0].action).toBe('would_update');
		expect(result.rows[0].pbId).toBe('pb1');
		expect(result.summary.clients.wouldUpdate).toBe(1);
		expect(result.commitSupported.clients).toBe(true);
	});
});

describe('normalizeEmail', () => {
	it('trims and lowercases', () => {
		expect(normalizeEmail('  A@B.Com ')).toBe('a@b.com');
	});
});
