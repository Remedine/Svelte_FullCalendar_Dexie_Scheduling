import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendVerificationEmail } from '$lib/server/brevo';
import { requireAdminOrSelfEmail } from '$lib/server/pbAuth';

/** Authenticated self (or admin): request a verification email for the given address. */
export async function POST({ request }: { request: Request }) {
	const { email } = await request.json();

	if (!email) {
		return json({ error: 'Email is required' }, { status: 400 });
	}

	const caller = await requireAdminOrSelfEmail(request.headers.get('Authorization'), email);
	if (!caller) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

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

	try {
		await sendVerificationEmail(email, link);
	} catch (err: any) {
		console.error('Failed to send verification email via Brevo:', err?.message || err);
		return json(
			{ error: 'Failed to send verification email', details: err?.message },
			{ status: 500 }
		);
	}

	return json({ success: true });
}
