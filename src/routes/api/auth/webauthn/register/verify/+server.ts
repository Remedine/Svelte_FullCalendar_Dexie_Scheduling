import { json } from '@sveltejs/kit';
import { verifyRegistration } from '$lib/server/webauthn';
import { getUserFromAuthHeader } from '$lib/server/pbAuth';

export async function POST({ request }: { request: Request }) {
	const user = await getUserFromAuthHeader(request.headers.get('Authorization'));
	if (!user?.id) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const { response, challengeToken, deviceName } = await request.json();
	if (!response || !challengeToken) {
		return json({ error: 'response and challengeToken are required' }, { status: 400 });
	}

	try {
		await verifyRegistration(request, response, challengeToken, deviceName);
		return json({ success: true });
	} catch (err: any) {
		console.error('[webauthn/register/verify]', err);
		return json({ error: err?.message || 'Passkey registration failed' }, { status: 400 });
	}
}