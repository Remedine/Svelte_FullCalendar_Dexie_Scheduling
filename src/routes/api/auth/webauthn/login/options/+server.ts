import { json } from '@sveltejs/kit';
import { buildAuthenticationOptions } from '$lib/server/webauthn';

export async function POST({ request }: { request: Request }) {
	const { email } = await request.json();
	if (!email?.trim()) {
		return json({ error: 'Email is required' }, { status: 400 });
	}

	try {
		const { options, challengeToken } = await buildAuthenticationOptions(request, email);
		return json({ options, challengeToken });
	} catch (err: any) {
		console.error('[webauthn/login/options]', err);
		return json({ error: err?.message || 'Failed to start passkey login' }, { status: 500 });
	}
}