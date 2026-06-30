import { PUBLIC_PB_URL } from '$env/static/public';

export async function assertAdminFromAuthHeader(
	authHeader: string | null
): Promise<boolean> {
	if (!authHeader?.trim()) return false;
	try {
		const res = await fetch(`${PUBLIC_PB_URL}/api/collections/users/auth-refresh`, {
			method: 'POST',
			headers: { Authorization: authHeader.trim() }
		});
		if (!res.ok) return false;
		const data = await res.json();
		return data?.record?.role === 'admin';
	} catch {
		return false;
	}
}