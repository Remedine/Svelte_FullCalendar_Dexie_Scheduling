import { PUBLIC_PB_URL } from '$env/static/public';

export async function getUserFromAuthHeader(
	authHeader: string | null
): Promise<{ id: string; email: string; name?: string; role?: string } | null> {
	if (!authHeader?.trim()) return null;

	try {
		const res = await fetch(`${PUBLIC_PB_URL}/api/collections/users/auth-refresh`, {
			method: 'POST',
			headers: { Authorization: authHeader.trim() }
		});
		if (!res.ok) return null;
		const data = await res.json();
		const record = data.record;
		if (!record?.id) return null;
		return {
			id: record.id,
			email: record.email,
			name: record.name,
			role: record.role
		};
	} catch {
		return null;
	}
}