import { PUBLIC_PB_URL } from '$env/static/public';

export type AuthUser = {
	id: string;
	email: string;
	name?: string;
	role?: string;
	active?: boolean;
};

export async function getUserFromAuthHeader(
	authHeader: string | null
): Promise<AuthUser | null> {
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
			role: record.role,
			active: record.active
		};
	} catch {
		return null;
	}
}

/** True when the bearer is an active admin. */
export async function requireAdminFromAuthHeader(
	authHeader: string | null
): Promise<AuthUser | null> {
	const user = await getUserFromAuthHeader(authHeader);
	if (!user || user.role !== 'admin') return null;
	if (user.active === false) return null;
	return user;
}

/**
 * True when the bearer is an active admin, or an active user whose email matches
 * `email` (case-insensitive). Used for self-service account routes.
 */
export async function requireAdminOrSelfEmail(
	authHeader: string | null,
	email: string | null | undefined
): Promise<AuthUser | null> {
	const user = await getUserFromAuthHeader(authHeader);
	if (!user) return null;
	if (user.active === false) return null;
	if (user.role === 'admin') return user;
	const target = (email || '').trim().toLowerCase();
	const self = (user.email || '').trim().toLowerCase();
	if (target && self && target === self) return user;
	return null;
}