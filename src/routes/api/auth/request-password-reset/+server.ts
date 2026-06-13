import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET, PUBLIC_PB_URL } from '$env/static/private';
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
		return json({ error: 'Failed to generate reset link' }, { status: 500 });
	}

	const { link } = await pbRes.json();

	await sendPasswordResetEmail(email, link);

	return json({ success: true });
}
