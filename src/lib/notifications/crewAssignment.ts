import { db } from '$lib/db';
import type { Job } from '$lib/db';
import { pb } from '$lib/db/pb';
import { optionsStore } from '$lib/stores/options.svelte';
import {
	type CrewNotificationPending,
	computeCrewNotificationSendAt,
	crewLogHas,
	isCrewNotificationCronWindow,
	shouldSendCrewNotification
} from '$lib/notifications/crewSchedule';

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

/** Queue or reschedule email notifications for assigned crew (does not send immediately). */
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
		if (prev?.emailSent) continue;

		await crewNotificationsDb.put({
			id,
			jobId,
			crewName,
			scheduledFor,
			emailSent: prev?.emailSent ?? false,
			createdAt: prev?.createdAt ?? new Date()
		});
	}
}

/** Process due queued crew assignment emails during configured Alaska hour only. */
export async function processScheduledCrewNotifications(): Promise<number> {
	if (!pb.authStore.isValid || !crewNotificationsDb) return 0;

	await optionsStore.load?.();
	const opts = optionsStore.data || {};
	const daysBefore = Number(opts.crewAssignmentDaysBefore ?? 1);
	const hour = Number(opts.crewAssignmentHour ?? 7);
	const serverLog = Array.isArray(opts.crewNotificationLog) ? opts.crewNotificationLog : [];

	if (!isCrewNotificationCronWindow(hour)) return 0;

	const pending = await crewNotificationsDb.toArray();
	let sent = 0;

	for (const item of pending) {
		if (item.emailSent) continue;

		const job = await db.jobs.get(item.jobId);
		if (!job || job.status === 'cancelled') {
			await crewNotificationsDb.delete(item.id);
			continue;
		}
		if (!(job.assignedCrew || []).includes(item.crewName)) {
			await crewNotificationsDb.delete(item.id);
			continue;
		}
		if (!shouldSendCrewNotification(job.start, daysBefore, hour)) continue;
		if (crewLogHas(serverLog, item.jobId, item.crewName)) {
			await crewNotificationsDb.delete(item.id);
			continue;
		}

		const client = job.clientId ? await db.clients.get(job.clientId) : null;
		const ok = await sendEmailForAssignment(job, item.crewName, client);
		if (ok) {
			const token = pb.authStore.token;
			if (token) {
				await fetch('/api/admin/crew-notifications/mark-sent', {
					method: 'POST',
					headers: {
						Authorization: token,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ jobId: item.jobId, crewName: item.crewName })
				});
			}
			await crewNotificationsDb.delete(item.id);
			sent++;
		}
	}

	return sent;
}

/** @deprecated Use refreshCrewNotificationQueueForJob */
export async function notifyNewCrewAssignments(
	jobId: string,
	_previousCrew: string[],
	_nextCrew: string[]
): Promise<void> {
	await refreshCrewNotificationQueueForJob(jobId);
}