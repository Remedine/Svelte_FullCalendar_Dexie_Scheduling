import { json } from '@sveltejs/kit';
import { deletePasskey, listPasskeysForUser } from '$lib/server/webauthn';
import { getUserFromAuthHeader } from '$lib/server/pbAuth';

export async function GET({ request }: { request: Request }) {
	const user = await getUserFromAuthHeader(request.headers.get('Authorization'));
	if (!user?.id) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	try {
		const items = await listPasskeysForUser(user.id);
		return json({
			items: items.map((pk) => ({
				credentialId: pk.credentialId,
				deviceName: pk.deviceName || 'Passkey',
				created: (pk as { created?: string }).created
			}))
		});
	} catch (err: any) {
		console.error('[webauthn/credentials GET]', err);
		return json({ error: 'Failed to list passkeys' }, { status: 500 });
	}
}

export async function DELETE({ request }: { request: Request }) {
	const user = await getUserFromAuthHeader(request.headers.get('Authorization'));
	if (!user?.id) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const { credentialId } = await request.json();
	if (!credentialId) {
		return json({ error: 'credentialId is required' }, { status: 400 });
	}

	try {
		const items = await listPasskeysForUser(user.id);
		if (!items.some((pk) => pk.credentialId === credentialId)) {
			return json({ error: 'Passkey not found' }, { status: 404 });
		}
		await deletePasskey(credentialId);
		return json({ success: true });
	} catch (err: any) {
		console.error('[webauthn/credentials DELETE]', err);
		return json({ error: 'Failed to remove passkey' }, { status: 500 });
	}
}