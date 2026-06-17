// )=- Shared crew name + assignment helpers (calendar crew view, /jobs crew filter, notifications).
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

export function getUserDisplayName(
	user: { name?: string; firstName?: string; lastName?: string } | null | undefined
): string {
	if (!user) return '';
	return user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim();
}

export function isJobAssignedToCrew(
	job: { assignedCrew?: string[] | null },
	crewName: string
): boolean {
	if (!crewName?.trim() || !job.assignedCrew?.length) return false;
	const trimmed = crewName.trim();
	return job.assignedCrew.some((c) => (c || '').trim() === trimmed);
}