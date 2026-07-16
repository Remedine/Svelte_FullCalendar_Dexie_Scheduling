import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';
import { getUserFromAuthHeader, requireAdminFromAuthHeader } from '$lib/server/pbAuth';

/**
 * Mark a user verified:true on PocketBase (elevated internal patch).
 * AuthZ:
 * - Admin may mark any user (by pbId/email).
 * - Non-admin may only mark themselves (after WelcomeModal password set).
 */
export async function POST({ request }: { request: Request }) {
	const authHeader = request.headers.get('Authorization');
	const caller = await getUserFromAuthHeader(authHeader);
	if (!caller || caller.active === false) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { pbId, email: rawEmail } = await request.json();
	const email = (rawEmail || '').trim().toLowerCase();

	if (!pbId && !email) {
		return json({ error: 'pbId or email is required' }, { status: 400 });
	}

	const isAdmin = caller.role === 'admin';
	let targetId = pbId as string | undefined;

	// Prefer resolving by email using the internal secret (emails are unique and more stable than cached pbIds).
	if (email) {
		try {
			const filter = `(email='${encodeURIComponent(email)}')`;
			const listRes = await fetch(
				`${PUBLIC_PB_URL}/api/collections/users/records?filter=${filter}&perPage=1`,
				{
					headers: {
						'X-Internal-Secret': INTERNAL_SECRET
					}
				}
			);
			if (listRes.ok) {
				const data = await listRes.json();
				if (data.items?.length) {
					targetId = data.items[0].id;
				}
			}
		} catch (e) {
			console.warn('[mark-verified] Failed to resolve by email via internal:', e);
		}
	}

	if (!targetId && pbId) {
		targetId = pbId;
	}

	if (!targetId) {
		return json({ error: 'Unable to resolve user record' }, { status: 400 });
	}

	// Non-admins may only mark their own PB record.
	if (!isAdmin) {
		const callerEmail = (caller.email || '').trim().toLowerCase();
		const targetsSelfById = targetId === caller.id;
		const targetsSelfByEmail = !!email && !!callerEmail && email === callerEmail;
		if (!targetsSelfById && !targetsSelfByEmail) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	} else {
		// Double-check admin still valid (active) via shared helper for consistency.
		const admin = await requireAdminFromAuthHeader(authHeader);
		if (!admin) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	try {
		const updateRes = await fetch(`${PUBLIC_PB_URL}/api/collections/users/records/${targetId}`, {
			method: 'PATCH',
			headers: {
				'Content-Type': 'application/json',
				'X-Internal-Secret': INTERNAL_SECRET
			},
			body: JSON.stringify({
				verified: true,
				updatedAt: new Date().toISOString()
			})
		});

		if (!updateRes.ok) {
			const errText = await updateRes.text();
			console.error('[mark-verified] Internal update failed:', errText);
			return json({
				success: true,
				pbUpdated: false,
				warning: 'Server could not update PB verified flag'
			});
		}

		return json({ success: true, pbUpdated: true });
	} catch (err: any) {
		console.error('[mark-verified] Unexpected error:', err);
		return json({ success: true, pbUpdated: false, warning: err?.message });
	}
}
