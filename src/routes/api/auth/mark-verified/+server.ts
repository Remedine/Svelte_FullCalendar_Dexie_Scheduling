import { json } from '@sveltejs/kit';
import { INTERNAL_SECRET } from '$env/static/private';
import { PUBLIC_PB_URL } from '$env/static/public';

export async function POST({ request }: { request: Request }) {
	const { pbId, email: rawEmail } = await request.json();
	const email = (rawEmail || '').trim().toLowerCase();

	if (!pbId && !email) {
		return json({ error: 'pbId or email is required' }, { status: 400 });
	}

	let targetId = pbId;

	// Prefer resolving by email using the internal secret (emails are unique and more stable than cached pbIds
	// which can become stale after dups/cleanup/deletes in hybrid local+PB records). This helps ensure the
	// WelcomeModal "set password" step reliably marks verified:true on the actual PB record.
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

	// Fallback to pbId if email resolution didn't yield an id
	if (!targetId && pbId) {
		targetId = pbId;
	}

	if (!targetId) {
		return json({ error: 'Unable to resolve user record' }, { status: 400 });
	}

	// Use the internal secret header so the custom PocketBase server (pocketbase-main.go) can perform
	// the update with elevated privileges, bypassing normal collection rules for the verified field.
	// This is the same pattern used by send-welcome for activation flows.
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
			// Still return success to the client — the local Dexie marker is set and is what the app gates on.
			// The creation-time post-create update (under admin) or future admin pulls may also set it.
			return json({ success: true, pbUpdated: false, warning: 'Server could not update PB verified flag' });
		}

		return json({ success: true, pbUpdated: true });
	} catch (err: any) {
		console.error('[mark-verified] Unexpected error:', err);
		return json({ success: true, pbUpdated: false, warning: err?.message });
	}
}
