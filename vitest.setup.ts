import { vi } from 'vitest';

// )=- Mock SvelteKit env modules before any app code imports pb.ts (which throws without PUBLIC_POCKETBASE_URL).
// Reference: TESTING_PLAN.md Phase 0 + Remedine/Svelte_FullCalendar_Dexie_Scheduling
vi.mock('$env/static/public', () => ({
	PUBLIC_POCKETBASE_URL: 'http://127.0.0.1:8090',
	PUBLIC_PB_URL: 'http://127.0.0.1:8090'
}));

vi.mock('$env/static/private', () => ({
	INTERNAL_SECRET: 'test-internal-secret'
}));

import 'fake-indexeddb/auto';
import { db } from '$lib/db';
import { beforeEach, afterEach } from 'vitest';

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