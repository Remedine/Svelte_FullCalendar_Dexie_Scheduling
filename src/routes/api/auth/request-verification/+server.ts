import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET, PUBLIC_PB_URL } from '$env/static/private';
import { sendVerificationEmail } from '$lib/server/brevo';

export async function POST({ request }: { request: Request }) {
	const { email } = await request.json();

	if (!email) {
		return json({ error: 'Email is required' }, { status: 400 });
	}

	// Call PB internal route to get the verification link (PB generates the secure token)
	const pbRes = await fetch(`${PUBLIC_PB_URL}/api/internal/request-verification`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': INTERNAL_SECRET
		},
		body: JSON.stringify({ email })
	});

	if (!pbRes.ok) {
		const errText = await pbRes.text();
		console.error('PB internal verification request failed:', errText);
		return json({ error: 'Failed to generate verification link' }, { status: 500 });
	}

	const { link } = await pbRes.json();

	// Send via Brevo API (HTTPS, works on Railway Hobby)
	await sendVerificationEmail(email, link);

	return json({ success: true });
}
