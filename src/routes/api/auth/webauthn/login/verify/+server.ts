import { json } from '@sveltejs/kit';
import { issueAuthTokenForUser, verifyAuthentication } from '$lib/server/webauthn';

export async function POST({ request }: { request: Request }) {
	const { response, challengeToken, email } = await request.json();
	if (!response || !challengeToken || !email?.trim()) {
		return json({ error: 'email, response, and challengeToken are required' }, { status: 400 });
	}

	try {
		const { userId } = await verifyAuthentication(request, response, challengeToken);
		const auth = await issueAuthTokenForUser(userId);
		return json({ token: auth.token, record: auth.record });
	} catch (err: any) {
		const message = err?.message || String(err);
		console.error('[webauthn/login/verify]', message);
		const hint =
			message.includes('Unknown passkey') || message.includes('not found')
				? 'No passkey found for this account. Sign in with email, then add a passkey in Profile.'
				: 'Passkey sign-in failed. Try email and password instead.';
		return json({ error: hint }, { status: 401 });
	}
}