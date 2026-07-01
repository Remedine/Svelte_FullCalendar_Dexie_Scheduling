// Shared Dexie ↔ PocketBase user identity merge helpers.
// Used by login, roster pull, dedup, and delete so local UUID + pbId stay linked.
import { db, type User } from '$lib/db';

export type PbUserRecord = {
	id: string;
	email?: string;
	firstName?: string;
	lastName?: string;
	name?: string;
	role?: string;
	photo?: string;
	active?: boolean;
	forcePinUpdate?: boolean;
	forcePhotoUpdate?: boolean;
	verified?: boolean;
	pinHash?: string;
	created?: string;
	createdAt?: string;
	updated?: string;
	updatedAt?: string;
};

/** Find an existing Dexie row that represents the same person as a PB record. */
export async function findLocalUserForPbRecord(rec: PbUserRecord): Promise<User | undefined> {
	if (rec.id) {
		const byPbId = await db.users.where('pbId').equals(rec.id).first();
		if (byPbId) return byPbId;

		const byDexieId = await db.users.get(rec.id);
		if (byDexieId) return byDexieId;
	}

	if (rec.email) {
		const byEmail = await db.users.where('email').equalsIgnoreCase(rec.email).first();
		if (byEmail) return byEmail;
	}

	const fullName = `${rec.firstName || ''} ${rec.lastName || ''}`.trim();

	if (rec.firstName && rec.lastName) {
		const firstMatches = await db.users
			.where('firstName')
			.equalsIgnoreCase(rec.firstName)
			.toArray();
		const byNames = firstMatches.find(
			(u) => u.lastName?.toLowerCase() === rec.lastName!.toLowerCase()
		);
		if (byNames) return byNames;
	}

	if (fullName) {
		const byName = await db.users.where('name').equalsIgnoreCase(fullName).first();
		if (byName) return byName;
	}

	return undefined;
}

/** Prefer PB email, then local Dexie, then auth context — never downgrade to empty. */
export function resolveUserEmail(
	rec: PbUserRecord,
	existingLocal?: User,
	authEmail?: string
): string {
	const fromPb = (rec.email || '').trim().toLowerCase();
	const fromLocal = (existingLocal?.email || '').trim().toLowerCase();
	const fromAuth = (authEmail || '').trim().toLowerCase();
	return fromPb || fromLocal || fromAuth || '';
}

/** Parse PB timestamps; ignore zero/invalid dates from internal roster (Go zero time → year 0001). */
function parsePbTimestamp(...values: (string | undefined)[]): Date | undefined {
	for (const v of values) {
		if (!v) continue;
		const d = new Date(v);
		if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
	}
	return undefined;
}

function splitNameFromRecord(rec: PbUserRecord): { first: string; last: string; full: string } {
	let first = rec.firstName || '';
	let last = rec.lastName || '';
	const full = rec.name || `${rec.firstName || ''} ${rec.lastName || ''}`.trim();
	if ((!first || !last) && full) {
		const parts = full.split(' ');
		first = first || parts[0] || '';
		last = last || parts.slice(1).join(' ') || '';
	}
	return { first, last, full: full || `${first} ${last}`.trim() };
}

/**
 * Merge a server roster row into an existing Dexie user.
 * When local updatedAt is newer, still patch missing identity fields (email, pbId, names).
 */
export function mergeServerUserOverLocal(local: User | undefined, server: User): User {
	if (!local) return server;

	if (server.updatedAt >= local.updatedAt) {
		return { ...server, id: local.id };
	}

	return {
		...local,
		pbId: local.pbId || server.pbId,
		email: resolveUserEmail({ id: server.pbId!, email: server.email }, local),
		firstName: local.firstName || server.firstName,
		lastName: local.lastName || server.lastName,
		name: local.name || server.name,
		role: server.role || local.role,
		verified: typeof server.verified === 'boolean' ? server.verified : local.verified,
		photo:
			local.photo && local.photo.startsWith('data:')
				? local.photo
				: local.photo || server.photo,
		active: server.active ?? local.active,
		forcePinUpdate: server.forcePinUpdate ?? local.forcePinUpdate,
		forcePhotoUpdate: server.forcePhotoUpdate ?? local.forcePhotoUpdate
	};
}

/** Build a Dexie user object from a PB roster/auth record, preserving local id when known. */
export function buildUserFromPbRecord(
	rec: PbUserRecord,
	existingLocal: User | undefined,
	options?: { isCurrentAuth?: boolean; authEmail?: string }
): User {
	const isCurrentAuth = options?.isCurrentAuth ?? false;
	const email = resolveUserEmail(rec, existingLocal, options?.authEmail);
	const { first, last, full } = splitNameFromRecord(rec);

	return {
		id: existingLocal?.id || rec.id,
		pbId: rec.id,
		firstName: first || existingLocal?.firstName || '',
		lastName: last || existingLocal?.lastName || '',
		name: full || email.split('@')[0] || 'User',
		pinHash: isCurrentAuth ? rec.pinHash || existingLocal?.pinHash || '' : '',
		email,
		// PB is source of truth for role on auth; never inherit stale Dexie role (e.g. prod admin on fresh staging).
		role: isCurrentAuth
			? ((rec.role as User['role']) || 'crew')
			: ((rec.role as User['role']) || existingLocal?.role || 'crew'),
		photo:
			existingLocal?.photo && existingLocal.photo.startsWith('data:')
				? existingLocal.photo
				: rec.photo || existingLocal?.photo || '',
		active: rec.active ?? existingLocal?.active ?? true,
		forcePinUpdate: existingLocal?.forcePinUpdate ?? rec.forcePinUpdate ?? false,
		forcePhotoUpdate: rec.forcePhotoUpdate ?? existingLocal?.forcePhotoUpdate ?? false,
		verified:
			typeof rec.verified === 'boolean' ? rec.verified : (existingLocal?.verified ?? false),
		createdAt:
			parsePbTimestamp(rec.createdAt, rec.created) ?? existingLocal?.createdAt ?? new Date(),
		updatedAt:
			parsePbTimestamp(rec.updatedAt, rec.updated) ?? existingLocal?.updatedAt ?? new Date()
	};
}

/** Merge PB auth record into an existing (or new) local user after email login. */
export function mergeAuthUserIntoLocal(
	pbUser: PbUserRecord,
	email: string,
	existing?: User
): User {
	const pbId = pbUser.id || existing?.pbId;

	if (existing) {
		return {
			...existing,
			id: existing.id,
			pbId,
			email: resolveUserEmail(pbUser, existing, email),
			firstName:
				pbUser.firstName ||
				existing.firstName ||
				(pbUser.name ? pbUser.name.split(' ')[0] : email.split('@')[0] || 'Admin'),
			lastName:
				pbUser.lastName ||
				existing.lastName ||
				(pbUser.name ? pbUser.name.split(' ').slice(1).join(' ') : ''),
			name:
				pbUser.name ||
				`${pbUser.firstName || existing.firstName || ''} ${pbUser.lastName || existing.lastName || ''}`.trim() ||
				email.split('@')[0] ||
				'Admin',
			pinHash: existing.pinHash || pbUser.pinHash || '',
			role: (pbUser.role as User['role']) || existing.role || 'crew',
			photo:
				existing.photo && existing.photo.startsWith('data:')
					? existing.photo
					: pbUser.photo || existing.photo,
			active: pbUser.active ?? existing.active ?? true,
			forcePinUpdate: pbUser.forcePinUpdate ?? existing.forcePinUpdate ?? false,
			forcePhotoUpdate: pbUser.forcePhotoUpdate ?? existing.forcePhotoUpdate ?? false,
			verified: !!pbUser.verified,
			createdAt: new Date(pbUser.created || pbUser.createdAt || existing.createdAt),
			updatedAt: new Date(pbUser.updated || pbUser.updatedAt || existing.updatedAt)
		};
	}

	return {
		id: pbUser.id,
		pbId: pbUser.id,
		firstName:
			pbUser.firstName ||
			(pbUser.name ? pbUser.name.split(' ')[0] : email.split('@')[0] || 'Admin'),
		lastName: pbUser.lastName || (pbUser.name ? pbUser.name.split(' ').slice(1).join(' ') : ''),
		name:
			pbUser.name ||
			`${pbUser.firstName || ''} ${pbUser.lastName || ''}`.trim() ||
			email.split('@')[0] ||
			'Admin',
		email: resolveUserEmail(pbUser, undefined, email),
		pinHash: pbUser.pinHash || '',
		role: (pbUser.role as User['role']) || 'crew',
		photo: pbUser.photo ? pbUser.photo : undefined,
		active: pbUser.active ?? true,
		forcePinUpdate: pbUser.forcePinUpdate ?? false,
		forcePhotoUpdate: pbUser.forcePhotoUpdate ?? false,
		verified: !!pbUser.verified,
		createdAt: new Date(pbUser.created || pbUser.createdAt || Date.now()),
		updatedAt: new Date(pbUser.updated || pbUser.updatedAt || Date.now())
	};
}

/** Whether it is safe to delete Dexie users not present in the last PB roster pull. */
export function canRunStaleUserDelete(pbUserIds: Set<string>, serverTotalItems: number): boolean {
	if (pbUserIds.size === 0) return false;
	if (serverTotalItems <= 0) return false;
	// Partial roster (list rule / auth) — never treat missing rows as deleted on server.
	if (pbUserIds.size < serverTotalItems) return false;
	return true;
}

/** Dedup Dexie users by email and by shared pbId. Prefers rows with firstName+lastName. */
export async function cleanupDuplicateUsers(): Promise<void> {
	const allUsers = await db.users.toArray();

	const byEmail: Record<string, User[]> = {};
	const byPbId: Record<string, User[]> = {};

	for (const u of allUsers) {
		if (u.email) {
			const key = u.email.toLowerCase();
			(byEmail[key] ||= []).push(u);
		}
		if (u.pbId) {
			(byPbId[u.pbId] ||= []).push(u);
		}
	}

	async function mergeGroup(group: User[], label: string) {
		if (group.length <= 1) return;
		const keep =
			group.find((g) => g.firstName && g.lastName && g.pbId) ||
			group.find((g) => g.firstName && g.lastName) ||
			group.find((g) => g.pbId) ||
			group[0];
		console.log(`🧹 cleanupDuplicateUsers: keeping ${keep.id} for ${label}`);
		for (const g of group) {
			if (g.id !== keep.id) {
				await db.users.delete(g.id!);
			}
		}
		const pbIdCandidate = group.find((g) => g.pbId)?.pbId;
		if (pbIdCandidate && !keep.pbId) {
			await db.users.update(keep.id!, { pbId: pbIdCandidate });
		}
	}

	for (const email in byEmail) {
		await mergeGroup(byEmail[email], email);
	}
	for (const pbId in byPbId) {
		await mergeGroup(byPbId[pbId], `pbId:${pbId}`);
	}
}

/** Delete duplicate Dexie rows for the same person (by email or pbId), keeping one canonical row. */
export async function deleteDuplicateUserRows(
	keepId: string,
	opts?: { pbId?: string; email?: string }
): Promise<void> {
	const keep = await db.users.get(keepId);
	if (!keep) return;

	const emailKey = (opts?.email || keep.email || '').toLowerCase();
	const pbId = opts?.pbId || keep.pbId;

	const all = await db.users.toArray();
	for (const u of all) {
		if (u.id === keepId) continue;
		const samePb = pbId && u.pbId === pbId;
		const sameEmail = emailKey && u.email?.toLowerCase() === emailKey;
		if (samePb || sameEmail) {
			await db.users.delete(u.id!);
			console.log(`🧹 Removed duplicate user row ${u.id} (kept ${keepId})`);
		}
	}
}