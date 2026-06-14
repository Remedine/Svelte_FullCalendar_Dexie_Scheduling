import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendWelcomeEmail } from '$lib/server/brevo';

export async function POST({ request }: { request: Request }) {
	const { email } = await request.json();

	if (!email) {
		return json({ error: 'Email is required' }, { status: 400 });
	}

	// Request password reset link (this flow also activates the account via server hook on confirm)
	const resetRes = await fetch(`${PUBLIC_PB_URL}/api/internal/request-password-reset`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': INTERNAL_SECRET
		},
		body: JSON.stringify({ email })
	});

	if (!resetRes.ok) {
		const errText = await resetRes.text();
		console.error('PB internal password reset request failed (welcome):', errText);
		return json({ error: 'Failed to generate welcome link' }, { status: 500 });
	}

	const { link: resetLink } = await resetRes.json();

	try {
		await sendWelcomeEmail(email, resetLink);
	} catch (err: any) {
		console.error('Failed to send welcome email via Brevo:', err?.message || err);
		return json({ error: 'Failed to send welcome email', details: err?.message }, { status: 500 });
	}

	return json({ success: true });
}
