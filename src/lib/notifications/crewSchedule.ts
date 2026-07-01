import { backupDateInAlaska } from '$lib/backups/names';
import { alaskaHourNow } from '$lib/backups/schedule';

export interface CrewNotificationPending {
	id: string;
	jobId: string;
	crewName: string;
	scheduledFor: Date;
	emailSent: boolean;
	createdAt: Date;
}

/** Dedup key stored in Options.crewNotificationLog (server + client). */
export function crewNotificationLogKey(jobId: string, crewName: string): string {
	return `email::${jobId}::${crewName}`;
}

export function crewLogHas(
	log: string[] | undefined,
	jobId: string,
	crewName: string
): boolean {
	if (!Array.isArray(log)) return false;
	return log.includes(crewNotificationLogKey(jobId, crewName));
}

/** Alaska calendar date N days before the job's start date (for notification day). */
export function crewNotificationSendDateAlaska(
	jobStart: Date | string,
	daysBefore: number,
	now = new Date()
): string {
	const anchor = typeof jobStart === 'string' ? new Date(jobStart) : jobStart;
	const jobDate = backupDateInAlaska(anchor);
	const [y, m, d] = jobDate.split('-').map(Number);
	const sendLocal = new Date(y, m - 1, d);
	sendLocal.setDate(sendLocal.getDate() - Math.max(0, daysBefore));
	const year = sendLocal.getFullYear();
	const month = String(sendLocal.getMonth() + 1).padStart(2, '0');
	const day = String(sendLocal.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** True only during the configured hour in America/Anchorage. */
export function isCrewNotificationCronWindow(configuredHour: number, now = new Date()): boolean {
	return alaskaHourNow(now) === configuredHour;
}

/**
 * Whether a crew assignment email should fire now (once on notification day at configured hour).
 * Uses Alaska calendar for notification day; hour gate prevents repeat sends every 30 min.
 */
export function shouldSendCrewNotification(
	jobStart: Date | string,
	daysBefore: number,
	configuredHour: number,
	now = new Date()
): boolean {
	const sendDate = crewNotificationSendDateAlaska(jobStart, daysBefore, now);
	const today = backupDateInAlaska(now);
	if (today < sendDate) return false;
	if (today > sendDate) {
		// Missed day: allow one catch-up send during configured hour only.
		return isCrewNotificationCronWindow(configuredHour, now);
	}
	return isCrewNotificationCronWindow(configuredHour, now);
}

/** @deprecated Use shouldSendCrewNotification — kept for Dexie queue scheduledFor display. */
export function computeCrewNotificationSendAt(
	jobStart: Date | string,
	daysBefore: number,
	hourOfDay: number
): Date {
	const sendDate = crewNotificationSendDateAlaska(jobStart, daysBefore);
	const [y, m, d] = sendDate.split('-').map(Number);
	const sendAt = new Date(y, m - 1, d);
	sendAt.setHours(Math.min(23, Math.max(0, hourOfDay)), 0, 0, 0);
	return sendAt;
}

/** @deprecated Use shouldSendCrewNotification */
export function isCrewNotificationDue(scheduledFor: Date | string, now = new Date()): boolean {
	const at = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor);
	return now.getTime() >= at.getTime();
}

/** Invoice email to client only when the client's preferred billing is email. */
export function clientPrefersEmailBilling(preferredBillingMethod: string | undefined): boolean {
	return preferredBillingMethod === 'email';
}