import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendEmailChangeConfirmation } from '$lib/server/brevo';
import { requireAdminOrSelfEmail } from '$lib/server/pbAuth';

/**
 * Request an email-change confirmation link.
 * Caller must be authenticated as the current email owner (or an admin).
 */
export async function POST({ request }: { request: Request }) {
	const { email, newEmail } = await request.json();

	if (!email || !newEmail) {
		return json({ error: 'Current email and new email are required' }, { status: 400 });
	}

	const caller = await requireAdminOrSelfEmail(request.headers.get('Authorization'), email);
	if (!caller) {
		return json({ error: 'Unauthorized' }, { status: 401 });
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
		// Confirm to the *current* inbox (proof of control of existing account).
		await sendEmailChangeConfirmation(email, link);
	} catch (err: any) {
		console.error('Failed to send email change confirmation via Brevo:', err?.message || err);
		return json(
			{ error: 'Failed to send email change confirmation', details: err?.message },
			{ status: 500 }
		);
	}

	return json({ success: true });
}
