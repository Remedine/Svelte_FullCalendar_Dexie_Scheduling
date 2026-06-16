// Centralized PocketBase jobs realtime — one SSE client, one subscribe call, shared handlers.
// Prevents "Invalid realtime client" 400s from duplicate subscribe()/stale clientId races.
import { pb } from '$lib/db/pb';

export type JobsRealtimeEvent = {
	action: string;
	record?: Record<string, unknown>;
};

type JobsRealtimeHandler = (e: JobsRealtimeEvent) => void | Promise<void>;

let jobsUnsub: (() => void) | null = null;
let connectPromise: Promise<boolean> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<JobsRealtimeHandler>();

/** Tear down SSE transport + jobs subscription (call on logout / before reconnect). */
export function disconnectJobsRealtime(): void {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	if (jobsUnsub) {
		try {
			jobsUnsub();
		} catch {}
		jobsUnsub = null;
	}
	const rt = pb.realtime as { disconnect?: () => void } | undefined;
	if (rt?.disconnect) {
		try {
			rt.disconnect();
		} catch {}
	}
	connectPromise = null;
}

async function connectJobsRealtimeOnce(): Promise<boolean> {
	if (!pb.authStore.isValid) return false;

	// Reset any prior clientId before opening a fresh SSE connection.
	disconnectJobsRealtime();

	// Let PB_CONNECT register a new client id before the subscribe POST hits /api/realtime.
	await new Promise((r) => setTimeout(r, 200));

	try {
		jobsUnsub = await pb.collection('jobs').subscribe('*', async (e) => {
			for (const handler of handlers) {
				try {
					await handler(e as JobsRealtimeEvent);
				} catch (err) {
					console.warn('[realtime] handler error', err);
				}
			}
		});
		console.log('[realtime] jobs subscription active');
		return true;
	} catch (err) {
		console.warn('[realtime] jobs subscribe failed (will retry or fall back to pulls)', err);
		jobsUnsub = null;
		connectPromise = null;
		return false;
	}
}

/** Ensure a single shared jobs realtime connection exists. */
export async function ensureJobsRealtimeConnected(): Promise<boolean> {
	if (!pb.authStore.isValid) return false;
	if (jobsUnsub) return true;
	if (!connectPromise) {
		connectPromise = connectJobsRealtimeOnce();
	}
	return connectPromise;
}

/** Retry connect after login, PB restart, or transient 400. */
export function scheduleJobsRealtimeReconnect(delayMs = 2500): void {
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectPromise = null;
		ensureJobsRealtimeConnected().then((ok) => {
			if (!ok && handlers.size > 0) {
				scheduleJobsRealtimeReconnect(Math.min(delayMs * 2, 30000));
			}
		});
	}, delayMs);
}

/** Register a handler; returns cleanup. Multiple components share one PB subscription. */
export function onJobsRealtime(handler: JobsRealtimeHandler): () => void {
	handlers.add(handler);

	ensureJobsRealtimeConnected().then((ok) => {
		if (!ok) scheduleJobsRealtimeReconnect();
	});

	return () => {
		handlers.delete(handler);
		if (handlers.size === 0) {
			disconnectJobsRealtime();
		}
	};
}