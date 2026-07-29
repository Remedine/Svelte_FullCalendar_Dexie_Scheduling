import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { optionsStore, optionsTimestampMs, OPTIONS_LOCAL_ID } from './options.svelte';
import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

// )=- Light store tests for options (Phase 3 of TESTING_PLAN.md).
// optionsStore is a $state object with async load / pull / save logic.
// We test the happy local paths, queue, and pull lastUpdated guard.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md

describe('optionsTimestampMs', () => {
	it('parses Date and ISO strings', () => {
		const d = new Date('2026-01-15T12:00:00.000Z');
		expect(optionsTimestampMs(d)).toBe(d.getTime());
		expect(optionsTimestampMs(d.toISOString())).toBe(d.getTime());
		expect(optionsTimestampMs(null)).toBe(0);
		expect(optionsTimestampMs('')).toBe(0);
	});
});

describe('optionsStore', () => {
	beforeEach(async () => {
		// Fresh DB for each test
		await db.delete();
		await db.open();
		// Reset the store state
		optionsStore.data = null;
		optionsStore.isLoading = false;
		optionsStore.pendingPull = null;
		optionsStore.pendingLoad = null;
		vi.stubGlobal('navigator', { onLine: false });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('load() creates sensible default in Dexie when nothing exists locally or in PB (simulated)', async () => {
		// Simulate no PB by making the store think auth is invalid (pullFromPB will return false quickly)
		// The load path: no local options -> pullFromPB (fails) -> create default
		await optionsStore.load();

		const opts = await db.options.get(OPTIONS_LOCAL_ID);
		expect(opts).toBeTruthy();
		expect(opts!.id).toBe(OPTIONS_LOCAL_ID);
		expect(opts!.invoiceDueDays).toBe(30);
		expect(opts!.taxRate).toBe(5);
		expect(optionsStore.data).toBeTruthy();
	});

	it('load() prefers existing Dexie record', async () => {
		const custom = {
			id: OPTIONS_LOCAL_ID,
			taxRate: 0.1,
			defaultJobDurationHours: 3,
			invoiceDueDays: 45,
			areasOfTown: [{ id: 'downtown', label: 'Downtown', color: '#000' }],
			defaultBillableItems: [],
			cancelReasons: [],
			lastUpdated: new Date(),
			updatedBy: 'test'
		};
		await db.options.put(custom);

		await optionsStore.load();

		expect(optionsStore.data?.taxRate).toBe(0.1);
		expect(optionsStore.data?.invoiceDueDays).toBe(45);
	});

	it('saveToDexie persists and updates state', async () => {
		const data = {
			id: OPTIONS_LOCAL_ID,
			taxRate: 0.12,
			defaultJobDurationHours: 1,
			invoiceDueDays: 60,
			areasOfTown: [],
			defaultBillableItems: [],
			cancelReasons: [],
			lastUpdated: new Date(),
			updatedBy: 'test'
		};
		await optionsStore.saveToDexie(data);

		const saved = await db.options.get(OPTIONS_LOCAL_ID);
		expect(saved?.taxRate).toBe(0.12);
		expect(optionsStore.data?.taxRate).toBe(0.12);
	});

	it('saveLocalAndQueue writes Dexie and enqueues a single options update while offline', async () => {
		const data = {
			id: OPTIONS_LOCAL_ID,
			taxRate: 7,
			defaultJobDurationHours: 2,
			invoiceDueDays: 30,
			areasOfTown: [],
			defaultBillableItems: [],
			cancelReasons: [],
			lastUpdated: new Date('2026-06-01T00:00:00.000Z'),
			updatedBy: 'admin'
		};

		await optionsStore.saveLocalAndQueue(data);
		// Second save should coalesce queue to one item
		await optionsStore.saveLocalAndQueue({
			...data,
			taxRate: 8,
			lastUpdated: new Date('2026-06-02T00:00:00.000Z')
		});

		const saved = await db.options.get(OPTIONS_LOCAL_ID);
		expect(saved?.taxRate).toBe(8);

		const queue = await db.syncQueue.where('collection').equals('options').toArray();
		expect(queue).toHaveLength(1);
		expect(queue[0].type).toBe('update');
		expect(queue[0].recordId).toBe(OPTIONS_LOCAL_ID);
		expect(queue[0].data?.taxRate).toBe(8);
	});

	it('pullFromPB keeps newer local options and re-queues when no pending item', async () => {
		const olderServer = new Date('2026-01-01T00:00:00.000Z');
		const newerLocal = new Date('2026-06-15T00:00:00.000Z');

		await db.options.put({
			id: OPTIONS_LOCAL_ID,
			taxRate: 9,
			invoiceDueDays: 14,
			areasOfTown: [],
			defaultBillableItems: [],
			cancelReasons: [],
			lastUpdated: newerLocal,
			updatedBy: 'offline-admin'
		});

		vi.spyOn(pb.authStore, 'isValid', 'get').mockReturnValue(true);
		vi.spyOn(pb.authStore, 'model', 'get').mockReturnValue({ role: 'admin' } as any);
		vi.spyOn(pb, 'collection').mockImplementation(
			() =>
				({
					getFirstListItem: vi.fn().mockResolvedValue({
						id: 'pb-options-1',
						taxRate: 5,
						invoiceDueDays: 30,
						lastUpdated: olderServer.toISOString(),
						updated: olderServer.toISOString(),
						areasOfTown: [],
						defaultBillableItems: [],
						cancelReasons: []
					})
				}) as any
		);

		const ok = await optionsStore.pullFromPB();
		expect(ok).toBe(true);

		const local = await db.options.get(OPTIONS_LOCAL_ID);
		expect(local?.taxRate).toBe(9);
		expect(optionsStore.data?.taxRate).toBe(9);

		const queue = await db.syncQueue.where('collection').equals('options').toArray();
		expect(queue.length).toBeGreaterThanOrEqual(1);
	});

	it('pullFromPB accepts server when local is older and no pending queue', async () => {
		const olderLocal = new Date('2026-01-01T00:00:00.000Z');
		const newerServer = new Date('2026-06-15T00:00:00.000Z');

		await db.options.put({
			id: OPTIONS_LOCAL_ID,
			taxRate: 3,
			invoiceDueDays: 10,
			areasOfTown: [],
			defaultBillableItems: [],
			cancelReasons: [],
			lastUpdated: olderLocal,
			updatedBy: 'stale'
		});

		vi.spyOn(pb.authStore, 'isValid', 'get').mockReturnValue(true);
		vi.spyOn(pb.authStore, 'model', 'get').mockReturnValue({ role: 'admin' } as any);
		vi.spyOn(pb, 'collection').mockImplementation(
			() =>
				({
					getFirstListItem: vi.fn().mockResolvedValue({
						id: 'pb-options-1',
						taxRate: 6.5,
						invoiceDueDays: 45,
						lastUpdated: newerServer.toISOString(),
						updated: newerServer.toISOString(),
						areasOfTown: [{ id: 'a', label: 'A', color: '#000' }],
						defaultBillableItems: [],
						cancelReasons: []
					})
				}) as any
		);

		const ok = await optionsStore.pullFromPB();
		expect(ok).toBe(true);

		const local = await db.options.get(OPTIONS_LOCAL_ID);
		expect(local?.taxRate).toBe(6.5);
		expect(local?.invoiceDueDays).toBe(45);
		expect(optionsStore.data?.taxRate).toBe(6.5);
	});
});
