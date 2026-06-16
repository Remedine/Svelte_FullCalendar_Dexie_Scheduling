import { db } from '$lib/db';
import { pb } from '$lib/db/pb';
import { optionsStore } from '$lib/stores/options.svelte';
import {
	ensureNotificationPermission,
	showCrewAssignmentNotification
} from '$lib/notifications/push';

function addedCrewNames(previous: string[], next: string[]): string[] {
	const prev = new Set(previous);
	return next.filter((n) => n.trim() && !prev.has(n));
}

async function findUserByCrewName(crewName: string) {
	const trimmed = crewName.trim();
	const all = await db.users.toArray();
	return all.find((u) => {
		const full = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim();
		return full === trimmed && u.active;
	});
}

/** Notify newly assigned crew via email and/or push per admin options (at least one should be enabled). */
export async function notifyNewCrewAssignments(
	jobId: string,
	previousCrew: string[],
	nextCrew: string[]
): Promise<void> {
	const added = addedCrewNames(previousCrew || [], nextCrew || []);
	if (!added.length || !pb.authStore.isValid) return;

	await optionsStore.load?.();
	const opts = optionsStore.data || {};
	const emailOn = opts.notifyCrewAssignmentEmail !== false;
	const pushOn = opts.notifyCrewAssignmentPush !== false;
	if (!emailOn && !pushOn) return;

	const job = await db.jobs.get(jobId);
	if (!job) return;

	const client = job.clientId ? await db.clients.get(job.clientId) : null;
	const startStr = new Date(job.start).toLocaleString();
	const endStr = new Date(job.end).toLocaleString();
	const address = client
		? `${client.serviceAddressStreet}, ${client.serviceAddressCity}, ${client.serviceAddressState} ${client.serviceAddressZip}`
		: '';
	const mapLink = address
		? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
		: undefined;

	if (pushOn) {
		await ensureNotificationPermission();
	}

	for (const crewName of added) {
		const user = await findUserByCrewName(crewName);
		const coworkers = (nextCrew || []).filter((c) => c !== crewName);

		if (pushOn) {
			showCrewAssignmentNotification(
				'New job assignment',
				`${client?.name || 'Client'} — ${startStr}`,
				`job-assign-${jobId}-${crewName}`
			);
		}

		if (emailOn && user?.email) {
			try {
				await fetch('/api/notifications/job-assignment', {
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
						coworkers
					})
				});
			} catch (err) {
				console.warn('[notify] job assignment email failed for', crewName, err);
			}
		}
	}
}