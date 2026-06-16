import { db } from '$lib/db';
import type { Job } from '$lib/db';
import { pb } from '$lib/db/pb';
import { optionsStore } from '$lib/stores/options.svelte';
import {
	type CrewNotificationPending,
	computeCrewNotificationSendAt,
	isCrewNotificationDue,
	clientPrefersEmailBilling
} from '$lib/notifications/crewSchedule';
import {
	ensureNotificationPermission,
	showCrewAssignmentNotification
} from '$lib/notifications/push';

const crewNotificationsDb = (
	db as typeof db & {
		crewNotifications: import('dexie').EntityTable<CrewNotificationPending, 'id'>;
	}
).crewNotifications;

async function findUserByCrewName(crewName: string) {
	const trimmed = crewName.trim();
	const all = await db.users.toArray();
	return all.find((u) => {
		const full = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim();
		return full === trimmed && u.active;
	});
}

function queueId(jobId: string, crewName: string): string {
	return `${jobId}::${crewName}`;
}

async function sendEmailForAssignment(
	job: Job,
	crewName: string,
	client: Awaited<ReturnType<typeof db.clients.get>>
): Promise<boolean> {
	const user = await findUserByCrewName(crewName);
	if (!user?.email) return false;

	const startStr = new Date(job.start).toLocaleString();
	const endStr = new Date(job.end).toLocaleString();
	const address = client
		? `${client.serviceAddressStreet}, ${client.serviceAddressCity}, ${client.serviceAddressState} ${client.serviceAddressZip}`
		: '';
	const mapLink = address
		? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
		: undefined;

	const res = await fetch('/api/notifications/job-assignment', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: pb.authStore.token
		},
		body: JSON.stringify({
			email: user.email,
			crewName,
			clientName: client?.name || 'Client',
			start: startStr,
			end: endStr,
			address,
			phone: client?.phone || '',
			mapLink,
			coworkers: (job.assignedCrew || []).filter((c) => c !== crewName)
		})
	});
	return res.ok;
}

async function deliverQueueItem(
	item: CrewNotificationPending,
	job: Job,
	opts: Record<string, unknown>
): Promise<Partial<CrewNotificationPending>> {
	const client = job.clientId ? await db.clients.get(job.clientId) : null;
	const pushOn = opts.notifyCrewAssignmentPush !== false;
	const emailOn = clientPrefersEmailBilling(client?.preferredBillingMethod);

	const patch: Partial<CrewNotificationPending> = {};

	if (pushOn && !item.pushSent) {
		await ensureNotificationPermission();
		showCrewAssignmentNotification(
			'Job assignment reminder',
			`${client?.name || 'Client'} — ${new Date(job.start).toLocaleString()}`,
			`job-assign-${item.jobId}-${item.crewName}`
		);
		patch.pushSent = true;
	}

	if (emailOn && !item.emailSent) {
		const ok = await sendEmailForAssignment(job, item.crewName, client);
		if (ok) patch.emailSent = true;
	}

	return patch;
}

/** Queue or reschedule notifications for all crew on a job (does not send immediately). */
export async function refreshCrewNotificationQueueForJob(jobId: string): Promise<void> {
	if (!crewNotificationsDb) return;

	const job = await db.jobs.get(jobId);
	if (!job || job.status === 'cancelled') {
		await crewNotificationsDb.where('jobId').equals(jobId).delete();
		return;
	}

	await optionsStore.load?.();
	const opts = optionsStore.data || {};
	const daysBefore = Number(opts.crewAssignmentDaysBefore ?? 1);
	const hour = Number(opts.crewAssignmentHour ?? 7);
	const scheduledFor = computeCrewNotificationSendAt(job.start, daysBefore, hour);

	const crewSet = new Set((job.assignedCrew || []).map((c) => c.trim()).filter(Boolean));
	const existing = await crewNotificationsDb.where('jobId').equals(jobId).toArray();

	for (const row of existing) {
		if (!crewSet.has(row.crewName)) {
			await crewNotificationsDb.delete(row.id);
		}
	}

	for (const crewName of crewSet) {
		const id = queueId(jobId, crewName);
		const prev = existing.find((e) => e.id === id);
		const fullySent = prev?.emailSent && prev?.pushSent;
		if (fullySent) continue;

		await crewNotificationsDb.put({
			id,
			jobId,
			crewName,
			scheduledFor,
			emailSent: prev?.emailSent ?? false,
			pushSent: prev?.pushSent ?? false,
			createdAt: prev?.createdAt ?? new Date()
		});
	}
}

/** Process due queued crew notifications (call on app load + interval). */
export async function processScheduledCrewNotifications(): Promise<number> {
	if (!pb.authStore.isValid || !crewNotificationsDb) return 0;

	await optionsStore.load?.();
	const opts = optionsStore.data || {};
	const pending = await crewNotificationsDb.toArray();
	let sent = 0;

	for (const item of pending) {
		if (!isCrewNotificationDue(item.scheduledFor)) continue;

		const job = await db.jobs.get(item.jobId);
		if (!job || job.status === 'cancelled') {
			await crewNotificationsDb.delete(item.id);
			continue;
		}
		if (!(job.assignedCrew || []).includes(item.crewName)) {
			await crewNotificationsDb.delete(item.id);
			continue;
		}

		const client = job.clientId ? await db.clients.get(job.clientId) : null;
		const pushOn = opts.notifyCrewAssignmentPush !== false;
		const emailOn = clientPrefersEmailBilling(client?.preferredBillingMethod);
		const needsEmail = emailOn && !item.emailSent;
		const needsPush = pushOn && !item.pushSent;
		if (!needsEmail && !needsPush) {
			await crewNotificationsDb.delete(item.id);
			continue;
		}

		const patch = await deliverQueueItem(item, job, opts);
		const next = { ...item, ...patch };
		const done =
			(!emailOn || next.emailSent) && (!pushOn || next.pushSent);

		if (done) {
			await crewNotificationsDb.delete(item.id);
		} else {
			await crewNotificationsDb.put(next);
		}
		if (patch.emailSent || patch.pushSent) sent++;
	}

	return sent;
}

/** @deprecated Use refreshCrewNotificationQueueForJob — kept for import sites during transition. */
export async function notifyNewCrewAssignments(
	jobId: string,
	_previousCrew: string[],
	_nextCrew: string[]
): Promise<void> {
	await refreshCrewNotificationQueueForJob(jobId);
}