import { json } from '@sveltejs/kit';
import { fetchOptionsRecord } from '$lib/server/backups';

/** Public read of the global auth epoch (used to force app logout after backup restore). */
export async function GET() {
	try {
		const options = await fetchOptionsRecord();
		const authEpoch = Number(options?.authEpoch ?? 0);
		return json({
			authEpoch: Number.isFinite(authEpoch) && authEpoch >= 0 ? authEpoch : 0
		});
	} catch {
		return json({ authEpoch: 0 });
	}
}