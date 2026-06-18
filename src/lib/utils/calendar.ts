// )=- Calendar slot bounds from admin options (business hours on schedule views).
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

export function hourToFcSlotTime(hour: number): string {
	const h = Math.floor(hour);
	// FullCalendar treats 24:00:00 as end-of-day (exclusive upper bound through midnight).
	if (h >= 24) return '24:00:00';
	const clamped = Math.max(0, Math.min(23, h));
	return `${String(clamped).padStart(2, '0')}:00:00`;
}

export function getCalendarSlotBounds(
	options: { calendarDayStartHour?: number; calendarDayEndHour?: number } | null | undefined
): { slotMinTime: string; slotMaxTime: string } {
	const start = Number(options?.calendarDayStartHour ?? 6);
	const end = Number(options?.calendarDayEndHour ?? 22);
	const safeStart = Math.max(0, Math.min(22, Number.isFinite(start) ? start : 6));
	const safeEnd = Math.max(safeStart + 1, Math.min(24, Number.isFinite(end) ? end : 22));
	return {
		slotMinTime: hourToFcSlotTime(safeStart),
		slotMaxTime: hourToFcSlotTime(safeEnd)
	};
}