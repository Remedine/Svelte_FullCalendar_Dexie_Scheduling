import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendEmailChangeConfirmation } from '$lib/server/brevo';

export async function POST({ request }: { request: Request }) {
	const { email, newEmail } = await request.json();

	if (!email || !newEmail) {
		return json({ error: 'Current email and new email are required' }, { status: 400 });
	}

	const pbRes = await fetch(`${PUBLIC_PB_URL}/api/internal/request-email-change`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': INTERNAL_SECRET
		},
		body: JSON.stringify({ email, newEmail })
	});

	if (!pbRes.ok) {
		const errText = await pbRes.text();
		console.error('PB internal email change request failed:', errText);
		return json({ error: 'Failed to generate email change link' }, { status: 500 });
	}

	const { link } = await pbRes.json();

	try {
		await sendEmailChangeConfirmation(email, link);
	} catch (err: any) {
		console.error('Failed to send email change confirmation via Brevo:', err?.message || err);
		return json({ error: 'Failed to send email change confirmation', details: err?.message }, { status: 500 });
	}

	return json({ success: true });
}
