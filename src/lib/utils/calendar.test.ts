import { describe, it, expect } from 'vitest';
import { getCalendarSlotBounds, hourToFcSlotTime } from './calendar';

describe('calendar utils', () => {
	it('hourToFcSlotTime formats FullCalendar slot strings', () => {
		expect(hourToFcSlotTime(6)).toBe('06:00:00');
		expect(hourToFcSlotTime(22)).toBe('22:00:00');
		expect(hourToFcSlotTime(24)).toBe('24:00:00');
	});

	it('getCalendarSlotBounds defaults to 6am–10pm', () => {
		expect(getCalendarSlotBounds(null)).toEqual({
			slotMinTime: '06:00:00',
			slotMaxTime: '22:00:00'
		});
	});

	it('getCalendarSlotBounds respects admin options', () => {
		expect(
			getCalendarSlotBounds({ calendarDayStartHour: 7, calendarDayEndHour: 19 })
		).toEqual({
			slotMinTime: '07:00:00',
			slotMaxTime: '19:00:00'
		});
	});

	it('getCalendarSlotBounds maps end hour 24 to midnight', () => {
		expect(
			getCalendarSlotBounds({ calendarDayStartHour: 6, calendarDayEndHour: 24 })
		).toEqual({
			slotMinTime: '06:00:00',
			slotMaxTime: '24:00:00'
		});
	});
});