import { crewNotificationLogKey } from '$lib/notifications/crewSchedule';
import { fetchOptionsRecord, patchOptionsRecord } from '$lib/server/backups';

export async function appendCrewNotificationLog(
	jobId: string,
	crewName: string
): Promise<boolean> {
	const options = await fetchOptionsRecord();
	const log = new Set<string>(
		Array.isArray(options?.crewNotificationLog) ? options.crewNotificationLog : []
	);
	log.add(crewNotificationLogKey(jobId, crewName));
	return patchOptionsRecord({ crewNotificationLog: [...log] });
}