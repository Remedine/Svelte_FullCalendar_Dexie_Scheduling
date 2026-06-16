import { json } from '@sveltejs/kit';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendJobAssignmentEmail } from '$lib/server/brevo';

async function assertAuthenticated(token: string): Promise<boolean> {
	try {
		const res = await fetch(`${PUBLIC_PB_URL}/api/collections/users/auth-refresh`, {
			method: 'POST',
			headers: { Authorization: token, 'Content-Type': 'application/json' }
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!token || !(await assertAuthenticated(token))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	const { email, clientName, start, end, address, phone, mapLink, coworkers } = body;

	if (!email || !clientName) {
		return json({ error: 'email and clientName are required' }, { status: 400 });
	}

	try {
		await sendJobAssignmentEmail(email, {
			clientName,
			start: start || '',
			end: end || '',
			address: address || '',
			phone: phone || '',
			mapLink,
			coworkers: Array.isArray(coworkers) ? coworkers : []
		});
		return json({ success: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[job-assignment] email failed:', message);
		return json({ error: 'Failed to send assignment email', details: message }, { status: 500 });
	}
}