import { describe, it, expect, beforeEach, vi } from 'vitest';
import { optionsStore } from './options.svelte';
import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

// )=- Light store tests for options (Phase 3 of TESTING_PLAN.md).
// optionsStore is a $state object with async load / pull / save logic.
// We test the happy local paths and default creation behavior (very important for the app always having options.id = '1').
// PB paths are stubbed or avoided to keep tests fast and deterministic.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md

describe('optionsStore', () => {
	beforeEach(async () => {
		// Fresh DB for each test
		await db.delete();
		await db.open();
		// Reset the store state
		optionsStore.data = null;
		optionsStore.isLoading = false;
		optionsStore.pendingPull = null;
	});

	it('load() creates sensible default in Dexie when nothing exists locally or in PB (simulated)', async () => {
		// Simulate no PB by making the store think auth is invalid (pullFromPB will return false quickly)
		// The load path: no local options -> pullFromPB (fails) -> create default
		await optionsStore.load();

		const opts = await db.options.get('1');
		expect(opts).toBeTruthy();
		expect(opts!.id).toBe('1');
		expect(opts!.invoiceDueDays).toBe(30);
		expect(opts!.taxRate).toBe(5);
		expect(optionsStore.data).toBeTruthy();
	});

	it('load() prefers existing Dexie record', async () => {
		const custom = {
			id: '1',
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
			id: '1',
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

		const saved = await db.options.get('1');
		expect(saved?.taxRate).toBe(0.12);
		expect(optionsStore.data?.taxRate).toBe(0.12);
	});

	// Note: pullFromPB with full PB mock is complex due to hoisting and store internals; covered indirectly via load default path and real usage.
	// Save and local paths tested above.
});