import 'fake-indexeddb/auto';
import { db } from '$lib/db';
import { beforeEach, afterEach } from 'vitest';

// )=- Global test setup for Phase 0+ of the testing plan.
// - fake-indexeddb/auto polyfills IndexedDB + IDBKeyRange so Dexie works in Node/happy-dom.
// - Every test gets a completely fresh 'CapitalCityWindows' database (delete + open).
//   This guarantees isolation for tests that exercise createJob, getJobsForRange,
//   invoice helpers, sync queue logic, etc.
// - We use beforeEach/afterEach so even tests that don't touch DB are safe.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md

beforeEach(async () => {
	try {
		await db.delete();
	} catch {
		// DB may not exist yet on first run
	}
	await db.open();
});

afterEach(async () => {
	try {
		await db.delete();
	} catch {
		// ignore
	}
});
