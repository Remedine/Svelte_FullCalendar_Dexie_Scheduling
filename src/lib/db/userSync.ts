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

/** Build a Dexie user object from a PB roster/auth record, preserving local id when known. */
export function buildUserFromPbRecord(
	rec: PbUserRecord,
	existingLocal: User | undefined,
	options?: { isCurrentAuth?: boolean; authEmail?: string }
): User {
	const isCurrentAuth = options?.isCurrentAuth ?? false;
	const email = rec.email || existingLocal?.email || options?.authEmail || '';
	const { first, last, full } = splitNameFromRecord(rec);

	return {
		id: existingLocal?.id || rec.id,
		pbId: rec.id,
		firstName: first || existingLocal?.firstName || '',
		lastName: last || existingLocal?.lastName || '',
		name: full || email.split('@')[0] || 'User',
		pinHash: isCurrentAuth ? rec.pinHash || existingLocal?.pinHash || '' : '',
		email,
		role: (rec.role as User['role']) || existingLocal?.role || 'crew',
		photo:
			existingLocal?.photo && existingLocal.photo.startsWith('data:')
				? existingLocal.photo
				: rec.photo || existingLocal?.photo || '',
		active: rec.active ?? existingLocal?.active ?? true,
		forcePinUpdate: existingLocal?.forcePinUpdate ?? rec.forcePinUpdate ?? false,
		forcePhotoUpdate: rec.forcePhotoUpdate ?? existingLocal?.forcePhotoUpdate ?? false,
		verified:
			typeof rec.verified === 'boolean' ? rec.verified : (existingLocal?.verified ?? false),
		createdAt: new Date(rec.created || rec.createdAt || existingLocal?.createdAt || Date.now()),
		updatedAt: new Date(rec.updated || rec.updatedAt || existingLocal?.updatedAt || Date.now())
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
			email: email || existing.email || pbUser.email,
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
		email: email || pbUser.email,
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