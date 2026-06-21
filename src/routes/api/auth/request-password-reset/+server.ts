import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendPasswordResetEmail } from '$lib/server/brevo';

export async function POST({ request }: { request: Request }) {
	const { email } = await request.json();

	if (!email) {
		return json({ error: 'Email is required' }, { status: 400 });
	}

	const pbRes = await fetch(`${PUBLIC_PB_URL}/api/internal/request-password-reset`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': INTERNAL_SECRET
		},
		body: JSON.stringify({ email })
	});

	if (!pbRes.ok) {
		const errText = await pbRes.text();
		console.error('PB internal password reset request failed:', errText);
		// Do not reveal whether the email exists (standard forgot-password behavior).
		return json({ success: true });
	}

	const { link } = await pbRes.json();

	try {
		await sendPasswordResetEmail(email, link);
	} catch (err: any) {
		console.error('Failed to send password reset email via Brevo:', err?.message || err);
		return json({ error: 'Failed to send reset email', details: err?.message }, { status: 500 });
	}

	return json({ success: true });
}
