import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendJobAssignmentEmail } from '$lib/server/brevo';
import {
	computeCrewNotificationSendAt,
	isCrewNotificationDue,
	clientPrefersEmailBilling
} from '$lib/notifications/crewSchedule';

type OptionsRecord = {
	crewAssignmentDaysBefore?: number;
	crewAssignmentHour?: number;
	crewNotificationLog?: string[];
};

type JobRecord = {
	id: string;
	title?: string;
	start: string;
	end: string;
	assignedCrew?: string[];
	client: string;
	status?: string;
};

async function fetchOptions(): Promise<OptionsRecord | null> {
	const res = await fetch(`${PUBLIC_PB_URL}/api/collections/options/records?perPage=1`, {
		headers: { 'X-Internal-Secret': INTERNAL_SECRET }
	});
	if (!res.ok) return null;
	const data = await res.json();
	return data.items?.[0] ?? null;
}

async function fetchUpcomingJobs(): Promise<JobRecord[]> {
	const filter = encodeURIComponent(`status != "cancelled"`);
	const res = await fetch(
		`${PUBLIC_PB_URL}/api/collections/jobs/records?perPage=500&filter=${filter}&sort=start`,
		{ headers: { 'X-Internal-Secret': INTERNAL_SECRET } }
	);
	if (!res.ok) return [];
	const data = await res.json();
	return data.items ?? [];
}

async function fetchClient(clientId: string) {
	const filter = encodeURIComponent(`id="${clientId}"`);
	const res = await fetch(
		`${PUBLIC_PB_URL}/api/collections/clients/records?perPage=1&filter=${filter}`,
		{ headers: { 'X-Internal-Secret': INTERNAL_SECRET } }
	);
	if (!res.ok) return null;
	const data = await res.json();
	return data.items?.[0] ?? null;
}

async function fetchUserEmailByName(name: string): Promise<string | null> {
	const filter = encodeURIComponent(`name="${name}" && active=true`);
	const res = await fetch(
		`${PUBLIC_PB_URL}/api/collections/users/records?perPage=1&filter=${filter}`,
		{ headers: { 'X-Internal-Secret': INTERNAL_SECRET } }
	);
	if (!res.ok) return null;
	const data = await res.json();
	return data.items?.[0]?.email ?? null;
}

/** Railway cron: send due crew assignment emails (push remains client-only). */
export async function POST({ request }: { request: Request }) {
	const secret = request.headers.get('X-Internal-Secret') || request.headers.get('x-internal-secret');
	if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const options = await fetchOptions();
	if (!options) {
		return json({ error: 'Options not found' }, { status: 500 });
	}

	const daysBefore = Number(options.crewAssignmentDaysBefore ?? 1);
	const hour = Number(options.crewAssignmentHour ?? 7);
	const log = new Set<string>(options.crewNotificationLog ?? []);
	const jobs = await fetchUpcomingJobs();
	const now = new Date();
	let sent = 0;

	for (const job of jobs) {
		if (!job.assignedCrew?.length) continue;
		const sendAt = computeCrewNotificationSendAt(job.start, daysBefore, hour);
		if (!isCrewNotificationDue(sendAt, now)) continue;

		const client = await fetchClient(job.client);
		if (!clientPrefersEmailBilling(client?.preferredBillingMethod)) continue;

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

			const email = await fetchUserEmailByName(crewName);
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

	if (sent > 0 && options) {
		const optRes = await fetch(`${PUBLIC_PB_URL}/api/collections/options/records?perPage=1`, {
			headers: { 'X-Internal-Secret': INTERNAL_SECRET }
		});
		const optData = await optRes.json();
		const optId = optData.items?.[0]?.id;
		if (optId) {
			await fetch(`${PUBLIC_PB_URL}/api/collections/options/records/${optId}`, {
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					'X-Internal-Secret': INTERNAL_SECRET
				},
				body: JSON.stringify({ crewNotificationLog: [...log] })
			});
		}
	}

	return json({ success: true, sent });
}