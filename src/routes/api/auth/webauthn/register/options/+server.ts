import { json } from '@sveltejs/kit';
import { buildRegistrationOptions } from '$lib/server/webauthn';
import { getUserFromAuthHeader } from '$lib/server/pbAuth';

export async function POST({ request }: { request: Request }) {
	const user = await getUserFromAuthHeader(request.headers.get('Authorization'));
	if (!user?.id || !user.email) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		const result = await buildRegistrationOptions(request, user);
		return json(result);
	} catch (err: any) {
		console.error('[webauthn/register/options]', err);
		return json({ error: err?.message || 'Failed to start passkey registration' }, { status: 500 });
	}
}