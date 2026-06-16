export interface CrewNotificationPending {
	id: string;
	jobId: string;
	crewName: string;
	scheduledFor: Date;
	emailSent: boolean;
	pushSent: boolean;
	createdAt: Date;
}

/** Compute when crew assignment notifications should fire (local timezone). */
export function computeCrewNotificationSendAt(
	jobStart: Date | string,
	daysBefore: number,
	hourOfDay: number
): Date {
	const start = jobStart instanceof Date ? new Date(jobStart) : new Date(jobStart);
	const sendAt = new Date(start);
	sendAt.setDate(sendAt.getDate() - Math.max(0, daysBefore));
	sendAt.setHours(Math.min(23, Math.max(0, hourOfDay)), 0, 0, 0);
	return sendAt;
}

export function isCrewNotificationDue(scheduledFor: Date | string, now = new Date()): boolean {
	const at = scheduledFor instanceof Date ? scheduledFor : new Date(scheduledFor);
	return now.getTime() >= at.getTime();
}

/** Email (crew assignments, invoices) only when the client's preferred billing is email. */
export function clientPrefersEmailBilling(preferredBillingMethod: string | undefined): boolean {
	return preferredBillingMethod === 'email';
}