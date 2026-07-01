import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { computeCrewNotificationSendAt, isCrewNotificationDue } from '$lib/notifications/crewSchedule';
import { fetchOptionsRecord, patchOptionsRecord } from '$lib/server/backups';
import { sendJobAssignmentEmail } from '$lib/server/brevo';

type JobRecord = {
	id: string;
	title?: string;
	start: string;
	end: string;
	assignedCrew?: string[];
	client: string;
	status?: string;
};

type UserRosterItem = {
	name?: string;
	firstName?: string;
	lastName?: string;
	email?: string;
	active?: boolean;
};

async function internalFetch(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${PUBLIC_PB_URL}${path}`, {
		...init,
		headers: {
			'X-Internal-Secret': INTERNAL_SECRET,
			...(init?.headers || {})
		}
	});
}

async function fetchUpcomingJobs(): Promise<JobRecord[]> {
	const res = await internalFetch('/api/internal/jobs/upcoming');
	if (!res.ok) return [];
	const data = await res.json();
	return (data.items || []) as JobRecord[];
}

async function fetchClient(clientId: string) {
	const res = await internalFetch(
		`/api/internal/clients/record?id=${encodeURIComponent(clientId)}`
	);
	if (!res.ok) return null;
	return (await res.json()) as {
		name?: string;
		phone?: string;
		serviceAddressStreet?: string;
		serviceAddressCity?: string;
		serviceAddressState?: string;
		serviceAddressZip?: string;
	};
}

async function fetchUserEmailByName(
	name: string,
	roster: UserRosterItem[]
): Promise<string | null> {
	const trimmed = name.trim();
	const user = roster.find((u) => {
		if (!u.active) return false;
		const full = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim();
		return full === trimmed;
	});
	return user?.email ?? null;
}

/** Railway cron: send due crew assignment emails to assigned crew members. */
export async function POST({ request }: { request: Request }) {
	const secret = request.headers.get('X-Internal-Secret') || request.headers.get('x-internal-secret');
	if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const options = await fetchOptionsRecord();
	if (!options) {
		return json({ error: 'Options not found' }, { status: 500 });
	}

	const daysBefore = Number(options.crewAssignmentDaysBefore ?? 1);
	const hour = Number(options.crewAssignmentHour ?? 7);
	const log = new Set<string>(
		Array.isArray(options.crewNotificationLog) ? options.crewNotificationLog : []
	);

	const rosterRes = await internalFetch('/api/internal/users-roster');
	const rosterData = rosterRes.ok ? await rosterRes.json() : { items: [] };
	const roster = (rosterData.items || []) as UserRosterItem[];

	const jobs = await fetchUpcomingJobs();
	const now = new Date();
	let sent = 0;

	for (const job of jobs) {
		if (!job.assignedCrew?.length) continue;
		const sendAt = computeCrewNotificationSendAt(job.start, daysBefore, hour);
		if (!isCrewNotificationDue(sendAt, now)) continue;

		const client = await fetchClient(job.client);

		const startStr = new Date(job.start).toLocaleString();
		const endStr = new Date(job.end).toLocaleString();
		const address = client
			? `${client.serviceAddressStreet || ''}, ${client.serviceAddressCity || ''}, ${client.serviceAddressState || ''} ${client.serviceAddressZip || ''}`
			: '';
		const mapLink = address.trim()
			? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
			: undefined;

		for (const crewName of job.assignedCrew) {
			const logKey = `email::${job.id}::${crewName}`;
			if (log.has(logKey)) continue;

			const email = await fetchUserEmailByName(crewName, roster);
			if (!email) continue;

			try {
				await sendJobAssignmentEmail(email, {
					clientName: client?.name || 'Client',
					start: startStr,
					end: endStr,
					address,
					phone: client?.phone || '',
					mapLink,
					coworkers: job.assignedCrew.filter((c) => c !== crewName)
				});
				log.add(logKey);
				sent++;
			} catch (err) {
				console.error('[cron] crew email failed', job.id, crewName, err);
			}
		}
	}

	if (sent > 0) {
		await patchOptionsRecord({ crewNotificationLog: [...log] });
	}

	return json({ success: true, sent });
}