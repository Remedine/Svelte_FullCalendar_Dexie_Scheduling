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
		console.error('[webauthn/login/verify]', err);
		// Generic message — do not reveal whether email/passkey exists
		return json({ error: 'Passkey sign-in failed. Try email and password instead.' }, { status: 401 });
	}
}