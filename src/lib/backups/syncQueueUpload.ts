import { db } from '$lib/db';
import { pb } from '$lib/db/pb';

let lastUploadAt = 0;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/** Upload local Dexie sync queue to server for the next backup bundle (admin only). */
export async function uploadSyncQueueSnapshotIfDue(force = false): Promise<void> {
	if (!pb?.authStore?.isValid || pb.authStore.model?.role !== 'admin') return;
	if (!navigator.onLine) return;

	const now = Date.now();
	if (!force && now - lastUploadAt < MIN_INTERVAL_MS) return;

	try {
		const items = await db.syncQueue.orderBy('createdAt').toArray();
		const token = pb.authStore.token;
		if (!token) return;

		const res = await fetch('/api/admin/backups/sync-queue', {
			method: 'POST',
			headers: {
				Authorization: token,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ items })
		});

		if (res.ok) {
			lastUploadAt = now;
		}
	} catch (err) {
		console.warn('[backup] sync queue upload failed:', err);
	}
}