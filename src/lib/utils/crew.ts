// )=- Shared crew name + assignment helpers (calendar crew view, /jobs crew filter, notifications).
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

export type CrewLike = {
	id?: string;
	pbId?: string;
	email?: string;
	name?: string;
	firstName?: string;
	lastName?: string;
	photo?: string;
	active?: boolean;
	updatedAt?: Date | string | number;
};

export function getUserDisplayName(
	user: { name?: string; firstName?: string; lastName?: string } | null | undefined
): string {
	if (!user) return '';
	return (user.name || `${user.firstName || ''} ${user.lastName || ''}`).trim();
}

/** Stable identity for deduping Dexie rows that represent the same person. */
export function userIdentityKey(user: CrewLike): string {
	if (user.pbId) return `pb:${user.pbId}`;
	const email = (user.email || '').trim().toLowerCase();
	if (email) return `email:${email}`;
	if (user.id) return `id:${user.id}`;
	const display = getUserDisplayName(user).toLowerCase();
	return display ? `name:${display}` : `anon:${Math.random()}`;
}

/** Display-name variants that may appear on job.assignedCrew. */
export function getCrewNameAliases(user: CrewLike): string[] {
	const names = new Set<string>();
	const full = getUserDisplayName(user);
	if (full) names.add(full);
	const first = (user.firstName || '').trim();
	const last = (user.lastName || '').trim();
	if (first && last) names.add(`${first} ${last}`.trim());
	// firstName alone is used on some older job cards / filter chips
	if (first) names.add(first);
	return [...names].filter(Boolean);
}

function updatedAtMs(user: CrewLike): number {
	if (user.updatedAt == null) return 0;
	const t =
		user.updatedAt instanceof Date
			? user.updatedAt.getTime()
			: new Date(user.updatedAt).getTime();
	return Number.isFinite(t) ? t : 0;
}

/** Prefer the richer / newer row when collapsing Dexie duplicates. */
export function pickPreferredCrewUser(a: CrewLike, b: CrewLike): CrewLike {
	const score = (u: CrewLike) => {
		let s = 0;
		if (u.pbId) s += 8;
		if (u.firstName && u.lastName) s += 4;
		if (u.photo) s += 2;
		if (u.email) s += 1;
		if (u.active !== false) s += 1;
		return s;
	};
	const sa = score(a);
	const sb = score(b);
	if (sa !== sb) return sa > sb ? a : b;
	return updatedAtMs(a) >= updatedAtMs(b) ? a : b;
}

/**
 * One filter chip per real person (not per Dexie row or job string).
 * Job-only orphan names are omitted so the filter never exceeds the active user roster.
 * aliasToCanonical still maps every known job-style string → display name for event photos / filter match.
 */
export function buildCanonicalCrewDirectory(users: CrewLike[]): {
	/** Preferred active user per identity */
	users: CrewLike[];
	/** Sorted unique display names for filter chips */
	options: string[];
	/** Exact alias → canonical display name (for collapsing job strings) */
	aliasToCanonical: Record<string, string>;
} {
	const byIdentity = new Map<string, CrewLike>();
	for (const u of users) {
		if (u.active === false) continue;
		const key = userIdentityKey(u);
		const existing = byIdentity.get(key);
		byIdentity.set(key, existing ? pickPreferredCrewUser(existing, u) : u);
	}

	const preferred = [...byIdentity.values()];

	// Collapse identical display names (two identities, same label) to one chip.
	const byDisplay = new Map<string, CrewLike>();
	for (const u of preferred) {
		const display = getUserDisplayName(u);
		if (!display) continue;
		const existing = byDisplay.get(display);
		byDisplay.set(display, existing ? pickPreferredCrewUser(existing, u) : u);
	}

	const canonicalUsers = [...byDisplay.values()];
	const options = canonicalUsers
		.map((u) => getUserDisplayName(u))
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));

	const aliasToCanonical: Record<string, string> = {};
	for (const u of canonicalUsers) {
		const display = getUserDisplayName(u);
		if (!display) continue;
		for (const alias of getCrewNameAliases(u)) {
			aliasToCanonical[alias] = display;
			// case-insensitive lookup helpers store lowercased keys with a prefix
			aliasToCanonical[`\0${alias.toLowerCase()}`] = display;
		}
	}

	return { users: canonicalUsers, options, aliasToCanonical };
}

export function resolveCrewCanonicalName(
	name: string,
	aliasToCanonical: Record<string, string>
): string {
	const t = (name || '').trim();
	if (!t) return '';
	return aliasToCanonical[t] || aliasToCanonical[`\0${t.toLowerCase()}`] || t;
}

export function isJobAssignedToCrew(
	job: { assignedCrew?: string[] | null },
	crewName: string
): boolean {
	if (!crewName?.trim() || !job.assignedCrew?.length) return false;
	const trimmed = crewName.trim();
	return job.assignedCrew.some((c) => (c || '').trim() === trimmed);
}

/**
 * Filter match that treats renames / first-vs-full-name as the same person when
 * aliasToCanonical is provided from buildCanonicalCrewDirectory.
 */
export function isJobAssignedToAnyCrewFilter(
	job: { assignedCrew?: string[] | null },
	selectedCrew: string[],
	aliasToCanonical?: Record<string, string>
): boolean {
	if (!selectedCrew.length) return true;
	if (!job.assignedCrew?.length) return false;

	const selected = new Set(
		selectedCrew.map((c) =>
			aliasToCanonical ? resolveCrewCanonicalName(c, aliasToCanonical) : c.trim()
		)
	);

	return job.assignedCrew.some((raw) => {
		const t = (raw || '').trim();
		if (!t) return false;
		const canonical = aliasToCanonical ? resolveCrewCanonicalName(t, aliasToCanonical) : t;
		return selected.has(canonical) || selected.has(t);
	});
}
