import { json } from '@sveltejs/kit';
import { PUBLIC_PB_URL } from '$env/static/public';
import { sendInvoiceToClientEmail } from '$lib/server/brevo';

async function assertAuthenticated(token: string): Promise<boolean> {
	try {
		const res = await fetch(`${PUBLIC_PB_URL}/api/collections/users/auth-refresh`, {
			method: 'POST',
			headers: { Authorization: token, 'Content-Type': 'application/json' }
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function POST({ request }: { request: Request }) {
	const token = request.headers.get('Authorization');
	if (!token || !(await assertAuthenticated(token))) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = await request.json();
	const { clientEmail, clientName, jobTitle, amount, dueDate, filename, docxBase64 } = body;

	if (!clientEmail || !docxBase64 || !filename) {
		return json({ error: 'clientEmail, filename, and docxBase64 are required' }, { status: 400 });
	}

	try {
		await sendInvoiceToClientEmail(clientEmail, {
			clientName: clientName || 'Client',
			jobTitle: jobTitle || 'Service',
			amount: Number(amount) || 0,
			dueDate: dueDate || '—',
			filename,
			docxBase64
		});
		return json({ success: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[invoice-email] failed:', message);
		return json({ error: 'Failed to send invoice email', details: message }, { status: 500 });
	}
}