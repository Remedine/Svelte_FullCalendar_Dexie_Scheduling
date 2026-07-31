import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendWelcomeEmail } from '$lib/server/brevo';
import { assertAdminFromAuthHeader } from '$lib/server/pbAdmin';

export async function POST({ request }: { request: Request }) {
	// Admin-only: used from Crew Management for create + resend activation email.
	if (!(await assertAdminFromAuthHeader(request.headers.get('Authorization')))) {
		return json({ error: 'Admin access required' }, { status: 401 });
	}

	const body = await request.json().catch(() => ({}));
	const email = String(body?.email || '')
		.trim()
		.toLowerCase();

	if (!email || !email.includes('@')) {
		return json({ error: 'A valid email is required' }, { status: 400 });
	}

	// Request password-reset link (welcome flow also activates via server hook on confirm).
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
		return json(
			{
				error:
					'Could not generate an activation link for that email. Check the address exists in PocketBase.'
			},
			{ status: 500 }
		);
	}

	const { link: resetLink } = await resetRes.json();
	if (!resetLink) {
		return json({ error: 'No activation link returned from server' }, { status: 500 });
	}

	try {
		await sendWelcomeEmail(email, resetLink);
	} catch (err: any) {
		console.error('Failed to send welcome email via Brevo:', err?.message || err);
		return json(
			{ error: 'Failed to send welcome email', details: err?.message },
			{ status: 500 }
		);
	}

	return json({ success: true, email });
}
