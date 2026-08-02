<!-- src/lib/calendar/SplitCalendar.svelte -->
<script lang="ts">
	import { Calendar } from '@fullcalendar/core';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import { optionsStore } from '$lib/stores/options.svelte';
	import {
		getJobsForRange,
		updateJobDates,
		getUserPhotoSrc,
		db,
		cleanupDuplicateUsers,
		cleanupDuplicateJobs,
		dedupJobs,
		repairJobDateFields
	} from '$lib/db/index';
	import { pullJobsFromServer, pullUsersFromServer, applyServerJobRecord, pb } from '$lib/db/pb';
	import { onJobsRealtime } from '$lib/db/realtime';
	import { openJobModal } from '$lib/components/JobFormModal.svelte';
	import MonthPicker from './MonthPicker.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	// )=- Date helpers extracted to pure $lib/utils/dates.ts in Phase 1 of the testing plan.
	// This removes duplication with JobInvoicePanel and enables strong unit testing of the local-date logic
	// that was the source of multiple due-date / calendar jump bugs.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md
	import { getLocalDateString, parseLocalDate } from '$lib/utils/dates';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { auth } from '$lib/stores/auth.svelte';
	import {
		getUserDisplayName,
		buildCanonicalCrewDirectory,
		getCrewNameAliases,
		isJobAssignedToAnyCrewFilter,
		type CrewLike
	} from '$lib/utils/crew';
	import { getCalendarSlotBounds } from '$lib/utils/calendar';
	import {
		isMobileViewport,
		isMobileLandscapeViewport,
		mobileViewportMediaQuery
	} from '$lib/utils/device';
	import {
		formatMobileAppointmentHud,
		formatMobileTimeRange,
		MOBILE_GESTURE_DEFAULTS
	} from '$lib/utils/mobileCalendarGestures';

	/** Mobile portrait = single day; mobile landscape = 3-day time grid. Desktop uses Day/Week/Month switcher. */
	const MOBILE_VIEW_DAY = 'timeGridDay';
	const MOBILE_VIEW_THREE_DAY = 'timeGridThreeDay';

	function getMobileCalendarView(landscape: boolean): string {
		return landscape ? MOBILE_VIEW_THREE_DAY : MOBILE_VIEW_DAY;
	}

	function isTimeGridViewType(viewType: string): boolean {
		return (
			viewType === 'timeGridDay' ||
			viewType === 'timeGridWeek' ||
			viewType === MOBILE_VIEW_THREE_DAY
		);
	}

	function isMobileStyleViewType(viewType: string): boolean {
		return viewType === MOBILE_VIEW_DAY || viewType === MOBILE_VIEW_THREE_DAY;
	}

	// )=- Drag state kept as plain `let` (not $state) to avoid triggering reactivity, deriveds,
	// and $effects (which do refetch/update) on every pointer event during drag.
	// This was causing the "dog slow" feel and inability to complete drops – FullCalendar's
	// drag handling was being interrupted by parent re-renders and refetch thrashing.
	// Only used inside drag handlers; no UI binding depends on them reactively.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	let isExternalDrop = false;
	let originalEventRect: DOMRect | null = null;
	let appointmentDragActive = $state(false);
	let dragHoverDateStr = $state<string | null>(null);
	let visiblePickerYear = $state(new Date().getFullYear());
	let visiblePickerMonth = $state(new Date().getMonth());

	// Phase 1: edge-dwell on month picker while dragging an appointment to another day/month.
	// Month change only when hovering the ←/→ nav buttons — not the day grid (Sun/Sat columns).
	const MONTH_PICKER_NAV_HIT_PAD_PX = 8;
	const MONTH_PICKER_EDGE_DWELL_MS = 1000;
	const MONTH_PICKER_EDGE_REPEAT_MS = 800;

	let stepMonthPicker: (delta: number) => void = () => {};
	let monthEdgeDwellTimer: ReturnType<typeof setTimeout> | null = null;
	let monthEdgeActiveSide: 'left' | 'right' | null = null;
	let appointmentDragPointerListenerActive = false;

	function clearMonthPickerEdgeDwell() {
		if (monthEdgeDwellTimer) {
			clearTimeout(monthEdgeDwellTimer);
			monthEdgeDwellTimer = null;
		}
		monthEdgeActiveSide = null;
		document
			.querySelector('.month-picker')
			?.classList.remove('month-picker--edge-left', 'month-picker--edge-right');
	}

	function updateDragHoverDateFromPoint(clientX: number, clientY: number) {
		const dayEl = document
			.elementFromPoint(clientX, clientY)
			?.closest('.month-picker__day') as HTMLElement | null;
		dragHoverDateStr = dayEl?.dataset.date ?? null;
	}

	function scheduleMonthPickerEdgeStep(side: 'left' | 'right') {
		monthEdgeDwellTimer = setTimeout(() => {
			if (monthEdgeActiveSide !== side) return;
			stepMonthPicker(side === 'left' ? -1 : 1);
			scheduleMonthPickerEdgeStep(side);
		}, MONTH_PICKER_EDGE_REPEAT_MS);
	}

	function isPointerInElement(
		clientX: number,
		clientY: number,
		el: Element | null,
		pad = 0
	): boolean {
		if (!el) return false;
		const r = el.getBoundingClientRect();
		return (
			clientX >= r.left - pad &&
			clientX <= r.right + pad &&
			clientY >= r.top - pad &&
			clientY <= r.bottom + pad
		);
	}

	function handleAppointmentDragPointerMove(clientX: number, clientY: number) {
		ensureMobileEdgeAutoScrollRunning(clientY);

		const picker = document.querySelector('.month-picker');
		if (!picker) {
			clearMonthPickerEdgeDwell();
			return;
		}

		const rect = picker.getBoundingClientRect();
		const inside =
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom;

		if (!inside) {
			clearMonthPickerEdgeDwell();
			dragHoverDateStr = null;
			return;
		}

		const grid = picker.querySelector('.month-picker__grid');
		if (grid) {
			const gridRect = grid.getBoundingClientRect();
			const overDayGrid =
				clientX >= gridRect.left &&
				clientX <= gridRect.right &&
				clientY >= gridRect.top &&
				clientY <= gridRect.bottom;
			if (overDayGrid) {
				clearMonthPickerEdgeDwell();
				updateDragHoverDateFromPoint(clientX, clientY);
				return;
			}
		}

		dragHoverDateStr = null;

		const leftNav = picker.querySelector<HTMLElement>('.month-picker__nav--prev');
		const rightNav = picker.querySelector<HTMLElement>('.month-picker__nav--next');

		let side: 'left' | 'right' | null = null;
		if (isPointerInElement(clientX, clientY, leftNav, MONTH_PICKER_NAV_HIT_PAD_PX)) {
			side = 'left';
		} else if (isPointerInElement(clientX, clientY, rightNav, MONTH_PICKER_NAV_HIT_PAD_PX)) {
			side = 'right';
		}

		if (side === monthEdgeActiveSide) return;

		clearMonthPickerEdgeDwell();
		monthEdgeActiveSide = side;

		if (!side) return;

		picker.classList.add(side === 'left' ? 'month-picker--edge-left' : 'month-picker--edge-right');
		monthEdgeDwellTimer = setTimeout(() => {
			if (monthEdgeActiveSide !== side) return;
			stepMonthPicker(side === 'left' ? -1 : 1);
			scheduleMonthPickerEdgeStep(side);
		}, MONTH_PICKER_EDGE_DWELL_MS);
	}

	function onAppointmentDragPointerMove(e: PointerEvent) {
		handleAppointmentDragPointerMove(e.clientX, e.clientY);
		if (isMobile) {
			ensureMobileEdgeAutoScrollRunning(e.clientY);
			updateMobileDragHudFromPointer(e.clientY);
		}
	}

	function onAppointmentDragTouchMove(e: TouchEvent) {
		const touch = e.touches[0];
		if (!touch) return;
		handleAppointmentDragPointerMove(touch.clientX, touch.clientY);
		if (isMobile) {
			ensureMobileEdgeAutoScrollRunning(touch.clientY);
			updateMobileDragHudFromPointer(touch.clientY);
		}
	}

	function startAppointmentDragToMonthTracking() {
		if (appointmentDragPointerListenerActive) return;
		appointmentDragPointerListenerActive = true;
		document.addEventListener('pointermove', onAppointmentDragPointerMove, { passive: true });
		document.addEventListener('touchmove', onAppointmentDragTouchMove, { passive: true });
	}

	function stopAppointmentDragToMonthTracking() {
		if (!appointmentDragPointerListenerActive) return;
		appointmentDragPointerListenerActive = false;
		document.removeEventListener('pointermove', onAppointmentDragPointerMove);
		document.removeEventListener('touchmove', onAppointmentDragTouchMove);
		clearMonthPickerEdgeDwell();
		dragHoverDateStr = null;
		stopMobileEdgeAutoScroll();
	}
	// Suppress layout recalculation while FC is mid drag/resize — updateSize() during a gesture
	// corrupts time-grid harness top/height and collapses the card to a thin line (content floats).
	let calendarInteractionDepth = 0;

	function beginCalendarInteraction() {
		calendarInteractionDepth++;
	}

	function endCalendarInteraction() {
		calendarInteractionDepth = Math.max(0, calendarInteractionDepth - 1);
	}

	function isCalendarInteracting(): boolean {
		return calendarInteractionDepth > 0;
	}

	// Safe client coordinate extraction for both mouse (desktop drag) and touch (mobile long-press drag).
	// FullCalendar passes the raw native event as info.jsEvent. On touchend / touch drag stop this is a TouchEvent.
	// Without this, eventDragStop's hit-test against MonthPicker always fails on Android/iOS (coords undefined),
	// so "drag appointment to monthly calendar" never registers, and internal drops can have timing issues.
	// Reference: mobile-specific-tweaks
	function getEventClientCoords(jsEvent: any): { x: number; y: number } {
		if (!jsEvent) return { x: 0, y: 0 };
		if (typeof jsEvent.clientX === 'number') {
			return { x: jsEvent.clientX, y: jsEvent.clientY };
		}
		// TouchEvent (mobile Chrome/Safari etc). Prefer changedTouches (the one that ended the gesture).
		const t = jsEvent.changedTouches?.[0] || jsEvent.touches?.[0] || jsEvent.targetTouches?.[0];
		if (t && typeof t.clientX === 'number') {
			return { x: t.clientX, y: t.clientY };
		}
		return { x: 0, y: 0 };
	}

	// Mobile touch model (Google Calendar–style + select for edit chrome):
	// 1) Tap appointment → select (shows move grip + resize pills + coaching hint)
	// 2) Long-press any movable card → drag to new time (no pre-select required)
	// 3) Drag top/bottom pills on selected card → resize duration
	// 4) Second clean tap on selected body → open job
	// 5) Horizontal swipe on day grid (incl. over unselected cards) → prev/next day
	//    (or shift 3-day window). Selected/edit-mode cards keep the pointer for move+resize.
	// 6) Landscape rotate → timeGridThreeDay (3 columns); portrait → timeGridDay
	// 7) Live time HUD + light haptics on select / grab / snap / drop
	// FullCalendar touch resize is disabled; custom edge pills handle it instead.
	// Edge auto-scroll while dragging/resizing near top/bottom of the day grid.
	// Larger zone + higher velocity so late/early slots are reachable without overshooting into the bottom nav.
	const MOBILE_EDGE_SCROLL_THRESHOLD_PX = 120;
	const MOBILE_EDGE_SCROLL_MAX_VELOCITY = 1600;
	const MOBILE_EDGE_SCROLL_MIN_VELOCITY = 320;
	// Fat-finger horizontal day change: modest distance, allow some vertical drift.
	const MOBILE_SWIPE_MIN_DX_PX = 48;
	const MOBILE_SWIPE_MAX_SLOPE = 0.9;
	const MOBILE_SWIPE_CLAIM_DX_PX = 18;
	const MOBILE_TAP_MOVE_SLOP_PX = 14;
	// Long-press in the 300–400ms band matches Google Calendar / Material “press and drag”.
	const MOBILE_EVENT_LONG_PRESS_MS = MOBILE_GESTURE_DEFAULTS.longPressMs;
	const MOBILE_EVENT_DRAG_MIN_DISTANCE_PX = MOBILE_GESTURE_DEFAULTS.dragMinDistancePx;

	let mobileEdgeScrollPointerY: number | null = null;
	let mobileEdgeScrollRaf: number | null = null;
	let mobileEdgeScrollLastTs: number | null = null;

	let activeMobileResize: {
		eventId: string;
		eventEl: HTMLElement;
		harnessEl: HTMLElement;
		resizeStartEdge: boolean;
		pointerStartY: number;
		initialScrollTop: number;
		originalStart: Date;
		originalEnd: Date;
		previewStart: Date;
		previewEnd: Date;
	} | null = null;

	function getMobileScrollEl(): HTMLElement | null {
		const fcScroller = dayEl?.querySelector('.fc-scroller') as HTMLElement | null;
		if (fcScroller && fcScroller.scrollHeight > fcScroller.clientHeight) {
			return fcScroller;
		}
		return document.querySelector('.split-calendar__day-wrapper');
	}

	function isMobileGestureChromeTarget(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		return !!target.closest(
			'.fc-event-resizer, .fc-event__edge-pill, .fc-event__move-handle'
		);
	}

	/**
	 * Selected appointment = edit mode (move grip + resize pills). Day swipe must not steal
	 * those gestures. Unselected cards may be swiped over to change day.
	 */
	function isMobileEventInEditMode(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		if (isMobileGestureChromeTarget(target)) return true;
		const eventRoot = target.closest('.fc-event') as HTMLElement | null;
		if (!eventRoot) return false;
		if (eventRoot.classList.contains('fc-event--mobile-selected')) return true;
		const id = eventRoot.dataset.mobileEventId;
		return Boolean(id && selectedMobileEventId && id === selectedMobileEventId);
	}

	function isMobileEventMovable(status?: string | null): boolean {
		return status !== 'completed' && status !== 'cancelled';
	}

	/** Light tactile feedback; no-ops when the platform blocks vibration. */
	function mobileHaptic(pattern: number | number[] = 10) {
		try {
			if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
				navigator.vibrate(pattern);
			}
		} catch {
			// Ignore — haptics are progressive enhancement only.
		}
	}

	let mobileGestureHudEl: HTMLElement | null = null;
	let mobileDragHudRaf: number | null = null;
	let mobileResizeLastSnapKey = '';
	/** Duration + last preview times while long-press moving (HUD independent of FC event mutation). */
	let mobileDragMeta: {
		eventId: string;
		durationMs: number;
		start: Date;
		end: Date;
		originalStart: Date;
		originalEnd: Date;
	} | null = null;

	function ensureMobileGestureHud(): HTMLElement | null {
		if (mobileGestureHudEl?.isConnected) return mobileGestureHudEl;
		if (typeof document === 'undefined') return null;
		// Mount on body with position:fixed so overflow/stacking inside the day grid cannot hide it.
		const el = document.createElement('div');
		el.className = 'split-calendar__gesture-hud';
		el.setAttribute('role', 'status');
		el.setAttribute('aria-live', 'polite');
		document.body.appendChild(el);
		mobileGestureHudEl = el;
		return el;
	}

	function showMobileGestureHud(text: string, mode: 'move' | 'resize' | 'info' = 'move') {
		const el = ensureMobileGestureHud();
		if (!el) return;
		el.dataset.mode = mode;
		el.textContent = text;
		el.classList.add('split-calendar__gesture-hud--visible');
	}

	function hideMobileGestureHud() {
		if (mobileDragHudRaf != null) {
			cancelAnimationFrame(mobileDragHudRaf);
			mobileDragHudRaf = null;
		}
		mobileDragMeta = null;
		mobileGestureHudEl?.classList.remove('split-calendar__gesture-hud--visible');
		document.documentElement.classList.remove('calendar-appointment-dragging');
		document.documentElement.style.removeProperty('--mobile-drag-mirror-height');
	}

	/**
	 * FullCalendar sizes timegrid events with absolute harness top/bottom (duration height).
	 * A floating ElementMirror clone uses the source rect height; if CSS overrides position
	 * or the clone loses height, multi-hour cards look like ~1h until drop. Re-assert height.
	 */
	function preserveMobileDragMirrorHeight(heightPx: number) {
		if (!heightPx || heightPx < 8) return;
		const h = `${Math.round(heightPx)}px`;
		document.querySelectorAll('.fc-event-mirror').forEach((node) => {
			if (!(node instanceof HTMLElement)) return;
			const pos = getComputedStyle(node).position;
			// Floating clone from ElementMirror — force the pre-drag visual duration height.
			if (pos === 'fixed') {
				node.style.height = h;
				node.style.minHeight = h;
				node.style.boxSizing = 'border-box';
			}
			// In-grid harness mirrors must stay absolutely positioned (top/bottom encode duration).
			if (node.classList.contains('fc-timegrid-event-harness')) {
				if (node.style.position === 'relative') {
					node.style.position = 'absolute';
				}
			}
		});
	}

	/** Map a vertical screen position onto the day time-grid (snapped to slot). */
	function estimateStartFromClientY(clientY: number): Date | null {
		const slotTable =
			(dayEl?.querySelector('.fc-timegrid-slots table') as HTMLElement | null) ||
			(dayEl?.querySelector('.fc-timegrid-slots') as HTMLElement | null) ||
			(dayEl?.querySelector('.fc-timegrid-body') as HTMLElement | null);
		if (!slotTable) return null;

		const rect = slotTable.getBoundingClientRect();
		if (rect.height <= 0) return null;

		const { slotMinMs, slotMaxMs } = getSlotRangeMs();
		const rangeMs = Math.max(slotMaxMs - slotMinMs, 1);
		const { slotMs } = getMobileSlotMetrics();
		const fraction = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
		let msOfDay = slotMinMs + fraction * rangeMs;
		msOfDay = Math.round(msOfDay / slotMs) * slotMs;
		// Keep at least one slot of room for the event start within the grid.
		const maxStart = Math.max(slotMinMs, slotMaxMs - slotMs);
		msOfDay = Math.max(slotMinMs, Math.min(maxStart, msOfDay));

		const day = parseLocalDate(selectedDate);
		day.setHours(0, 0, 0, 0);
		return new Date(day.getTime() + msOfDay);
	}

	function resolveMobileDragPreviewTimes(
		fallbackStart: Date,
		durationMs: number
	): { start: Date; end: Date } {
		const mirror =
			document.querySelector('.fc-event-mirror') ||
			document.querySelector('.fc-timegrid-event-harness.fc-event-mirror') ||
			document.querySelector('.fc-event.fc-event-mirror');

		if (mirror instanceof HTMLElement) {
			const top = mirror.getBoundingClientRect().top;
			const estimated = estimateStartFromClientY(top + 1);
			if (estimated) {
				return { start: estimated, end: new Date(estimated.getTime() + durationMs) };
			}
			// FC often paints the time range into the mirror; parse "1:30pm - 2:30pm" loosely.
			const timeText = mirror.querySelector('.fc-event-time')?.textContent?.trim();
			if (timeText) {
				const parsed = parseMirrorTimeText(timeText, fallbackStart, durationMs);
				if (parsed) return parsed;
			}
		}

		const evId = mobileDragMeta?.eventId;
		const ev = evId ? dayApi?.getEventById(evId) : null;
		if (ev?.start) {
			const start = new Date(ev.start);
			const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + durationMs);
			return { start, end };
		}

		return {
			start: fallbackStart,
			end: new Date(fallbackStart.getTime() + durationMs)
		};
	}

	/** Best-effort parse of FullCalendar mirror time label. */
	function parseMirrorTimeText(
		text: string,
		fallbackStart: Date,
		durationMs: number
	): { start: Date; end: Date } | null {
		// Examples: "1:30pm - 2:30pm", "13:30 - 14:30", "1:30 PM"
		const parts = text.split(/\s*[-–—]\s*/);
		const parseOne = (raw: string, base: Date): Date | null => {
			const m = raw
				.trim()
				.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
			if (!m) return null;
			let h = Number(m[1]);
			const min = m[2] != null ? Number(m[2]) : 0;
			const ap = m[3]?.toLowerCase();
			if (ap === 'pm' && h < 12) h += 12;
			if (ap === 'am' && h === 12) h = 0;
			const d = new Date(base);
			d.setHours(h, min, 0, 0);
			return d;
		};

		const start = parseOne(parts[0] || '', fallbackStart);
		if (!start) return null;
		if (parts[1]) {
			const end = parseOne(parts[1], fallbackStart);
			if (end && end.getTime() > start.getTime()) {
				return { start, end };
			}
		}
		return { start, end: new Date(start.getTime() + durationMs) };
	}

	function updateMobileDragHudFromPointer(clientY?: number) {
		if (!mobileDragMeta) return;
		let start = mobileDragMeta.start;
		let end = mobileDragMeta.end;

		if (typeof clientY === 'number') {
			const estimated = estimateStartFromClientY(clientY);
			if (estimated) {
				start = estimated;
				end = new Date(estimated.getTime() + mobileDragMeta.durationMs);
			} else {
				({ start, end } = resolveMobileDragPreviewTimes(start, mobileDragMeta.durationMs));
			}
		} else {
			({ start, end } = resolveMobileDragPreviewTimes(start, mobileDragMeta.durationMs));
		}

		mobileDragMeta = { ...mobileDragMeta, start, end };
		showMobileGestureHud(formatMobileAppointmentHud(start, end, { verb: 'Moving' }), 'move');
	}

	function startMobileDragHudLoop(eventId: string, fallbackStart: Date, fallbackEnd: Date) {
		if (mobileDragHudRaf != null) {
			cancelAnimationFrame(mobileDragHudRaf);
			mobileDragHudRaf = null;
		}
		const durationMs = Math.max(
			fallbackEnd.getTime() - fallbackStart.getTime(),
			30 * 60 * 1000
		);
		mobileDragMeta = {
			eventId,
			durationMs,
			start: fallbackStart,
			end: fallbackEnd,
			originalStart: new Date(fallbackStart),
			originalEnd: new Date(fallbackEnd)
		};
		document.documentElement.classList.add('calendar-appointment-dragging');

		// Show immediately — do not wait for rAF / appointmentDragActive.
		showMobileGestureHud(
			formatMobileAppointmentHud(fallbackStart, fallbackEnd, { verb: 'Moving' }),
			'move'
		);

		const tick = () => {
			if (!mobileDragMeta) {
				mobileDragHudRaf = null;
				return;
			}
			// Prefer mirror geometry; fall back to last meta.
			updateMobileDragHudFromPointer();
			// Keep multi-hour cards full height for the whole drag (floating mirror can lose it).
			const hCss = getComputedStyle(document.documentElement)
				.getPropertyValue('--mobile-drag-mirror-height')
				.trim();
			const hPx = hCss.endsWith('px') ? parseFloat(hCss) : originalEventRect?.height ?? 0;
			if (hPx > 0) preserveMobileDragMirrorHeight(hPx);
			mobileDragHudRaf = requestAnimationFrame(tick);
		};
		mobileDragHudRaf = requestAnimationFrame(tick);
	}

	let selectedMobileEventId = $state<string | null>(null);
	let suppressNextDateClick = false;
	let suppressNextEventClick = false;
	let mobileBackgroundDeselectListenerActive = false;
	let mobileDaySwipeDocListenersActive = false;
	let mobileDaySwipe:
		| {
				x: number;
				y: number;
				lastX: number;
				lastY: number;
				pointerId: number;
				/** Touch began on an appointment (used to suppress post-swipe select/open). */
				startedOnEvent: boolean;
				/** True once the gesture is clearly horizontal (prefer day-nav over vertical scroll). */
				claimedHorizontal: boolean;
		  }
		| null = null;
	let mobileEventPointer:
		| { eventId: string; x: number; y: number; moved: boolean }
		| null = null;

	function setMobileEventStartEditable(eventId: string | null, editable: boolean) {
		if (!dayApi || !eventId) return;
		const ev = dayApi.getEventById(eventId);
		if (ev) {
			ev.setProp('startEditable', editable);
		}
	}

	function clearMobileEventSelection() {
		if (!selectedMobileEventId) return;
		// Keep startEditable true on mobile so the next long-press can grab without re-selecting.
		document.querySelectorAll('.fc-event--mobile-selected').forEach((el) => {
			el.classList.remove('fc-event--mobile-selected');
		});
		selectedMobileEventId = null;
		mobileEventPointer = null;
	}

	function selectMobileEvent(eventId: string, eventEl: HTMLElement, opts?: { haptic?: boolean }) {
		const isNew = selectedMobileEventId !== eventId;
		if (selectedMobileEventId && selectedMobileEventId !== eventId) {
			document.querySelectorAll('.fc-event--mobile-selected').forEach((el) => {
				el.classList.remove('fc-event--mobile-selected');
			});
		}
		selectedMobileEventId = eventId;
		eventEl.classList.add('fc-event--mobile-selected');
		// Movable jobs stay start-editable on mobile (Google-style long-press drag).
		const status = dayApi?.getEventById(eventId)?.extendedProps?.status as string | undefined;
		if (isMobileEventMovable(status)) {
			setMobileEventStartEditable(eventId, true);
		}
		if (opts?.haptic !== false && isNew && isMobile) {
			mobileHaptic(12);
		}
	}

	function handleMobileCalendarBackgroundPointerDown(e: PointerEvent) {
		if (!isMobile || appointmentDragActive || activeMobileResize) return;
		const target = e.target;
		if (!(target instanceof Element)) return;
		if (isMobileGestureChromeTarget(target)) return;

		const eventRoot = target.closest('.fc-event') as HTMLElement | null;
		if (!eventRoot) {
			if (selectedMobileEventId) suppressNextDateClick = true;
			clearMobileEventSelection();
			return;
		}

		const id = eventRoot.dataset.mobileEventId;
		if (id && id !== selectedMobileEventId) {
			// Deselect previous; eventClick will select the new one.
			clearMobileEventSelection();
		}
	}

	async function shiftCalendarDay(deltaDays: number) {
		const base = parseLocalDate(selectedDate);
		if (isNaN(base.getTime())) return;
		base.setDate(base.getDate() + deltaDays);
		clearMobileEventSelection();
		suppressNextDateClick = true;
		await handleDateSelect(getLocalDateString(base));
	}

	function getDayWrapperEl(): HTMLElement | null {
		return dayWrapperEl ?? (document.querySelector('.split-calendar__day-wrapper') as HTMLElement | null);
	}

	function teardownMobileDaySwipeDocListeners() {
		if (!mobileDaySwipeDocListenersActive) return;
		document.removeEventListener('pointermove', handleMobileDaySwipePointerMove);
		document.removeEventListener('pointerup', handleMobileDaySwipePointerUp);
		document.removeEventListener('pointercancel', handleMobileDaySwipePointerCancel);
		mobileDaySwipeDocListenersActive = false;
	}

	function ensureMobileDaySwipeDocListeners() {
		if (mobileDaySwipeDocListenersActive) return;
		mobileDaySwipeDocListenersActive = true;
		// Document-level so we still finish the gesture if the finger leaves the wrapper
		// or FullCalendar's scroller steals the hit target mid-swipe.
		document.addEventListener('pointermove', handleMobileDaySwipePointerMove, { passive: true });
		document.addEventListener('pointerup', handleMobileDaySwipePointerUp, { passive: true });
		document.addEventListener('pointercancel', handleMobileDaySwipePointerCancel, { passive: true });
	}

	function handleMobileDaySwipePointerDown(e: PointerEvent) {
		if (!isMobile || appointmentDragActive || activeMobileResize) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (!(e.target instanceof Element)) return;
		// Only the day grid area (not month picker / filters / chrome).
		if (e.target.closest('.month-picker, .split-calendar__filters, .split-calendar__view-switcher')) {
			return;
		}
		// Selected card / move grip / resize pills own the pointer (edit mode).
		// Unselected cards: allow day swipe across their surface.
		if (isMobileEventInEditMode(e.target)) return;

		mobileDaySwipe = {
			x: e.clientX,
			y: e.clientY,
			lastX: e.clientX,
			lastY: e.clientY,
			pointerId: e.pointerId,
			startedOnEvent: !!e.target.closest('.fc-event'),
			claimedHorizontal: false
		};
		ensureMobileDaySwipeDocListeners();

		// Keep receiving coords even if the finger leaves the start element.
		const wrapper = getDayWrapperEl();
		try {
			wrapper?.setPointerCapture?.(e.pointerId);
		} catch {
			// Some browsers throw if capture is not allowed for this pointer type.
		}
	}

	function handleMobileDaySwipePointerMove(e: PointerEvent) {
		const gesture = mobileDaySwipe;
		if (!gesture || gesture.pointerId !== e.pointerId) return;

		gesture.lastX = e.clientX;
		gesture.lastY = e.clientY;

		const dx = e.clientX - gesture.x;
		const dy = e.clientY - gesture.y;
		if (
			!gesture.claimedHorizontal &&
			Math.abs(dx) >= MOBILE_SWIPE_CLAIM_DX_PX &&
			Math.abs(dx) > Math.abs(dy) * 1.15
		) {
			gesture.claimedHorizontal = true;
			// Once it's a day swipe, don't let the release select/open the card under the finger.
			if (gesture.startedOnEvent) {
				suppressNextEventClick = true;
				suppressNextDateClick = true;
			}
		}
	}

	function finishMobileDaySwipe(clientX: number, clientY: number, pointerId: number) {
		const gesture = mobileDaySwipe;
		if (!gesture || gesture.pointerId !== pointerId) return;

		mobileDaySwipe = null;
		teardownMobileDaySwipeDocListeners();

		// If a long-press move engaged mid-gesture, leave the day alone.
		if (!isMobile || appointmentDragActive || activeMobileResize) return;

		const dx = clientX - gesture.x;
		const dy = clientY - gesture.y;
		if (Math.abs(dx) < MOBILE_SWIPE_MIN_DX_PX) return;
		// Require mostly-horizontal; claimed swipes get a slightly looser slope.
		const maxSlope = gesture.claimedHorizontal ? MOBILE_SWIPE_MAX_SLOPE + 0.15 : MOBILE_SWIPE_MAX_SLOPE;
		if (Math.abs(dy) > Math.abs(dx) * maxSlope) return;

		// Swipe left → next day; swipe right → previous day (works over unselected cards too).
		suppressNextEventClick = true;
		suppressNextDateClick = true;
		void shiftCalendarDay(dx < 0 ? 1 : -1);
	}

	function handleMobileDaySwipePointerUp(e: PointerEvent) {
		if (mobileDaySwipe?.pointerId !== e.pointerId) return;
		finishMobileDaySwipe(e.clientX, e.clientY, e.pointerId);
	}

	function handleMobileDaySwipePointerCancel(e: PointerEvent) {
		const gesture = mobileDaySwipe;
		if (!gesture || gesture.pointerId !== e.pointerId) return;
		// Browser often cancels the pointer when a scroll container engages.
		// Still honor a clear horizontal swipe using the last tracked coords.
		finishMobileDaySwipe(gesture.lastX, gesture.lastY, e.pointerId);
	}

	function ensureMobileBackgroundDeselectListener() {
		if (mobileBackgroundDeselectListenerActive || !isMobile) return;
		const wrapper = getDayWrapperEl();
		if (!wrapper) return;
		mobileBackgroundDeselectListenerActive = true;
		wrapper.addEventListener('pointerdown', handleMobileCalendarBackgroundPointerDown, {
			capture: true,
			passive: true
		});
		// Capture so FullCalendar / nested scrollers cannot swallow the start of a day swipe.
		wrapper.addEventListener('pointerdown', handleMobileDaySwipePointerDown, {
			capture: true,
			passive: true
		});
	}

	function teardownMobileBackgroundListeners() {
		const wrapper = getDayWrapperEl();
		teardownMobileDaySwipeDocListeners();
		mobileDaySwipe = null;
		if (!wrapper || !mobileBackgroundDeselectListenerActive) {
			mobileBackgroundDeselectListenerActive = false;
			return;
		}
		wrapper.removeEventListener('pointerdown', handleMobileCalendarBackgroundPointerDown, {
			capture: true
		} as EventListenerOptions);
		wrapper.removeEventListener('pointerdown', handleMobileDaySwipePointerDown, {
			capture: true
		} as EventListenerOptions);
		mobileBackgroundDeselectListenerActive = false;
	}

	function getEventHarnessEl(el: HTMLElement): HTMLElement | null {
		return el.classList.contains('fc-timegrid-event-harness')
			? el
			: (el.closest('.fc-timegrid-event-harness') as HTMLElement | null);
	}

	// Custom mobile resize adds harness height; FC itself uses pixel top + bottom — never strip those.
	function clearMobileResizePreviewStyles(el: HTMLElement) {
		const harness = getEventHarnessEl(el);
		harness?.style.removeProperty('height');
	}

	function getSlotRangeMs(): { slotMinMs: number; slotMaxMs: number } {
		const parseFcTime = (value: unknown): number => {
			if (typeof value === 'string') {
				const [h, m, s] = value.split(':').map(Number);
				return ((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000;
			}
			return 6 * 3600 * 1000;
		};
		return {
			slotMinMs: parseFcTime(dayApi?.getOption('slotMinTime')),
			slotMaxMs: parseFcTime(dayApi?.getOption('slotMaxTime'))
		};
	}

	function harnessStyleForDates(start: Date, end: Date, harnessEl: HTMLElement): { top: string; bottom: string } {
		const col = harnessEl.closest('.fc-timegrid-col');
		const colHeight = col?.getBoundingClientRect().height ?? 1;
		const { slotMinMs, slotMaxMs } = getSlotRangeMs();
		const dayStart = new Date(start);
		dayStart.setHours(0, 0, 0, 0);
		const startMs = start.getTime() - dayStart.getTime();
		const endMs = end.getTime() - dayStart.getTime();
		const rangeMs = Math.max(slotMaxMs - slotMinMs, 1);
		const topPx = ((startMs - slotMinMs) / rangeMs) * colHeight;
		const endPx = ((endMs - slotMinMs) / rangeMs) * colHeight;
		return {
			top: `${topPx}px`,
			bottom: `${-endPx}px`
		};
	}

	function getMobileSlotMetrics(harnessEl?: HTMLElement | null): { slotHeight: number; slotMs: number } {
		const col = harnessEl?.closest('.fc-timegrid-col');
		const slotEl =
			col?.querySelector('.fc-timegrid-slot-lane') ||
			col?.querySelector('.fc-timegrid-slot') ||
			document.querySelector('.fc-timegrid-slot-lane') ||
			document.querySelector('.fc-timegrid-slot');
		const slotHeight = slotEl?.getBoundingClientRect().height || 42;
		const duration = dayApi?.getOption('slotDuration') as
			| { milliseconds?: number }
			| string
			| null
			| undefined;
		let slotMs = 30 * 60 * 1000;
		if (duration && typeof duration === 'object' && typeof duration.milliseconds === 'number') {
			slotMs = duration.milliseconds;
		}
		return { slotHeight, slotMs };
	}

	function snapMobileResizePreview(
		originalStart: Date,
		originalEnd: Date,
		resizeStartEdge: boolean,
		slotDelta: number,
		slotMs: number
	): { start: Date; end: Date } {
		if (resizeStartEdge) {
			const nextStart = new Date(originalStart.getTime() + slotDelta * slotMs);
			if (nextStart.getTime() >= originalEnd.getTime() - slotMs) {
				return {
					start: new Date(originalEnd.getTime() - slotMs),
					end: originalEnd
				};
			}
			return { start: nextStart, end: originalEnd };
		}

		const nextEnd = new Date(originalEnd.getTime() + slotDelta * slotMs);
		if (nextEnd.getTime() <= originalStart.getTime() + slotMs) {
			return {
				start: originalStart,
				end: new Date(originalStart.getTime() + slotMs)
			};
		}
		return { start: originalStart, end: nextEnd };
	}

	function applyMobileResizePreview(
		gesture: NonNullable<typeof activeMobileResize>,
		start: Date,
		end: Date
	) {
		const style = harnessStyleForDates(start, end, gesture.harnessEl);
		gesture.harnessEl.style.removeProperty('height');
		gesture.harnessEl.style.top = style.top;
		gesture.harnessEl.style.bottom = style.bottom;
	}

	function getMobileScrollCompensation(gesture: NonNullable<typeof activeMobileResize>): number {
		const scrollEl = getMobileScrollEl();
		if (!scrollEl) return 0;
		return scrollEl.scrollTop - gesture.initialScrollTop;
	}

	function updateMobileResizeFromClientY(clientY: number) {
		if (!activeMobileResize) return;

		const { slotHeight, slotMs } = getMobileSlotMetrics(activeMobileResize.harnessEl);
		const scrollCompensation = getMobileScrollCompensation(activeMobileResize);
		const slotDelta = Math.round(
			(clientY - activeMobileResize.pointerStartY + scrollCompensation) / slotHeight
		);
		const snapped = snapMobileResizePreview(
			activeMobileResize.originalStart,
			activeMobileResize.originalEnd,
			activeMobileResize.resizeStartEdge,
			slotDelta,
			slotMs
		);
		const snapKey = `${snapped.start.getTime()}-${snapped.end.getTime()}`;
		if (snapKey !== mobileResizeLastSnapKey) {
			if (mobileResizeLastSnapKey) {
				// Tick only when crossing a slot boundary, not on first sample.
				mobileHaptic(8);
			}
			mobileResizeLastSnapKey = snapKey;
		}
		activeMobileResize.previewStart = snapped.start;
		activeMobileResize.previewEnd = snapped.end;
		applyMobileResizePreview(activeMobileResize, snapped.start, snapped.end);
		showMobileGestureHud(
			formatMobileAppointmentHud(snapped.start, snapped.end, { verb: 'Resize' }),
			'resize'
		);
	}

	function stopMobileEdgeAutoScroll() {
		if (mobileEdgeScrollRaf != null) {
			cancelAnimationFrame(mobileEdgeScrollRaf);
			mobileEdgeScrollRaf = null;
		}
		mobileEdgeScrollPointerY = null;
		mobileEdgeScrollLastTs = null;
	}

	/** Ease edge proximity (0–1) into a snappy scroll velocity (px/sec). */
	function edgeScrollVelocityFromProximity(proximity01: number, direction: 1 | -1): number {
		const t = Math.max(0, Math.min(1, proximity01));
		// Quadratic ease-in: gentle near center of zone, aggressive at the rim / past the rim.
		const eased = t * t;
		const speed =
			MOBILE_EDGE_SCROLL_MIN_VELOCITY +
			eased * (MOBILE_EDGE_SCROLL_MAX_VELOCITY - MOBILE_EDGE_SCROLL_MIN_VELOCITY);
		return direction * speed;
	}

	function runMobileEdgeAutoScrollFrame(ts: number) {
		if (!activeMobileResize && !appointmentDragActive) {
			stopMobileEdgeAutoScroll();
			return;
		}

		const scrollEl = getMobileScrollEl();
		const pointerY = mobileEdgeScrollPointerY;

		if (scrollEl && pointerY != null) {
			const rect = scrollEl.getBoundingClientRect();
			let velocity = 0;
			const fromTop = pointerY - rect.top;
			const fromBottom = rect.bottom - pointerY;

			if (fromTop < 0) {
				// Finger above the scroller (status bar / month picker gap) — full-speed scroll up.
				velocity = -MOBILE_EDGE_SCROLL_MAX_VELOCITY;
			} else if (fromBottom < 0) {
				// Finger below the scroller (bottom tab bar) — full-speed scroll down so late
				// slots stay reachable without needing a precise drop on the grid edge.
				velocity = MOBILE_EDGE_SCROLL_MAX_VELOCITY;
			} else if (fromTop < MOBILE_EDGE_SCROLL_THRESHOLD_PX) {
				const proximity =
					(MOBILE_EDGE_SCROLL_THRESHOLD_PX - fromTop) / MOBILE_EDGE_SCROLL_THRESHOLD_PX;
				velocity = edgeScrollVelocityFromProximity(proximity, -1);
			} else if (fromBottom < MOBILE_EDGE_SCROLL_THRESHOLD_PX) {
				const proximity =
					(MOBILE_EDGE_SCROLL_THRESHOLD_PX - fromBottom) / MOBILE_EDGE_SCROLL_THRESHOLD_PX;
				velocity = edgeScrollVelocityFromProximity(proximity, 1);
			}

			if (velocity !== 0 && mobileEdgeScrollLastTs != null) {
				// Allow larger frame steps on janky mobile browsers so scroll doesn't feel capped.
				const dt = Math.min(0.064, (ts - mobileEdgeScrollLastTs) / 1000);
				const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
				scrollEl.scrollTop = Math.min(
					maxScroll,
					Math.max(0, scrollEl.scrollTop + velocity * dt)
				);
			}

			if (activeMobileResize) {
				// Use clamped Y so resize preview stays mapped to the grid when over the nav.
				const clampedY = Math.max(rect.top + 1, Math.min(rect.bottom - 1, pointerY));
				updateMobileResizeFromClientY(clampedY);
			} else if (appointmentDragActive && mobileDragMeta) {
				const clampedY = Math.max(rect.top + 1, Math.min(rect.bottom - 1, pointerY));
				updateMobileDragHudFromPointer(clampedY);
			}
		}

		mobileEdgeScrollLastTs = ts;
		mobileEdgeScrollRaf = requestAnimationFrame(runMobileEdgeAutoScrollFrame);
	}

	function isPointOverBottomNav(clientX: number, clientY: number): boolean {
		const nav = document.querySelector('.bottom-nav');
		if (!(nav instanceof HTMLElement)) return false;
		const r = nav.getBoundingClientRect();
		// display:none / not painted → zero box
		if (r.height <= 0 || r.width <= 0) return false;
		return (
			clientX >= r.left &&
			clientX <= r.right &&
			clientY >= r.top &&
			clientY <= r.bottom
		);
	}

	function isPointOutsideCalendarTimeGrid(clientX: number, clientY: number): boolean {
		if (isPointOverBottomNav(clientX, clientY)) return true;

		const grid =
			(dayEl?.querySelector('.fc-timegrid-body') as HTMLElement | null) ||
			dayEl ||
			getDayWrapperEl();
		if (!grid) return true;
		const r = grid.getBoundingClientRect();
		const overGrid =
			clientX >= r.left &&
			clientX <= r.right &&
			clientY >= r.top &&
			clientY <= r.bottom;
		return !overGrid;
	}

	/**
	 * When the user drops on the bottom nav (or elsewhere outside the time grid),
	 * FullCalendar reverts. Re-apply the last HUD preview times so the move still sticks.
	 */
	async function commitMobileDragPreview(
		meta: {
			eventId: string;
			start: Date;
			end: Date;
			originalStart: Date;
			originalEnd: Date;
		},
		eventApi: { setDates: (start: Date, end: Date) => void }
	) {
		const changed =
			meta.start.getTime() !== meta.originalStart.getTime() ||
			meta.end.getTime() !== meta.originalEnd.getTime();
		if (!changed) return;

		try {
			// Apply after FC's invalid-drop revert paints, then persist.
			await new Promise<void>((resolve) => {
				requestAnimationFrame(() => {
					try {
						eventApi.setDates(meta.start, meta.end);
					} catch {
						// ignore setDates failures; still try to persist + refetch
					}
					resolve();
				});
			});
			await updateJobDates(meta.eventId, meta.start, meta.end);
			applyOptimisticDatePatch(meta.eventId, meta.start, meta.end);
			mobileHaptic([10, 40, 14]);
			toast.success(`Moved · ${formatMobileTimeRange(meta.start, meta.end)}`);
			// Ensure harness positions match after a possible FC revert animation.
			dayApi?.refetchEvents();
		} catch {
			toast.error('Could not move appointment');
			dayApi?.refetchEvents();
		}
	}

	function ensureMobileEdgeAutoScrollRunning(clientY: number) {
		mobileEdgeScrollPointerY = clientY;
		if (mobileEdgeScrollRaf == null) {
			mobileEdgeScrollLastTs = performance.now();
			mobileEdgeScrollRaf = requestAnimationFrame(runMobileEdgeAutoScrollFrame);
		}
	}

	function clearMobileResizeListeners() {
		document.removeEventListener('touchmove', handleMobileResizeMove);
		document.removeEventListener('touchend', handleMobileResizeEnd);
		document.removeEventListener('touchcancel', handleMobileResizeEnd);
		document.removeEventListener('pointermove', handleMobileResizePointerMove);
		document.removeEventListener('pointerup', handleMobileResizePointerEnd);
		document.removeEventListener('pointercancel', handleMobileResizePointerEnd);
		stopMobileEdgeAutoScroll();
	}

	function handleMobileResizeMove(e: TouchEvent) {
		if (!activeMobileResize) return;
		const touch = e.touches[0];
		if (!touch) return;

		updateMobileResizeFromClientY(touch.clientY);
		ensureMobileEdgeAutoScrollRunning(touch.clientY);
		e.preventDefault();
	}

	function handleMobileResizePointerMove(e: PointerEvent) {
		if (!activeMobileResize) return;
		// Prefer touch path when both fire to avoid double-processing.
		if (e.pointerType === 'touch' && e.buttons === 0) return;
		updateMobileResizeFromClientY(e.clientY);
		ensureMobileEdgeAutoScrollRunning(e.clientY);
		if (e.cancelable) e.preventDefault();
	}

	function handleMobileResizePointerEnd() {
		// Touch end may also fire; handleMobileResizeEnd is idempotent once activeMobileResize is cleared.
		void handleMobileResizeEnd();
	}

	async function handleMobileResizeEnd() {
		const gesture = activeMobileResize;
		// Idempotent: pointer + touch end can both fire for one gesture.
		if (!gesture) {
			clearMobileResizeListeners();
			return;
		}
		activeMobileResize = null;
		mobileResizeLastSnapKey = '';
		clearMobileResizeListeners();
		hideMobileGestureHud();

		const changed =
			gesture.previewStart.getTime() !== gesture.originalStart.getTime() ||
			gesture.previewEnd.getTime() !== gesture.originalEnd.getTime();

		gesture.eventEl.classList.remove('fc-event-resizing');

		if (!changed) {
			applyMobileResizePreview(gesture, gesture.originalStart, gesture.originalEnd);
			requestAnimationFrame(() => endCalendarInteraction());
			return;
		}

		try {
			await updateJobDates(gesture.eventId, gesture.previewStart, gesture.previewEnd);
			applyOptimisticDatePatch(gesture.eventId, gesture.previewStart, gesture.previewEnd);
			applyMobileResizePreview(gesture, gesture.previewStart, gesture.previewEnd);
			mobileHaptic([10, 30, 12]);
			toast.success(
				`Resized · ${formatMobileTimeRange(gesture.previewStart, gesture.previewEnd)}`
			);
			dayApi?.refetchEvents();
			requestAnimationFrame(() => endCalendarInteraction());
		} catch {
			applyMobileResizePreview(gesture, gesture.originalStart, gesture.originalEnd);
			dayApi?.refetchEvents();
			toast.error('Could not resize appointment');
			requestAnimationFrame(() => endCalendarInteraction());
		}
	}

	function ensureMobileMoveHandle(eventEl: HTMLElement) {
		if (eventEl.querySelector('.fc-event__move-handle')) return;
		const handle = document.createElement('button');
		handle.type = 'button';
		handle.className = 'fc-event__move-handle';
		handle.setAttribute('aria-label', 'Hold and drag to move appointment');
		handle.title = 'Hold, then drag to a new time';
		handle.tabIndex = -1;
		handle.innerHTML =
			'<span class="fc-event__move-handle-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" focusable="false"><path fill="currentColor" d="M5 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm7-9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg></span><span class="fc-event__move-handle-label">Move</span>';
		// Prevent button click from opening the job modal; drag is handled by FullCalendar long-press.
		handle.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		// Priming haptic while the user holds the grip (before FC drag engages).
		let armTimer: ReturnType<typeof setTimeout> | null = null;
		const clearArm = () => {
			if (armTimer != null) {
				clearTimeout(armTimer);
				armTimer = null;
			}
			handle.classList.remove('fc-event__move-handle--armed');
		};
		handle.addEventListener(
			'pointerdown',
			(e) => {
				if (!isMobile || (e.pointerType === 'mouse' && e.button !== 0)) return;
				clearArm();
				armTimer = setTimeout(() => {
					handle.classList.add('fc-event__move-handle--armed');
					mobileHaptic(10);
				}, Math.max(0, MOBILE_EVENT_LONG_PRESS_MS - 40));
			},
			{ passive: true }
		);
		handle.addEventListener('pointerup', clearArm, { passive: true });
		handle.addEventListener('pointercancel', clearArm, { passive: true });
		handle.addEventListener('pointerleave', clearArm, { passive: true });
		eventEl.appendChild(handle);
	}

	/**
	 * FullCalendar only injects `.fc-event-resizer` when `eventDurationEditable` is true.
	 * We keep duration edit OFF on mobile (so FC native resize never fights our gesture) and
	 * inject our own edge pills instead — they reuse the same class names our handlers already expect.
	 */
	function ensureMobileResizeHandles(eventEl: HTMLElement, status?: string | null) {
		if (!isMobileEventMovable(status)) {
			eventEl.querySelectorAll('.fc-event__edge-pill').forEach((el) => el.remove());
			return;
		}
		if (eventEl.querySelector('.fc-event__edge-pill')) return;

		const makePill = (edge: 'start' | 'end') => {
			const pill = document.createElement('div');
			// Keep FC class names so existing resize gesture + CSS continue to work.
			pill.className = `fc-event-resizer fc-event-resizer-${edge} fc-event__edge-pill fc-event__edge-pill--${edge}`;
			pill.setAttribute('role', 'slider');
			pill.setAttribute(
				'aria-label',
				edge === 'start' ? 'Drag to change start time' : 'Drag to change end time'
			);
			pill.dataset.edge = edge;
			// Visible grab bar (CSS ::after is decorative; this is the real hit target chrome).
			const bar = document.createElement('span');
			bar.className = 'fc-event__edge-pill-bar';
			bar.setAttribute('aria-hidden', 'true');
			pill.appendChild(bar);
			return pill;
		};

		eventEl.appendChild(makePill('start'));
		eventEl.appendChild(makePill('end'));
	}

	function setupMobileEventTouchZones(info: {
		el: HTMLElement;
		event: {
			id: string;
			start: Date | null;
			end: Date | null;
			extendedProps?: { status?: string };
		};
	}) {
		const eventEl = info.el;
		eventEl.dataset.mobileEventId = info.event.id;
		eventEl.classList.add('fc-event-draggable');
		ensureMobileMoveHandle(eventEl);
		ensureMobileResizeHandles(eventEl, info.event.extendedProps?.status);

		// Google-style: any movable job is long-press draggable. Selection only unlocks resize chrome.
		const movable = isMobileEventMovable(info.event.extendedProps?.status);
		setMobileEventStartEditable(info.event.id, movable);
		if (selectedMobileEventId === info.event.id) {
			eventEl.classList.add('fc-event--mobile-selected');
		}

		if (eventEl.dataset.mobileTouchZones === '1') {
			return;
		}
		eventEl.dataset.mobileTouchZones = '1';

		clearMobileResizePreviewStyles(eventEl);

		const eventId = info.event.id;
		if (!info.event.start) return;
		const originalStart = new Date(info.event.start);
		const originalEnd = info.event.end
			? new Date(info.event.end)
			: new Date(originalStart.getTime() + getMobileSlotMetrics().slotMs);

		// Track finger movement so a sloppy second tap does not open the job when the user meant to drag.
		eventEl.addEventListener(
			'pointerdown',
			(e) => {
				if (!isMobile) return;
				if (e.pointerType === 'mouse' && e.button !== 0) return;
				const target = e.target;
				if (!(target instanceof Element) || isMobileGestureChromeTarget(target)) return;
				mobileEventPointer = {
					eventId,
					x: e.clientX,
					y: e.clientY,
					moved: false
				};
			},
			{ capture: true, passive: true }
		);

		eventEl.addEventListener(
			'pointermove',
			(e) => {
				if (!mobileEventPointer || mobileEventPointer.eventId !== eventId) return;
				const dx = e.clientX - mobileEventPointer.x;
				const dy = e.clientY - mobileEventPointer.y;
				if (Math.hypot(dx, dy) > MOBILE_TAP_MOVE_SLOP_PX) {
					mobileEventPointer.moved = true;
				}
			},
			{ capture: true, passive: true }
		);

		const beginResizeFromPointer = (clientY: number, resizer: Element) => {
			if (selectedMobileEventId !== eventId) {
				selectMobileEvent(eventId, eventEl);
				return;
			}

			const status = info.event.extendedProps?.status;
			if (status === 'completed' || status === 'cancelled') {
				toast.error('Cannot resize cancelled or completed jobs');
				return;
			}

			const harnessEl = eventEl.closest('.fc-timegrid-event-harness') as HTMLElement | null;
			if (!harnessEl) return;

			const scrollEl = getMobileScrollEl();
			// Fresh dates from FC (not closure from mount) so resize after drag stays correct.
			const liveEvent = dayApi?.getEventById(eventId);
			const liveStart = liveEvent?.start ? new Date(liveEvent.start) : originalStart;
			const liveEnd = liveEvent?.end ? new Date(liveEvent.end) : originalEnd;

			beginCalendarInteraction();
			mobileResizeLastSnapKey = '';
			activeMobileResize = {
				eventId,
				eventEl,
				harnessEl,
				resizeStartEdge:
					resizer.classList.contains('fc-event-resizer-start') ||
					(resizer as HTMLElement).dataset?.edge === 'start',
				pointerStartY: clientY,
				initialScrollTop: scrollEl?.scrollTop ?? 0,
				originalStart: liveStart,
				originalEnd: liveEnd,
				previewStart: liveStart,
				previewEnd: liveEnd
			};

			eventEl.classList.add('fc-event-resizing');
			mobileHaptic(10);
			updateMobileResizeFromClientY(clientY);
			ensureMobileEdgeAutoScrollRunning(clientY);
			document.addEventListener('touchmove', handleMobileResizeMove, { passive: false });
			document.addEventListener('touchend', handleMobileResizeEnd, { passive: true });
			document.addEventListener('touchcancel', handleMobileResizeEnd, { passive: true });
			document.addEventListener('pointermove', handleMobileResizePointerMove, { passive: false });
			document.addEventListener('pointerup', handleMobileResizePointerEnd, { passive: true });
			document.addEventListener('pointercancel', handleMobileResizePointerEnd, { passive: true });
		};

		eventEl.addEventListener(
			'pointerdown',
			(e) => {
				if (!isMobile) return;
				if (e.pointerType === 'mouse' && e.button !== 0) return;
				const target = e.target;
				if (!(target instanceof Element)) return;
				const resizer = target.closest('.fc-event-resizer, .fc-event__edge-pill');
				if (!resizer) return;

				// Claim the gesture so long-press move / day swipe cannot steal the edge drag.
				e.stopPropagation();
				try {
					eventEl.setPointerCapture?.(e.pointerId);
				} catch {
					// ignore
				}
				beginResizeFromPointer(e.clientY, resizer);
			},
			{ capture: true, passive: true }
		);

		// Touch fallback for browsers that still prefer touch events over pointer for capture/scroll.
		eventEl.addEventListener(
			'touchstart',
			(e) => {
				const target = e.target;
				if (!(target instanceof Element)) return;
				const resizer = target.closest('.fc-event-resizer, .fc-event__edge-pill');
				if (!resizer) return;
				if (activeMobileResize) return;

				e.stopPropagation();
				const touch = e.changedTouches[0] || e.touches[0];
				if (!touch) return;
				beginResizeFromPointer(touch.clientY, resizer);
			},
			{ capture: true, passive: true }
		);
	}

	let dayEl = $state<HTMLDivElement | null>(null);
	let dayWrapperEl = $state<HTMLDivElement | null>(null);
	const initialSearchParams =
		typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

	let selectedDate = $state(
		// )=- Support ?date=YYYY-MM-DD from job details "Jump to calendar" (and direct links).
		// Sets the initial view date so the calendar focuses the relevant day/week when jumping from a job.
		// Works on initial load of the split calendar page.
		// Reference: JOBS_AND_INVOICES_SPEC.md (calendar jump improvements in Phase 7)
		initialSearchParams?.get('date') || getLocalDateString()
	);
	let highlightJobId = $state<string | null>(initialSearchParams?.get('jobId') || null);
	let jumpShowCancelled = $state(initialSearchParams?.get('status') === 'cancelled');
	let hasScrolledToHighlight = false;
	let highlightFallbackScheduled = false;

	const CALENDAR_STATUS_FILTERS = ['scheduled', 'completed', 'cancelled'] as const;
	let jobs = $state<any[]>([]);
	let dayApi: Calendar | null = null;
	let isSyncing = $state(false);
	const initialIsMobile = isMobileViewport();
	const initialIsMobileLandscape = isMobileLandscapeViewport();
	let currentView = $state(
		initialIsMobile ? getMobileCalendarView(initialIsMobileLandscape) : 'timeGridWeek'
	);
	let crewOptions = $state<string[]>([]);

	// Mobile detection for day/3-day view, compact MonthPicker, reclaimed space, anchored top month picker,
	// and mobile footer behaviors in the parent layout. Landscape keeps mobile gestures + DnD.
	let isMobile = $state(initialIsMobile);
	let isMobileLandscape = $state(initialIsMobileLandscape);

	/** Portrait = 1 day, landscape = 3 days. Skips while a drag/resize is active. */
	function ensureMobileCalendarView() {
		if (!isMobile) return;
		if (isCalendarInteracting() || appointmentDragActive || activeMobileResize) return;

		const nextView = getMobileCalendarView(isMobileLandscape);
		if (currentView !== nextView) currentView = nextView;
		if (dayApi && dayApi.view.type !== nextView) {
			dayApi.changeView(nextView);
			dayApi.gotoDate(parseLocalDate(selectedDate));
			dayApi.refetchEvents();
			requestAnimationFrame(() => {
				dayApi?.updateSize();
			});
		}
	}

	function formatFcScrollTime(date: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	}

	function findHighlightedJob(): any | null {
		if (!highlightJobId) return null;
		return (
			jobs.find((j: any) => j.id === highlightJobId || j.pbId === highlightJobId) ?? null
		);
	}

	/** Mobile day / 3-day view: scroll the time grid to the job slot (not page scrollIntoView). */
	function scrollToHighlightedJob(start: Date): boolean {
		if (!dayApi || isNaN(start.getTime())) return false;

		const viewType = dayApi.view.type;
		if (isMobile || isMobileStyleViewType(viewType)) {
			try {
				dayApi.scrollToTime(formatFcScrollTime(start));
				return true;
			} catch {
				// fall through to scroller positioning
			}
		}

		const scroller = dayEl?.querySelector('.fc-scroller') as HTMLElement | null;
		const highlighted = dayEl?.querySelector('.event-highlighted') as HTMLElement | null;
		if (scroller && highlighted) {
			const top =
				highlighted.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top +
				scroller.scrollTop;
			scroller.scrollTo({
				top: Math.max(0, top - scroller.clientHeight * 0.25),
				behavior: 'smooth'
			});
			return true;
		}

		return false;
	}

	function focusHighlightedEvent(info: {
		el: HTMLElement;
		view: { type: string };
		event: { id: string; start: Date | null; extendedProps?: any };
	}) {
		if (!highlightJobId || hasScrolledToHighlight) return;
		if (!jobMatchesHighlight(info.event.id, info.event.extendedProps)) return;

		const isDayish = isMobile || isMobileStyleViewType(info.view.type);

		if (isDayish && info.event.start) {
			const start = info.event.start;
			requestAnimationFrame(() => {
				window.setTimeout(() => {
					if (scrollToHighlightedJob(start)) {
						hasScrolledToHighlight = true;
					}
				}, 120);
			});
			return;
		}

		hasScrolledToHighlight = true;
		requestAnimationFrame(() => {
			window.setTimeout(() => {
				info.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}, 120);
		});
	}

	function scheduleHighlightJumpFallback() {
		if (
			!highlightJobId ||
			!isMobile ||
			hasScrolledToHighlight ||
			highlightFallbackScheduled
		) {
			return;
		}
		const job = findHighlightedJob();
		if (!job?.start) return;

		highlightFallbackScheduled = true;
		const start = new Date(job.start);
		window.setTimeout(() => {
			if (hasScrolledToHighlight) return;
			if (scrollToHighlightedJob(start)) {
				hasScrolledToHighlight = true;
			}
		}, 400);
	}

	// Attach mobile day-swipe / background-deselect listeners once the wrapper is in the DOM.
	$effect(() => {
		if (!isMobile || !dayWrapperEl) return;
		ensureMobileBackgroundDeselectListener();
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mqlMobile = window.matchMedia(mobileViewportMediaQuery());
		const mqlLandscape = window.matchMedia('(orientation: landscape)');

		const applyViewportMode = () => {
			const nextMobile = mqlMobile.matches;
			const nextLandscape = nextMobile && mqlLandscape.matches;
			const mobileChanged = nextMobile !== isMobile;
			const landscapeChanged = nextLandscape !== isMobileLandscape;

			isMobile = nextMobile;
			isMobileLandscape = nextLandscape;

			if (isMobile) {
				ensureMobileCalendarView();
				ensureMobileBackgroundDeselectListener();
			} else if (mobileChanged) {
				clearMobileEventSelection();
				teardownMobileBackgroundListeners();
				// Leaving mobile shell: restore desktop default week view if we were on a mobile-only view.
				if (isMobileStyleViewType(currentView)) {
					currentView = 'timeGridWeek';
					if (dayApi && dayApi.view.type !== 'timeGridWeek') {
						dayApi.changeView('timeGridWeek');
						dayApi.refetchEvents();
					}
				}
			} else if (landscapeChanged) {
				// Desktop orientation change: still reflow height.
			}

			if (dayApi) {
				// Mobile: long-press move stays on (Google-style). Resize stays custom edge-pills only.
				// Landscape 3-day keeps the same touch model as portrait day.
				dayApi.setOption('eventStartEditable', true);
				dayApi.setOption('eventDurationEditable', !isMobile);
				dayApi.setOption('eventResizableFromStart', false);
				dayApi.setOption('selectable', !isMobile);
				dayApi.setOption(
					'eventDragMinDistance',
					isMobile ? MOBILE_EVENT_DRAG_MIN_DISTANCE_PX : 10
				);
				dayApi.setOption(
					'eventLongPressDelay',
					isMobile ? MOBILE_EVENT_LONG_PRESS_MS : 280
				);
				dayApi.setOption(
					'longPressDelay',
					isMobile ? MOBILE_EVENT_LONG_PRESS_MS : 280
				);
				requestAnimationFrame(() => dayApi?.updateSize());
			}
		};

		applyViewportMode();
		mqlMobile.addEventListener('change', applyViewportMode);
		mqlLandscape.addEventListener('change', applyViewportMode);

		return () => {
			mqlMobile.removeEventListener('change', applyViewportMode);
			mqlLandscape.removeEventListener('change', applyViewportMode);
		};
	});

	// )=- Map of crew name → photo URL for event cards + filter chips.
	// Keys include all name aliases so job.assignedCrew strings match after renames.
	let crewPhotoMap = $state<Record<string, string>>({});
	/** alias → canonical display name (filter chips use canonical names only). */
	let crewAliasToCanonical = $state<Record<string, string>>({});
	let filtersOpen = $state(true);
	let draggedJobId: string | null = null;
	let crewDirectoryRefreshInFlight: Promise<void> | null = null;
	let lastRosterPullAt = 0;

	/**
	 * Rebuild crew filter list + photo map from Dexie users (one chip per person).
	 * Does NOT union every job.assignedCrew string — that inflated the filter past real users
	 * (renames, typos, Dexie dupes). Job strings still map via aliases for photos + filtering.
	 */
	async function refreshCrewDirectory(opts: { pullRoster?: boolean } = {}): Promise<void> {
		// Wait for any in-flight rebuild, then continue if we still need a roster pull.
		if (crewDirectoryRefreshInFlight) {
			await crewDirectoryRefreshInFlight;
			if (!opts.pullRoster || Date.now() - lastRosterPullAt < 15_000) return;
		}

		crewDirectoryRefreshInFlight = (async () => {
			try {
				if (
					opts.pullRoster &&
					navigator.onLine &&
					pb.authStore.isValid &&
					Date.now() - lastRosterPullAt > 15_000
				) {
					// Admin gets full roster; non-admin is a no-op inside pullUsersFromServer.
					await pullUsersFromServer(true).catch((e) =>
						console.warn('[calendar] roster pull failed', e)
					);
					lastRosterPullAt = Date.now();
				}

				await cleanupDuplicateUsers().catch(() => {});

				const users = (await db.users.toArray()) as CrewLike[];
				const { options, users: canonicalUsers, aliasToCanonical } =
					buildCanonicalCrewDirectory(users);

				crewOptions = options;
				crewAliasToCanonical = aliasToCanonical;

				const map: Record<string, string> = {};
				for (const u of canonicalUsers) {
					if (!u.photo) continue;
					const src = getUserPhotoSrc(u.photo, u);
					if (!src) continue;
					// Index by every alias so event cards resolve photos after renames.
					for (const alias of getCrewNameAliases(u)) {
						map[alias] = src;
					}
				}
				crewPhotoMap = map;

				// Drop filter selections that no longer exist (stale orphan chips).
				if (filters.crew.length) {
					const valid = new Set(options);
					const next = filters.crew.filter((c) => valid.has(c));
					if (next.length !== filters.crew.length) {
						filters = { ...filters, crew: next };
					}
				}

				// Rebuild event DOM so avatars pick up photos that arrived after first paint.
				if (dayApi) {
					dayApi.refetchEvents();
				}
			} catch (e) {
				console.warn('[calendar] refreshCrewDirectory failed', e);
			} finally {
				crewDirectoryRefreshInFlight = null;
			}
		})();

		return crewDirectoryRefreshInFlight;
	}

	function jobMatchesHighlight(jobId: string | undefined, job: any): boolean {
		if (!highlightJobId || !jobId) return false;
		return (
			jobId === highlightJobId ||
			job?.id === highlightJobId ||
			job?.pbId === highlightJobId
		);
	}

	function clearJobHighlight() {
		if (!highlightJobId) return;
		highlightJobId = null;
		hasScrolledToHighlight = false;
		highlightFallbackScheduled = false;
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.delete('jobId');
		window.history.replaceState({}, '', url.pathname + url.search);
		dayApi?.refetchEvents();
	}

	$effect(() => {
		if (!jumpShowCancelled) return;
		filtersOpen = true;
	});

	$effect(() => {
		if (!highlightJobId) return;
		const timer = window.setTimeout(() => clearJobHighlight(), 6000);
		return () => window.clearTimeout(timer);
	});

	// Plain (non-$state) flag to ensure the FullCalendar instance is created only once
	// per component mount. This stops the destroy/recreate loop that was the root cause
	// of the idle "constant refreshing", repeated eventDidMount work, and memory growth.
	let calendarInitialized = false;

	// Persist filter panel state
	$effect(() => {
		const saved = localStorage.getItem('calendarFiltersOpen');
		filtersOpen = saved !== null ? saved === 'true' : window.innerWidth >= 900;
	});

	$effect(() => {
		localStorage.setItem('calendarFiltersOpen', String(filtersOpen));
	});

	// Load crew filters + photos (local first, then admin roster when online).
	// Previous "load once if map empty" left the UI stuck on only the signed-in user
	// when roster arrived after first paint.
	$effect(() => {
		void refreshCrewDirectory({ pullRoster: true });
	});

	$effect(() => {
		const wrapper = document.querySelector('.split-calendar__day-wrapper');
		if (!wrapper) return;

		let lastW = 0;
		let lastH = 0;
		let resizeTimeout: number | null = null;

		const observer = new ResizeObserver((entries) => {
			const rect = entries[0]?.contentRect;
			if (!rect) return;

			const w = rect.width;
			const h = rect.height;

			// Never recalc layout mid drag/resize — corrupts harness positioning (card collapse / wrong drop slot).
			if (isCalendarInteracting()) return;

			// Debounce + significant change only. Prevents constant updates from micro layout shifts
			// during initial render or idle (e.g. image loads, subpixel rounding, FC internal adjustments).
			// This was the main driver of repeated eventDidMount, provider calls, and "refreshing" feel at rest.
			if (Math.abs(w - lastW) < 4 && Math.abs(h - lastH) < 4) return;

			lastW = w;
			lastH = h;

			if (resizeTimeout) clearTimeout(resizeTimeout);
			resizeTimeout = window.setTimeout(() => {
				if (dayApi) {
					dayApi.updateSize();
				}
				resizeTimeout = null;
			}, 50);  // small debounce
		});

		observer.observe(wrapper);

		return () => {
			observer.disconnect();
			if (resizeTimeout) {
				clearTimeout(resizeTimeout);
				resizeTimeout = null;
			}
		};
	});
	// === FILTERS ===
	// Jumping from a cancelled job enables status filters (incl. cancelled) so the job is fetched and visible.
	let filters = $state({
		crew: [] as string[],
		areas: [] as string[],
		statuses: jumpShowCancelled ? [...CALENDAR_STATUS_FILTERS] : ([] as string[])
	});

	function shouldIncludeCancelledJobs(): boolean {
		return filters.statuses.includes('cancelled') || jumpShowCancelled;
	}

	// Job window must cover today, the selected day, AND the month-picker's visible month (±2 months each way).
	// A fixed ±2 months from "now" drops appointments moved to September while viewing June.
	let loadedJobsRangeStart: Date | null = null;
	let loadedJobsRangeEnd: Date | null = null;
	let visibleMonthReloadTimer: ReturnType<typeof setTimeout> | null = null;

	function getVisibleMonthAnchorDate(): Date {
		const anchor = new Date(visiblePickerYear, visiblePickerMonth, 15);
		anchor.setHours(12, 0, 0, 0);
		return anchor;
	}

	function getCalendarJobsRange(focusDateStr: string = selectedDate): { start: Date; end: Date } {
		const today = new Date();
		today.setHours(12, 0, 0, 0);
		const focus = parseLocalDate(focusDateStr);
		const focusMs = isNaN(focus.getTime()) ? today.getTime() : focus.getTime();
		const visibleAnchor = getVisibleMonthAnchorDate();

		const start = new Date(
			Math.min(today.getTime(), focusMs, visibleAnchor.getTime())
		);
		start.setMonth(start.getMonth() - 2);
		start.setHours(0, 0, 0, 0);

		const end = new Date(
			Math.max(today.getTime(), focusMs, visibleAnchor.getTime())
		);
		end.setMonth(end.getMonth() + 2);
		end.setHours(23, 59, 59, 999);

		return { start, end };
	}

	function calendarJobsRangeNeedsReload(focusDateStr: string = selectedDate): boolean {
		const { start, end } = getCalendarJobsRange(focusDateStr);
		if (!loadedJobsRangeStart || !loadedJobsRangeEnd) return true;
		return (
			start.getTime() < loadedJobsRangeStart.getTime() ||
			end.getTime() > loadedJobsRangeEnd.getTime()
		);
	}

	async function reloadJobsForCalendarRange(focusDateStr: string = selectedDate) {
		const { start, end } = getCalendarJobsRange(focusDateStr);
		const includeCancelled = shouldIncludeCancelledJobs();
		await repairJobDateFields();
		// Remove local-uuid + canonical pbId twin rows so the day grid never paints the same job twice.
		try {
			await cleanupDuplicateJobs();
		} catch {
			// best-effort; range query still dedups in memory
		}
		jobs = await getJobsForRange(start, end, includeCancelled);
		loadedJobsRangeStart = start;
		loadedJobsRangeEnd = end;
	}

	function clearJumpCancelledMode() {
		if (!jumpShowCancelled) return;
		jumpShowCancelled = false;
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.delete('status');
		window.history.replaceState({}, '', url.pathname + url.search);
	}

	// === Realtime push for cross-device appointment changes ===
	// Uses shared jobs realtime (single SSE client) — see $lib/db/realtime.ts.
	// If realtime fails (PB restart, Railway multi-instance, stale clientId), session-restore /
	// app-visible pulls (scheduleAppDataSync) + periodic fallback below still keep the calendar correct.
	$effect(() => {
		if (!pb.authStore.isValid) return;

		let pollTimer: ReturnType<typeof setInterval> | null = null;
		let cancelled = false;

		const refreshCalendarFromDexie = async () => {
			if (cancelled) return;
			await reloadJobsForCalendarRange();
			dayApi?.refetchEvents();
		};

		const offRealtime = onJobsRealtime(async (e) => {
			const rec = e.record as any;
			if (!rec) return;

			// )=- Batch A: same updatedAt merge as pullJobsFromServer — do not clobber newer local edits.
			const outcome = await applyServerJobRecord(rec);
			if (outcome === 'skipped') return;

			await refreshCalendarFromDexie();
		});

		// After app-state / resume sync lands in Dexie, refresh calendar jobs + crew directory.
		const onAppDataSynced = () => {
			void (async () => {
				await refreshCrewDirectory({ pullRoster: false });
				await refreshCalendarFromDexie();
			})();
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('ccw:app-data-synced', onAppDataSynced);
		}

		// Fallback when realtime is down: light periodic pull while calendar is open.
		// Also reload the FC snapshot — pull alone only updates IndexedDB.
		pollTimer = setInterval(() => {
			if (navigator.onLine && pb.authStore.isValid) {
				pullJobsFromServer()
					.then(() => refreshCalendarFromDexie())
					.catch(() => {});
			}
		}, 120_000);

		return () => {
			cancelled = true;
			offRealtime();
			if (pollTimer) clearInterval(pollTimer);
			if (typeof window !== 'undefined') {
				window.removeEventListener('ccw:app-data-synced', onAppDataSynced);
			}
		};
	});

	const activeFilterCount = $derived(
		filters.crew.length + filters.areas.length + filters.statuses.length
	);

	// )=- When area options load (or change), or when the calendar becomes ready (dayApi assignment),
	// refetch events so getJobColor + eventDidMount pick up the real area colors immediately.
	// Previously the .length guard + creation timing meant the initial events() + didMount often saw
	// stale/empty optionsStore.data (gray cards) until a later explicit refetch from job add/edit.
	// Now: dayApi set re-runs this effect (it reads dayApi), and we only require data presence (not length>0)
	// so we always get a refetch pass with the data that loadData awaited.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	$effect(() => {
		if (dayApi && optionsStore.data) {
			// (see comment above on crewPhotoMap effect for why the refetch was removed)
			// dayApi.refetchEvents();  // removed for perf
		}
	});

	// )=- Crew role: auto-scope to assigned jobs only (matches legacy Calendar.svelte behavior).
	// Admins still use manual crew facet filters. Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	const crewScopedJobs = $derived.by(() => {
		if (auth.currentUser?.role !== 'crew') return jobs;
		const crewName = getUserDisplayName(auth.currentUser);
		if (!crewName) return jobs;
		// Alias map so renames / first-name-only job strings still match.
		return jobs.filter((job: any) =>
			isJobAssignedToAnyCrewFilter(job, [crewName], crewAliasToCanonical)
		);
	});

	const calendarSlotBounds = $derived(getCalendarSlotBounds(optionsStore.data));

	const filteredJobs = $derived(
		crewScopedJobs.filter((job: any) => {
			const matchesCrew = isJobAssignedToAnyCrewFilter(
				job,
				filters.crew,
				crewAliasToCanonical
			);
			const matchesArea = filters.areas.length === 0 || filters.areas.includes(job.areaOfTown);
			const matchesStatus = filters.statuses.length === 0 || filters.statuses.includes(job.status);
			return matchesCrew && matchesArea && matchesStatus;
		})
	);

	// )=- Apply configurable business hours from admin options when they change.
	$effect(() => {
		const { slotMinTime, slotMaxTime } = calendarSlotBounds;
		if (dayApi) {
			dayApi.setOption('slotMinTime', slotMinTime);
			dayApi.setOption('slotMaxTime', slotMaxTime);
		}
	});

	// )=- Local date functions were extracted to $lib/utils/dates (imported above).
	// getJobColor remains local because it depends on the optionsStore (not a pure date util).
	function getJobColor(job: any): string {
		if (!job?.areaOfTown || !optionsStore.data?.areasOfTown) return '#64748b';
		const area = optionsStore.data.areasOfTown.find((a: any) => a.id === job.areaOfTown);
		return getDisplayAreaColor(area?.color);
	}

	// We import the shared dedupJobs from $lib/db (centralized logic that also powers getJobsForRange).

	// === OPTIMISTIC DATE PATCH (Phase 1) ===
	// After a successful drag or resize, we immediately update the local `jobs` $state snapshot
	// used by `filteredJobs` $derived and the FullCalendar `events` provider.
	// This gives instant visual update + correct placement without the heavy `refreshAfterUpdate`
	// (which does server pull + full range query + splice + refetch + syncing toast).
	// The real DB update still happens via `updateJobDates` (Dexie + queue + optional processSyncQueue).
	// Full heavy refresh is kept for creates, cancels, status changes, and explicit sync paths.
	// This directly addresses "drag not registering", "no DB call visible", and "feels like reloading on drag".
	// All features preserved: internal D&D, external MonthPicker drops, revert on error, filters, avatars, etc.
	// Reference: approved calendar perf plan.
	function applyOptimisticDatePatch(jobId: string, start: Date, end: Date | null) {
		// Prefer exact Dexie id (what FullCalendar uses as event.id); fall back to pbId only if needed.
		let idx = jobs.findIndex((j: any) => j.id === jobId);
		if (idx === -1) {
			idx = jobs.findIndex((j: any) => j.pbId === jobId);
		}
		if (idx === -1) return false;

		const original = jobs[idx];
		const finalEnd = end || new Date(start.getTime() + 4 * 60 * 60 * 1000);

		const patched = {
			...original,
			start,
			end: finalEnd,
		};

		// Reassign $state array (new reference) to trigger reactivity for filteredJobs + events provider.
		// Always dedup to keep the snapshot healthy even if Dexie has accumulated duplicates.
		jobs = dedupJobs([
			...jobs.slice(0, idx),
			patched,
			...jobs.slice(idx + 1),
		]);
		return true;
	}

	async function loadData() {
		await optionsStore.load?.();
		// Options pull removed (extra roundtrips). Job freshness: paint Dexie first, then one
		// server pull when online so returning after vacation does not show pre-leave events.
		// Full pull also runs on login/session restore via scheduleAppDataSync.
		// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

		// Local crew directory first (filters + avatar map for whoever is already in Dexie).
		await refreshCrewDirectory({ pullRoster: false });

		try {
			if (navigator.onLine && pb.authStore.isValid) {
				await pullJobsFromServer();
				// Full roster so assigned crew photos/filters are not limited to the signed-in user.
				await refreshCrewDirectory({ pullRoster: true });
			}
		} catch (e) {
			console.warn('[calendar] initial jobs/roster pull failed', e);
		}

		await reloadJobsForCalendarRange();
	}

	async function refreshAfterUpdate() {
		isSyncing = true;
		const syncToast = toast.show('Syncing changes…', 'info', 0);

		setTimeout(() => {
			toast.dismiss(syncToast);
		}, 900);

		try {
			if (pb.authStore.isValid && navigator.onLine) {
				await pullJobsFromServer();
			}

			await reloadJobsForCalendarRange();
			dayApi?.refetchEvents();
		} catch (e) {
			toast.dismiss(syncToast);
			toast.error('Failed to sync changes');
		} finally {
			isSyncing = false;
		}
	}

	function changeView(newView: string) {
		// On mobile we only support Day (portrait) / 3-day (landscape) under anchored MonthPicker.
		// Week/Month are desktop only.
		if (isMobile && !isMobileStyleViewType(newView)) {
			return;
		}
		currentView = newView;
		if (dayApi) {
			dayApi.changeView(newView);
		}
	}

	function toggleFilter(type: 'crew' | 'areas' | 'statuses', value: string) {
		const arr = filters[type];
		const wasCancelledSelected = type === 'statuses' && filters.statuses.includes('cancelled');

		if (arr.includes(value)) {
			filters[type] = arr.filter((v) => v !== value);
		} else {
			filters[type] = [...arr, value];
		}

		const isCancelledToggled = type === 'statuses' && value === 'cancelled';
		const nowCancelledSelected = filters.statuses.includes('cancelled');

		if (
			isCancelledToggled ||
			(type === 'statuses' && wasCancelledSelected !== nowCancelledSelected)
		) {
			loadData().then(() => {
				dayApi?.refetchEvents();
			});
		} else {
			dayApi?.refetchEvents();
		}
	}

	function clearFilters() {
		clearJumpCancelledMode();
		filters = {
			crew: [],
			areas: [],
			statuses: []
		};
		loadData().then(() => {
			dayApi?.refetchEvents();
		});
	}

	async function handleExternalDrop(jobId: string, clientX: number, clientY: number) {
		const job = jobs.find((j: any) => j.id === jobId);
		if (!job) return;

		const dropTarget = document.elementFromPoint(clientX, clientY);
		const monthPickerDay = dropTarget?.closest('.month-picker__day');
		if (!monthPickerDay) return;

		const dateStr = monthPickerDay.getAttribute('data-date');
		if (!dateStr) return;

		const originalStart = new Date(job.start);
		const newDate = parseLocalDate(dateStr);

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (newDate < today) {
			toast.error('Cannot move job to a past date');
			return;
		}

		newDate.setHours(originalStart.getHours(), originalStart.getMinutes());

		let newEnd = null;
		if (job.end) {
			const originalEnd = new Date(job.end);
			if (!isNaN(originalEnd.getTime())) {
				const duration = originalEnd.getTime() - originalStart.getTime();
				newEnd = new Date(newDate.getTime() + duration);
			}
		}

		try {
			await updateJobDates(jobId, newDate, newEnd);
			applyOptimisticDatePatch(jobId, newDate, newEnd);
			await handleDateSelect(dateStr);
		} catch (e) {
			toast.error('Failed to move job');
		}
	}

	$effect(() => {
		if (calendarInitialized || dayApi) {
			return;
		}

		calendarInitialized = true;

		let api: Calendar | null = null;

		const container = dayEl;
		if (!container) {
			calendarInitialized = false;
			return;
		}

		loadData().then(() => {
			if (api || !container.isConnected || dayApi) {
				return;
			}

			api = new Calendar(container, {
				plugins: [timeGridPlugin, dayGridPlugin, interactionPlugin],
				initialView: isMobile
					? getMobileCalendarView(isMobileLandscape)
					: currentView,
				initialDate: parseLocalDate(selectedDate),
				headerToolbar: false,
				// === AI / AGENTS: DO NOT CHANGE CALENDAR HEIGHT ===
				// Initial mobile '100%' is only a bootstrap value. After render we ALWAYS
				// setOption('height', 'auto') so the full day timegrid can size to content.
				// Keeping height at '100%', switching to parent-locked 100dvh shells, or
				// "pin the header with a fixed-height FC" has made the calendar DISAPPEAR
				// multiple times. Do not "fix" sticky day headers by rewriting height.
				// Sticky/pin UX must not depend on height:100% or max-height viewport locks.
				height: isMobile ? '100%' : 'auto',
				allDaySlot: false,
				slotMinTime: calendarSlotBounds.slotMinTime,
				slotMaxTime: calendarSlotBounds.slotMaxTime,
				nowIndicator: true,
				expandRows: false,
				editable: true,
				// Mobile portrait: 1 day. Mobile landscape: 3-day time grid (same touch DnD/resize model).
				views: {
					[MOBILE_VIEW_THREE_DAY]: {
						type: 'timeGrid',
						duration: { days: 3 },
						buttonText: '3 day',
						dayHeaderFormat: {
							weekday: 'short',
							month: 'numeric',
							day: 'numeric',
							omitCommas: true
						}
					}
				},
				// Mobile: long-press any movable card to drag (Google Calendar style).
				// Duration resize uses custom edge pills only — FC duration edit stays off on touch.
				eventStartEditable: true,
				eventDurationEditable: !isMobile,
				// Mobile uses custom edge pills; keep false so FC resize never fights custom gesture.
				eventResizableFromStart: false,
				// Drag-to-create ranges fight with day swipes on touch; use dateClick only.
				selectable: !isMobile,
				dragScroll: true,
				snapDuration: '00:30:00',
				// Modest min distance after long-press: enough to ignore jitter, not fight the drag.
				eventDragMinDistance: isMobile ? MOBILE_EVENT_DRAG_MIN_DISTANCE_PX : 10,
				// ~320ms long-press matches Material / Google Calendar "press then drag".
				eventLongPressDelay: isMobile ? MOBILE_EVENT_LONG_PRESS_MS : 280,
				selectLongPressDelay: isMobile ? 1000 : 280,
				longPressDelay: isMobile ? MOBILE_EVENT_LONG_PRESS_MS : 280,

				dateClick: (info) => {
					if (isMobile && suppressNextDateClick) {
						suppressNextDateClick = false;
						return;
					}
					if (isMobile && selectedMobileEventId) {
						clearMobileEventSelection();
						return;
					}
					openJobModal({ start: info.date }, () => refreshAfterUpdate());
				},

				eventDidMount: (info) => {
					focusHighlightedEvent(info);

					// )=- Do NOT set draggable="true" here. It enables native HTML5 drag which interferes with FullCalendar's own drag system (editable events), causing D&D to not work or behave erratically (native vs FC drag fighting).
					// The visual drag handle + CSS hover is sufficient for UX. FC handles the actual drag start internally on the event.
					// This was likely contributing to "Drag and drop isn't working".
					// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
					info.el.classList.add('fc-event--draggable');

					// Only create the drag handle once per event element (idempotent).
					// Previously this + avatars were recreated on every refetch, contributing to "refreshing" feel and memory churn.
					const isTimeGrid = isTimeGridViewType(info.view.type);

					clearMobileResizePreviewStyles(info.el);

					// Mobile day + landscape 3-day: same select / long-press move / edge-resize chrome.
					if (isMobile && isTimeGrid) {
						setupMobileEventTouchZones(info);
						if (selectedMobileEventId === info.event.id) {
							info.el.classList.add('fc-event--mobile-selected');
						}
					}

					// )=- Force the area color on the event element in didMount.
					// This ensures colors show immediately even if the events function provided a default
					// backgroundColor before optionsStore.data was ready on initial load.
					// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
					const jobForColor = info.event.extendedProps;
					const areaColor = getJobColor(jobForColor);
					info.el.style.backgroundColor = areaColor;
					if (areaColor !== '#6b7280') {
						info.el.style.borderColor = areaColor;
					}

					// )=- Crew avatars: left rail inside the card (overflow:hidden so concurrent
					// stacks use FC harness z-index only — no faces/titles punching through).
					// Size: default 48px; shrink by height/width but never remove.
					// Month: compact inline after title. Uses crewPhotoMap; letter fallback if no photo.
					const crew = info.event.extendedProps?.assignedCrew || [];
					if (crew.length > 0) {
						const prev = info.el.querySelector('.fc-event__crew-avatars');
						if (prev) prev.remove();
						info.el.classList.remove(
							'fc-event--avatar-xs',
							'fc-event--avatar-sm',
							'fc-event--avatar-md',
							'fc-event--avatar-narrow',
							'fc-event--avatar-tight',
							'fc-event--has-crew-avatars'
						);

						const crewEl = document.createElement('div');
						crewEl.className = 'fc-event__crew-avatars';
						crewEl.setAttribute('aria-label', `Crew: ${crew.join(', ')}`);

						const isMonthView =
							info.view.type === 'dayGridMonth' ||
							!!info.el.closest('.fc-dayGridMonth-view') ||
							!!info.el.closest('.fc-daygrid-month');

						if (isMonthView) {
							crewEl.classList.add('fc-event__crew-avatars--inline');
						} else if (isTimeGrid) {
							info.el.classList.add('fc-event--has-crew-avatars');
							// Scale by height (short jobs) and width (concurrent stack columns).
							// Multi-crew stacks shrink sooner so faces stay inside overflow:hidden cards.
							const multi = crew.length > 1;
							const applyAvatarSizeClass = () => {
								const h = info.el.offsetHeight || 0;
								const w = info.el.offsetWidth || 0;
								info.el.classList.remove(
									'fc-event--avatar-xs',
									'fc-event--avatar-sm',
									'fc-event--avatar-md',
									'fc-event--avatar-narrow',
									'fc-event--avatar-tight'
								);
								// Slightly lower thresholds; multi-crew is even more aggressive.
								const xsH = multi ? 56 : 48;
								const smH = multi ? 88 : 76;
								const mdH = multi ? 110 : 100;
								if (h > 0 && h < xsH) info.el.classList.add('fc-event--avatar-xs');
								else if (h > 0 && h < smH) info.el.classList.add('fc-event--avatar-sm');
								else if (h > 0 && h < mdH) info.el.classList.add('fc-event--avatar-md');

								if (w > 0 && w < 48) info.el.classList.add('fc-event--avatar-tight');
								else if (w > 0 && w < 80) info.el.classList.add('fc-event--avatar-narrow');
							};
							applyAvatarSizeClass();
							requestAnimationFrame(applyAvatarSizeClass);
						}

						if (crew.length > 1) {
							crewEl.classList.add('fc-event__crew-avatars--multi');
						}

						crew.forEach((name: string) => {
							const av = document.createElement('div');
							av.className = 'fc-event__crew-avatar';
							av.title = name;

							const photo = crewPhotoMap[name];
							if (photo) {
								const img = document.createElement('img');
								img.src = photo;
								img.alt = name;
								av.appendChild(img);
							} else {
								av.textContent = (name || '?').charAt(0).toUpperCase();
							}
							crewEl.appendChild(av);
						});

						if (isMonthView) {
							const titleEl = info.el.querySelector('.fc-event-title');
							if (titleEl && titleEl.parentNode) {
								titleEl.parentNode.insertBefore(crewEl, titleEl.nextSibling);
							} else {
								info.el.appendChild(crewEl);
							}
						} else if (isTimeGrid) {
							// Left rail: insert before main frame content.
							const main = info.el.querySelector('.fc-event-main');
							if (main) {
								main.insertBefore(crewEl, main.firstChild);
							} else {
								info.el.appendChild(crewEl);
							}
						} else {
							info.el.appendChild(crewEl);
						}
					}
				},

				eventClassNames: (arg) => {
					const classes: string[] = [];
					const status = arg.event.extendedProps?.status;
					if (status === 'completed') classes.push('event-completed');
					if (status === 'cancelled') classes.push('event-cancelled');
					if (jobMatchesHighlight(arg.event.id, arg.event.extendedProps)) {
						classes.push('event-highlighted');
					}
					return classes;
				},

				eventAllow: (dropInfo, draggedEvent) => {
					const status = draggedEvent.extendedProps?.status;
					return status !== 'completed' && status !== 'cancelled';
				},

				eventDragStart: (info) => {
					const status = info.event.extendedProps?.status;

					if (status === 'completed' || status === 'cancelled') {
						toast.error('Cannot move cancelled or completed jobs');
						info.event.setProp('startEditable', false);
						return;
					}

					suppressNextEventClick = true;
					beginCalendarInteraction();
					draggedJobId = info.event.id!;
					// Must be true before HUD loop / pointer tracking so live updates run.
					appointmentDragActive = true;
					startAppointmentDragToMonthTracking();

					// Capture pre-drag geometry for floating-mirror height (duration visual).
					// Prefer duration × slot height over getBoundingClientRect when the card is
					// partially clipped by the scroller — clipped rects look like ~1h.
					originalEventRect = info.el.getBoundingClientRect();
					const startForHeight = info.event.start ? new Date(info.event.start) : new Date();
					const endForHeight = info.event.end
						? new Date(info.event.end)
						: new Date(startForHeight.getTime() + 60 * 60 * 1000);
					const harnessForMetrics = info.el.closest(
						'.fc-timegrid-event-harness'
					) as HTMLElement | null;
					const { slotHeight, slotMs } = getMobileSlotMetrics(harnessForMetrics);
					const durationMs = Math.max(
						endForHeight.getTime() - startForHeight.getTime(),
						slotMs
					);
					const durationHeightPx = (durationMs / slotMs) * slotHeight;
					const dragHeightPx = Math.max(
						originalEventRect.height,
						durationHeightPx,
						24
					);
					document.documentElement.style.setProperty(
						'--mobile-drag-mirror-height',
						`${dragHeightPx}px`
					);

					// Mobile: long-press grab selects the card + live time HUD (range + duration).
					if (isMobile && info.event.id) {
						selectMobileEvent(info.event.id, info.el, { haptic: false });
						mobileHaptic(16);
						startMobileDragHudLoop(info.event.id, startForHeight, endForHeight);
						const { y } = getEventClientCoords(info.jsEvent);
						if (y) {
							ensureMobileEdgeAutoScrollRunning(y);
							updateMobileDragHudFromPointer(y);
						}
						// Raise the dragged source + mirror above stacked neighbors.
						info.el.style.zIndex = '1000';
						if (harnessForMetrics) harnessForMetrics.style.zIndex = '1000';
						// Keep duration height on any floating mirror clone FC may show.
						requestAnimationFrame(() => preserveMobileDragMirrorHeight(dragHeightPx));
					}
				},

				eventDragStop: (info) => {
					// Snapshot before hideMobileGestureHud() clears live preview meta.
					const pendingDrag = mobileDragMeta
						? {
								eventId: mobileDragMeta.eventId,
								start: new Date(mobileDragMeta.start),
								end: new Date(mobileDragMeta.end),
								originalStart: new Date(mobileDragMeta.originalStart),
								originalEnd: new Date(mobileDragMeta.originalEnd)
							}
						: null;

					stopAppointmentDragToMonthTracking();
					appointmentDragActive = false;
					hideMobileGestureHud();
					info.el.style.removeProperty('z-index');
					const harness = info.el.closest('.fc-timegrid-event-harness') as HTMLElement | null;
					harness?.style.removeProperty('z-index');
					endCalendarInteraction();
					originalEventRect = null;
					// Avoid opening the job modal from the pointerup that ends a drag.
					suppressNextEventClick = true;
					window.setTimeout(() => {
						suppressNextEventClick = false;
					}, 320);

					if (!draggedJobId) return;

					// Use robust extractor so external drop (to MonthPicker) and cross-view move works on touch devices.
					// Without this, mobile hold-to-drag to the monthly picker always "snaps back" because hit-test fails.
					const { x: clientX, y: clientY } = getEventClientCoords(info.jsEvent);

					const monthPickerEl = document.querySelector('.month-picker');
					let monthPickerDay: Element | null | undefined = null;

					if (monthPickerEl) {
						let dropTarget = document.elementFromPoint(clientX, clientY);
						monthPickerDay = dropTarget?.closest('.month-picker__day');

						if (!monthPickerDay) {
							const rect = monthPickerEl.getBoundingClientRect();
							const isOverContainer =
								clientX >= rect.left &&
								clientX <= rect.right &&
								clientY >= rect.top &&
								clientY <= rect.bottom;

							if (isOverContainer) {
								const dayElements = monthPickerEl.querySelectorAll('.month-picker__day');
								for (const el of dayElements) {
									const r = el.getBoundingClientRect();
									if (
										clientX >= r.left &&
										clientX <= r.right &&
										clientY >= r.top &&
										clientY <= r.bottom
									) {
										monthPickerDay = el;
										break;
									}
								}
							}
						}
					}

					if (monthPickerDay) {
						isExternalDrop = true;
						handleExternalDrop(draggedJobId, clientX, clientY);
					} else if (isMobile && pendingDrag && info.event) {
						// Drop on bottom nav / outside the time grid: FC reverts — commit HUD times instead.
						if (isPointOutsideCalendarTimeGrid(clientX, clientY)) {
							void commitMobileDragPreview(pendingDrag, info.event);
						}
						// Stay selected so resize handles remain available.
						if (info.event.id) {
							selectMobileEvent(info.event.id, info.el, { haptic: false });
						}
					} else if (isMobile && info.event.id) {
						selectMobileEvent(info.event.id, info.el, { haptic: false });
					}

					draggedJobId = null;
				},

				select: (info) => {
					if (isMobile) return;
					openJobModal({ start: info.start, end: info.end }, () => refreshAfterUpdate());
				},

				eventClick: (info) => {
					if (isMobile && suppressNextEventClick) {
						suppressNextEventClick = false;
						return;
					}

					if (isMobile && isMobileGestureChromeTarget(info.jsEvent.target)) {
						return;
					}

					if (isMobile) {
						const pointer = mobileEventPointer;
						mobileEventPointer = null;
						// Finger slid while pressing — treat as drag intent, not a second-tap open.
						if (pointer?.eventId === info.event.id && pointer.moved) {
							if (selectedMobileEventId !== info.event.id) {
								clearJobHighlight();
								selectMobileEvent(info.event.id!, info.el);
							}
							return;
						}

						if (selectedMobileEventId === info.event.id) {
							clearMobileEventSelection();
							clearJobHighlight();
							openJobModal(info.event.extendedProps, () => refreshAfterUpdate());
							return;
						}

						clearJobHighlight();
						selectMobileEvent(info.event.id!, info.el);
						return;
					}

					clearJobHighlight();
					openJobModal(info.event.extendedProps, () => refreshAfterUpdate());
				},

				eventResizeStart: (info) => {
					beginCalendarInteraction();
				},

				eventResizeStop: () => {
					endCalendarInteraction();
				},

				eventDrop: async (info) => {
					if (isExternalDrop) {
						isExternalDrop = false;
						return;
					}
					try {
						await updateJobDates(info.event.id!, info.event.start!, info.event.end!);
						// Phase 1: optimistic patch to our jobs $state source (drives MonthPicker + future provider calls).
						// Do NOT refetch here — FullCalendar has already committed the visual move/resize for this event
						// as part of the gesture. Calling refetch immediately can cause the placement to "reload" or snap
						// due to timing with $derived + provider. We rely on the source update + FC's own handling.
						// This eliminates the constant refresh feel on drag and reduces eventDidMount churn + memory.
						applyOptimisticDatePatch(info.event.id!, info.event.start!, info.event.end!);
						if (isMobile && info.event.start) {
							const end =
								info.event.end ??
								new Date(info.event.start.getTime() + 60 * 60 * 1000);
							mobileHaptic([10, 40, 14]);
							toast.success(
								`Moved · ${formatMobileTimeRange(info.event.start, end)}`
							);
						}
					} catch (e) {
						info.revert();
						toast.error('Could not move appointment');
					}
				},

				eventResize: async (info) => {
					try {
						await updateJobDates(info.event.id!, info.event.start!, info.event.end!);
						// Phase 1: same as drop — optimistic source update, no immediate refetch to avoid interrupting the resize gesture.
						applyOptimisticDatePatch(info.event.id!, info.event.start!, info.event.end!);
					} catch (e) {
						info.revert();
						toast.error('Could not resize appointment');
					}
				},

				eventsSet: () => {
					scheduleHighlightJumpFallback();
				},

				events: (fetchInfo, successCallback) => {
					let visibleJobs = filteredJobs;

					// Day / mobile 3-day: feed only jobs overlapping the visible FC range
					// (portrait = 1 day, landscape = 3 days). Week/month desktop get full filtered set.
					const activeView = dayApi?.view?.type ?? currentView;
					if (isMobile || isMobileStyleViewType(activeView) || activeView === 'timeGridDay') {
						const rangeStartMs = fetchInfo.start.getTime();
						const rangeEndMs = fetchInfo.end.getTime();
						visibleJobs = filteredJobs.filter((job: any) => {
							const jobStart = new Date(job.start).getTime();
							if (Number.isNaN(jobStart)) return false;
							const jobEndRaw = job.end ? new Date(job.end).getTime() : jobStart;
							const jobEnd = Number.isNaN(jobEndRaw) ? jobStart : jobEndRaw;
							// Interval overlap with FullCalendar's [start, end) visible range.
							return jobStart < rangeEndMs && jobEnd >= rangeStartMs;
						});
					}

					successCallback(
						visibleJobs.map((job: any) => {
							// Always supply an end so FC never falls back to defaultTimedEventDuration (1h)
							// during drag mirror mutations for jobs that only have a start.
							const start = job.start;
							let end = job.end;
							if (!end && start) {
								const s = new Date(start);
								if (!Number.isNaN(s.getTime())) {
									end = new Date(s.getTime() + 60 * 60 * 1000).toISOString();
								}
							}
							return {
								id: job.id,
								// )=- Title is now just the job title; crew members are shown as circular avatars on the right (see eventDidMount).
								title: job.title,
								start,
								end,
								backgroundColor: getJobColor(job),
								extendedProps: job
							};
						})
					);
				}
			});

			dayApi = api; // expose the local instance to other effects (refetch, etc.)
			ensureMobileBackgroundDeselectListener();
			ensureMobileCalendarView();

			api.render();

			requestAnimationFrame(() => {
				api?.updateSize();
				// === AI / AGENTS: DO NOT CHANGE — always 'auto' after init (mobile + desktop). ===
				// only once, during initial creation. Repeated setOption height / updateSize from
				// observers caused idle "refreshing". Never keep mobile on height:'100%' here —
				// that + a constrained parent collapses the calendar to nothing.
				api?.setOption('height', 'auto');
				ensureMobileCalendarView();
				api?.gotoDate(parseLocalDate(selectedDate));
				if (highlightJobId) {
					api?.refetchEvents();
					scheduleHighlightJumpFallback();
				}
			});
		});

		return () => {
			// Do NOT reset calendarInitialized here.
			// (See comment at declaration for why.)
			teardownMobileBackgroundListeners();
			stopAppointmentDragToMonthTracking();
			clearMobileResizeListeners();
			hideMobileGestureHud();
			mobileGestureHudEl?.remove();
			mobileGestureHudEl = null;
			activeMobileResize = null;
			appointmentDragActive = false;
			calendarInteractionDepth = 0;
			clearMobileEventSelection();
			if (api) {
				api.destroy();
				api = null;
			}
			if (dayApi) {
				dayApi = null;
			}
			// )=- Clear photo map on unmount to release any large data: URL strings and associated image bitmaps from memory (avatars can be several MB each when decoded).
			// The map will be repopulated on next mount via loadData before calendar creation.
			// Helps prevent accumulation over long sessions or repeated mount/unmount.
			// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
			crewPhotoMap = {};
		};
	});

	// )=- Cleaned up stray duplicate calendar init (the second new Calendar + its raf/closings) that was left outside any $effect after a previous edit. The single version inside the $effect now has the destroy return (for isConnected fix), the full eventDidMount (drag handle + area color force + circular crew avatars using crewPhotoMap), modern title-only events mapper, and the explicit post-render refetch. This resolves the Rolldown "Unexpected token" that killed the Railway build.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	function registerMonthNavigator(fn: (delta: number) => void) {
		stepMonthPicker = fn;
	}

	function handleVisibleMonthChange(year: number, month: number) {
		visiblePickerYear = year;
		visiblePickerMonth = month;

		if (visibleMonthReloadTimer) clearTimeout(visibleMonthReloadTimer);
		visibleMonthReloadTimer = setTimeout(async () => {
			visibleMonthReloadTimer = null;
			if (!calendarJobsRangeNeedsReload()) return;
			await reloadJobsForCalendarRange();
		}, 150);
	}

	async function handleDateSelect(dateStr: string) {
		clearJobHighlight();
		clearJumpCancelledMode();
		selectedDate = dateStr;
		syncDateToUrl(dateStr);

		if (calendarJobsRangeNeedsReload(dateStr)) {
			await reloadJobsForCalendarRange(dateStr);
		}

		if (dayApi) {
			dayApi.gotoDate(parseLocalDate(dateStr));
			dayApi.refetchEvents();
		}
	}

	// )=- Minor enhancement for Phase 7 "Minor calendar date-focus support if missing".
	// When the user changes the focused date (via MonthPicker or other), we now update the ?date= param
	// in the URL using replaceState. This makes "Jump to calendar" links from JobDetailsModal (and direct
	// deep links) more useful — the address bar always reflects the current focused day, and the link
	// remains stable if the user browses other dates then comes back.
	// The existing initial load from window.location.search + gotoDate on first render already provides
	// the core focus behavior. This is the "minor" polish to make the feature bidirectional and robust.
	// Uses the same safe local date helpers (parseLocalDate / getLocalDateString) to stay consistent
	// with our recent TZ fixes for due/paid dates.
	// )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 + Remedine/Svelte_FullCalendar_Dexie_Scheduling
	function syncDateToUrl(dateStr: string) {
		if (typeof window === 'undefined') return;
		const url = new URL(window.location.href);
		url.searchParams.set('date', dateStr);
		url.searchParams.delete('jobId');
		url.searchParams.delete('status');
		// replaceState keeps browser back/forward clean (no history spam for every date click)
		window.history.replaceState({}, '', url.pathname + url.search);
	}
</script>

<div
	class="split-calendar-container"
	class:split-calendar-container--mobile={isMobile}
	class:split-calendar-container--three-day={isMobile && isMobileLandscape}
>
	<div class="split-calendar">
		<!-- Sidebar -->
		<div class="split-calendar__sidebar">
			<MonthPicker
				jobs={filteredJobs}
				bind:selectedDate
				onDateSelect={handleDateSelect}
				onVisibleMonthChange={handleVisibleMonthChange}
				dragHoverDateStr={dragHoverDateStr}
				appointmentDragActive={appointmentDragActive}
				onRegisterNavigator={registerMonthNavigator}
			/>

			<!-- Filters -->
			<div class="split-calendar__filters">
				<details bind:open={filtersOpen} class="split-calendar__filters-details">
					<summary class="split-calendar__filters-summary" aria-expanded={filtersOpen}>
						<span class="split-calendar__filters-summary-label">Filters</span>
						{#if activeFilterCount > 0}
							<span class="split-calendar__filters-badge">{activeFilterCount}</span>
						{/if}
						<span class="split-calendar__filters-arrow" aria-hidden="true">{filtersOpen ? '▾' : '▸'}</span>
					</summary>

					<div class="split-calendar__filters-body">
						<!-- Crew: avatar row, highlight border when selected -->
						<details class="split-calendar__filter-section" open>
							<summary class="split-calendar__filter-section-summary">
								<span class="split-calendar__filter-group-label">Crew</span>
								<span class="split-calendar__filter-section-arrow" aria-hidden="true"></span>
							</summary>
							<div class="split-calendar__filter-section-body">
								<div class="split-calendar__crew-avatars">
									{#each crewOptions as crew (crew)}
										<button
											type="button"
											class="split-calendar__crew-avatar"
											class:split-calendar__crew-avatar--selected={filters.crew.includes(crew)}
											onclick={() => toggleFilter('crew', crew)}
											title={crew}
											aria-label={crew}
											aria-pressed={filters.crew.includes(crew)}
										>
											{#if crewPhotoMap[crew]}
												<img src={crewPhotoMap[crew]} alt="" />
											{:else}
												<span class="split-calendar__crew-avatar-initial">
													{(crew || '?').charAt(0).toUpperCase()}
												</span>
											{/if}
										</button>
									{/each}
								</div>
							</div>
						</details>

						<!-- Area: colored tokens (matches clients/jobs pages) -->
						<details class="split-calendar__filter-section" open>
							<summary class="split-calendar__filter-section-summary">
								<span class="split-calendar__filter-group-label">Area</span>
								<span class="split-calendar__filter-section-arrow" aria-hidden="true"></span>
							</summary>
							<div class="split-calendar__filter-section-body">
								<div class="split-calendar__area-chips">
									{#each optionsStore.data?.areasOfTown || [] as area (area.id)}
										<button
											type="button"
											class="area-chip"
											class:active={filters.areas.includes(area.id)}
											onclick={() => toggleFilter('areas', area.id)}
											style="background-color: {area.color}20; color: {area.color}; border-color: {area.color};"
										>
											{area.label}
										</button>
									{/each}
								</div>
							</div>
						</details>

						<!-- Status -->
						<details class="split-calendar__filter-section" open>
							<summary class="split-calendar__filter-section-summary">
								<span class="split-calendar__filter-group-label">Status</span>
								<span class="split-calendar__filter-section-arrow" aria-hidden="true"></span>
							</summary>
							<div class="split-calendar__filter-section-body">
								<div class="split-calendar__status-chips">
									{#each ['scheduled', 'completed', 'cancelled'] as status}
										<button
											type="button"
											class="split-calendar__status-chip split-calendar__status-chip--{status}"
											class:split-calendar__status-chip--active={filters.statuses.includes(status)}
											onclick={() => toggleFilter('statuses', status)}
											aria-pressed={filters.statuses.includes(status)}
										>
											{#if filters.statuses.includes(status)}
												<span class="split-calendar__status-chip-check" aria-hidden="true">✓</span>
											{/if}
											{status}
										</button>
									{/each}
								</div>
							</div>
						</details>

						{#if activeFilterCount > 0}
							<button class="split-calendar__filters-clear-btn" onclick={clearFilters}>
								Clear all filters
							</button>
						{/if}
					</div>
				</details>
			</div>
		</div>

		<!-- Main Calendar -->
		<div class="split-calendar__main">
			<div class="split-calendar__view-switcher" class:split-calendar__view-switcher--mobile-hidden={isMobile}>
				<button
					class="split-calendar__view-btn"
					class:split-calendar__view-btn--active={currentView === 'timeGridDay'}
					onclick={() => changeView('timeGridDay')}>Day</button
				>
				{#if !isMobile}
					<button
						class="split-calendar__view-btn"
						class:split-calendar__view-btn--active={currentView === 'timeGridWeek'}
						onclick={() => changeView('timeGridWeek')}>Week</button
					>
					<button
						class="split-calendar__view-btn"
						class:split-calendar__view-btn--active={currentView === 'dayGridMonth'}
						onclick={() => changeView('dayGridMonth')}>Month</button
					>
				{/if}
			</div>

			<div class="split-calendar__day-wrapper" class:refreshing={isSyncing} bind:this={dayWrapperEl}>
				{#if isMobile && selectedMobileEventId && !appointmentDragActive}
					<div class="split-calendar__gesture-hint" role="status">
						Hold card to move · Drag edges to resize · Tap again to open
					</div>
				{/if}
				<div class="split-calendar__day" bind:this={dayEl}></div>
			</div>
		</div>
	</div>
</div>

<style>
	.split-calendar-container {
		container-type: inline-size;
		container-name: split-calendar;
		width: 100%;
		height: auto;
	}

	/* Class-based mobile (includes phone landscape when width > 768). */
	.split-calendar-container--mobile {
		height: 100%;
		min-height: 0;
	}

	@media (max-width: 768px), (orientation: landscape) and (max-height: 500px) {
		.split-calendar-container {
			height: 100%;
			min-height: 0;
		}
	}

	.split-calendar {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: 100%;
		height: auto;
		min-width: 0;
	}

	/* Desktop layout */
	@container split-calendar (min-width: 900px) {
		.split-calendar {
			flex-direction: row;
			gap: var(--space-6);
			align-items: flex-start; /* allow main column to grow taller than sidebar */
			height: auto; /* let content determine height */
		}

		.split-calendar__sidebar {
			flex: 0 0 340px;
			flex-shrink: 0;
			width: auto;
			max-width: 340px;
			align-self: flex-start; /* don't stretch to force short height */
		}

		.split-calendar__main {
			flex: 1;
			min-width: 0;
			min-height: 0;
		}
	}

	.split-calendar__sidebar {
		width: 100%;
	}

	.split-calendar__main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		min-height: 0;
		height: auto;
	}

	.split-calendar__view-switcher {
		display: flex;
		gap: var(--space-1);
	}

	@container split-calendar (min-width: 900px) {
		.split-calendar__view-switcher {
			display: flex;
		}
	}

	/* Completely hide the (now mostly empty) view switcher on mobile — Day / 3-day is orientation-driven */
	.split-calendar__view-switcher--mobile-hidden {
		display: none;
	}

	.split-calendar__view-btn {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		cursor: pointer;
		color: var(--color-text);
	}

	.split-calendar__view-btn:hover {
		background: var(--color-surface-alt);
	}

	.split-calendar__view-btn--active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.split-calendar__day-wrapper {
		flex: 1 0 auto; /* grow with content, don't shrink below natural size */
		min-height: 300px;
		display: flex;
		flex-direction: column;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		overflow: hidden; /* clip inner content to rounded edges */
		transition: opacity 0.2s ease;
		width: 100%; /* Helps FullCalendar detect size changes */
		margin-bottom: var(--space-4); /* extra gap below the calendar box itself so it doesn't hit page bottom */
	}

	/* === Mobile day / landscape 3-day layout (anchored top MonthPicker + scrolling time slots) === */
	/* Class-based so phone landscape (width often > 768) keeps the same mobile shell as portrait.
	   Portrait: 1 day. Landscape: 3-day time grid. Touch DnD / edge resize / day swipe unchanged.
	   BEM + tokens. */
	.split-calendar-container--mobile .split-calendar {
		gap: var(--space-2);
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.split-calendar-container--mobile .split-calendar__sidebar {
		/* Only the compact MonthPicker is shown at top; filters moved out of way.
		   Force full-width column sizing even when the container is wide enough that
		   the desktop @container (min-width: 900px) sidebar rules would otherwise apply
		   (common on phone landscape). */
		margin-bottom: 0;
		flex: 0 0 auto;
		flex-shrink: 0;
		width: 100%;
		max-width: none;
		align-self: stretch;
		position: relative;
		z-index: 2;
	}

	/* Hide the big filters panel on mobile day view (user can still use on desktop) */
	.split-calendar-container--mobile .split-calendar__filters {
		display: none;
	}

	.split-calendar-container--mobile .split-calendar__main {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.split-calendar-container--mobile .split-calendar__day-wrapper {
		flex: 1;
		min-height: 0;
		overflow-y: auto; /* internal scroll for the day's time slots */
		-webkit-overflow-scrolling: touch;
		/* Vertical scroll only — horizontal gestures stay available for day swipe nav. */
		touch-action: pan-y;
		overscroll-behavior-x: contain;
		margin-bottom: 0;
		border-radius: var(--radius-md);
	}

	/* Make the FC container inside fill remaining height (sibling gesture hint can sit above).
	   AI / AGENTS: keep height:auto here. Do not force height:100% on .day / .fc to "pin" headers. */
	.split-calendar-container--mobile .split-calendar__day {
		flex: 1 1 auto;
		min-height: 0;
		height: auto;
		touch-action: pan-y;
	}

	/* FullCalendar's internal scroller also claims touches by default; lock it to pan-y
	   so left/right swipes are not cancelled mid-gesture by the browser scroll takeover. */
	.split-calendar-container--mobile :global(.split-calendar__day .fc-scroller),
	.split-calendar-container--mobile :global(.split-calendar__day .fc-timegrid-body),
	.split-calendar-container--mobile :global(.split-calendar__day .fc-timegrid-cols),
	.split-calendar-container--mobile :global(.split-calendar__day .fc-timegrid-col-frame),
	.split-calendar-container--mobile :global(.split-calendar__day .fc-timegrid-col-bg),
	.split-calendar-container--mobile :global(.split-calendar__day .fc-timegrid-col-events),
	.split-calendar-container--mobile :global(.split-calendar__day .fc-timegrid-slot) {
		touch-action: pan-y;
	}

	/* Day/date header sticks to the top of the day-wrapper scroller while slots scroll under it.
	   Intermediate overflow:hidden on .split-calendar__day / .fc would trap sticky, so open those. */
	.split-calendar-container--mobile .split-calendar__day,
	.split-calendar-container--mobile :global(.fc) {
		overflow: visible;
	}

	.split-calendar-container--mobile :global(.fc-scrollgrid > thead),
	.split-calendar-container--mobile :global(.fc-scrollgrid-section-header) {
		position: sticky;
		top: 0;
		z-index: 6;
	}

	.split-calendar-container--mobile :global(.fc-scrollgrid > thead),
	.split-calendar-container--mobile :global(.fc-scrollgrid-section-header),
	.split-calendar-container--mobile :global(.fc-scrollgrid-section-header > th),
	.split-calendar-container--mobile :global(.fc-col-header),
	.split-calendar-container--mobile :global(.fc-col-header-cell),
	.split-calendar-container--mobile :global(.fc-timegrid-axis) {
		background: var(--color-surface);
	}

	/* Keep today header tint above the solid sticky fill. */
	.split-calendar-container--mobile :global(.fc-col-header-cell.fc-day-today) {
		background: color-mix(in srgb, var(--color-primary) 28%, var(--color-surface)) !important;
	}

	.split-calendar-container--mobile :global(.fc-scrollgrid-section-header) {
		box-shadow: 0 1px 0 var(--color-border);
	}

	/* Landscape 3-day: denser columns so three days fit without crushing touch targets too hard. */
	.split-calendar-container--three-day :global(.fc-col-header-cell-cushion) {
		font-size: 0.68rem;
		padding: 2px 1px;
		white-space: nowrap;
	}

	.split-calendar-container--three-day :global(.fc-timegrid-axis-cushion),
	.split-calendar-container--three-day :global(.fc-timegrid-slot-label-cushion) {
		font-size: 0.65rem;
		padding: 0 2px;
	}

	.split-calendar-container--three-day :global(.fc-timegrid-event) {
		font-size: 0.65rem;
	}

	.split-calendar-container--three-day :global(.fc-timegrid-event.fc-event--has-crew-avatars .fc-event-title) {
		padding-bottom: 0;
	}

	/* Dense 3-day columns: left-rail layout; faces ~30% larger than prior 18px, lighter stack. */
	.split-calendar-container--three-day :global(.fc-timegrid-event .fc-event__crew-avatar) {
		width: 24px;
		height: 24px;
		font-size: 10px;
		border-width: 1px;
	}

	.split-calendar-container--three-day
		:global(.fc-timegrid-event .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		/* ~25% overlap (was ~55%) so multi-crew is readable in narrow columns */
		margin-top: -6px;
	}

	.split-calendar-container--three-day :global(.fc-timegrid-event .fc-event__crew-avatars) {
		gap: 0;
		position: relative !important;
		right: auto !important;
		bottom: auto !important;
	}

	/* Landscape 3-day layout shell (picker flow/sticky overrides live at end of stylesheet
	   so they beat the general mobile sticky rules). */
	.split-calendar-container--three-day .split-calendar {
		gap: var(--space-1);
		/* Column layout must win over wide landscape container-query row layout. */
		flex-direction: column;
		align-items: stretch;
	}

	.split-calendar-container--three-day .split-calendar__main {
		position: relative;
		z-index: 0;
		/* Leave clear space below the picker; never sit under sticky paint. */
		margin-top: 0;
	}

	@media (max-width: 768px), (orientation: landscape) and (max-height: 500px) {
		.split-calendar {
			gap: var(--space-2);
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}

		.split-calendar__sidebar {
			margin-bottom: 0;
			flex-shrink: 0;
		}

		.split-calendar__filters {
			display: none;
		}

		.split-calendar__main {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}

		.split-calendar__day-wrapper {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			-webkit-overflow-scrolling: touch;
			touch-action: pan-y;
			overscroll-behavior-x: contain;
			margin-bottom: 0;
			border-radius: var(--radius-md);
		}

		.split-calendar__day {
			flex: 1 1 auto;
			min-height: 0;
			height: auto;
			touch-action: pan-y;
		}

		:global(.split-calendar__day .fc-scroller),
		:global(.split-calendar__day .fc-timegrid-body),
		:global(.split-calendar__day .fc-timegrid-cols),
		:global(.split-calendar__day .fc-timegrid-col-frame),
		:global(.split-calendar__day .fc-timegrid-col-bg),
		:global(.split-calendar__day .fc-timegrid-col-events),
		:global(.split-calendar__day .fc-timegrid-slot) {
			touch-action: pan-y;
		}
	}

	/* Better density and readability on small screens for the day schedule view */
	@media (max-width: 480px) {
		:global(.fc-timegrid-slot-label) {
			font-size: 0.7rem;
		}
		:global(.fc-timegrid-event) {
			font-size: 0.75rem;
		}
	}

	/* Dark mode FullCalendar overrides (tokens + subtle area color adaptation already handled in JS) */
	:global(.dark .fc) {
		--fc-border-color: var(--color-border);
		--fc-page-bg-color: var(--color-surface);
		--fc-neutral-bg-color: var(--color-surface-alt);
		--fc-neutral-text-color: var(--color-text-muted);
	}

	/* Ensure the FullCalendar root itself has rounded corners to match the wrapper and avoid square inner box showing through */
	:global(.fc) {
		border-radius: var(--radius-lg);
		overflow: hidden;
		/* Nice blue for the active/today day instead of default yellow. Uses project tokens so it adapts to dark/light. */
		--fc-today-bg-color: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface));
		--fc-now-indicator-color: var(--color-warning);
	}

	/* Ensure the today/active day cells and headers pick up the nice blue highlight (FC sometimes needs explicit boost) */
	:global(.fc .fc-day-today) {
		background-color: var(--fc-today-bg-color) !important;
	}
	:global(.fc .fc-col-header-cell.fc-day-today) {
		background-color: color-mix(in srgb, var(--color-primary) 28%, var(--color-surface)) !important;
	}

	/* Make the day number stand out with the primary blue on the today cell (especially noticeable in month view) */
	:global(.fc-day-today .fc-daygrid-day-number) {
		color: var(--color-primary);
		font-weight: 700;
	}

	:global(.dark .fc-timegrid-slot) {
		border-color: var(--color-border) !important;
	}

	/* No internal clipping/scroll desired; calendar content should determine height and use page scroll */
	:global(.fc-timegrid-body) {
		padding-bottom: 0;
	}

	:global(.dark .fc-col-header-cell) {
		background: var(--color-surface-alt);
		border-color: var(--color-border);
	}

	:global(.dark .fc-event) {
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
	}

	.split-calendar__day-wrapper.refreshing {
		opacity: 0.6;
		pointer-events: none;
	}

	.split-calendar__day {
		flex: 1;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
		width: 100%; /* Important for responsive width */
		border-radius: var(--radius-lg); /* ensure inner mount point is also rounded */
	}

	/* Filters — BEM + full design tokens for dark mode and cohesion */
	.split-calendar__filters {
		margin-top: var(--space-4);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		font-size: var(--font-size-sm);
	}

	.split-calendar__filters-details > summary,
	.split-calendar__filter-section > summary {
		list-style: none;
	}

	.split-calendar__filters-details > summary::-webkit-details-marker,
	.split-calendar__filter-section > summary::-webkit-details-marker {
		display: none;
	}

	.split-calendar__filters-summary {
		font-weight: var(--font-weight-semibold);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		color: var(--color-text);
	}

	.split-calendar__filters-summary-label {
		flex: 1;
	}

	.split-calendar__filters-arrow,
	.split-calendar__filter-section-arrow {
		font-size: var(--font-size-xs);
		line-height: 1;
		color: var(--color-text-muted);
		flex-shrink: 0;
	}

	.split-calendar__filter-section-arrow::before {
		content: '▸';
	}

	.split-calendar__filter-section[open] > summary .split-calendar__filter-section-arrow::before {
		content: '▾';
	}

	.split-calendar__filters-body {
		margin-top: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.split-calendar__filter-section {
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--space-2);
	}

	.split-calendar__filter-section:last-of-type {
		border-bottom: none;
		padding-bottom: 0;
	}

	.split-calendar__filter-section-summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		padding: var(--space-1) 0;
		user-select: none;
	}

	.split-calendar__filter-section-summary .split-calendar__filter-group-label {
		flex: 1;
		margin-bottom: 0;
	}

	.split-calendar__filter-section-body {
		padding-top: var(--space-1);
	}

	.split-calendar__filters-badge {
		background: var(--color-primary);
		color: white;
		font-size: var(--font-size-xs);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-full);
		min-width: 18px;
		text-align: center;
		font-weight: var(--font-weight-medium);
	}

	.split-calendar__filters-clear-btn {
		margin-top: var(--space-3);
		width: 100%;
		padding: var(--space-2);
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.split-calendar__filters-clear-btn:hover {
		background: var(--color-danger);
		color: white;
	}

	.split-calendar__filter-group-label {
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-bottom: var(--space-1);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.split-calendar__crew-avatars {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.split-calendar__crew-avatar {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid transparent;
		background: var(--color-surface-alt);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		transition: border-color var(--transition-fast);
	}

	.split-calendar__crew-avatar--selected {
		border-color: var(--color-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 30%, transparent);
	}

	.split-calendar__crew-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.split-calendar__crew-avatar-initial {
		text-transform: uppercase;
	}

	.split-calendar__area-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.area-chip {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-full);
		font-size: var(--font-size-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
		border: 1px solid;
		background: var(--color-surface);
	}

	.area-chip.active {
		font-weight: var(--font-weight-semibold);
		box-shadow: 0 0 0 3px currentColor;
	}

	.split-calendar__status-chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.split-calendar__status-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-full);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		cursor: pointer;
		border: 1.5px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text-muted);
		transition:
			background var(--transition-fast),
			color var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			transform var(--transition-fast);
	}

	.split-calendar__status-chip:hover {
		border-color: var(--color-text-subtle);
		color: var(--color-text);
	}

	.split-calendar__status-chip-check {
		font-size: 0.65rem;
		font-weight: var(--font-weight-bold);
		line-height: 1;
	}

	.split-calendar__status-chip--scheduled {
		--status-chip-color: var(--color-primary-emphasis);
		--status-chip-soft: var(--color-primary-soft);
	}

	.split-calendar__status-chip--completed {
		--status-chip-color: var(--color-success);
		--status-chip-soft: var(--color-success-soft);
	}

	.split-calendar__status-chip--cancelled {
		--status-chip-color: var(--color-danger-emphasis);
		--status-chip-soft: var(--color-danger-soft);
	}

	.split-calendar__status-chip--active {
		background: var(--status-chip-soft);
		color: var(--status-chip-color);
		border-color: var(--status-chip-color);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-chip-color) 30%, transparent);
	}

	.split-calendar__status-chip--active:hover {
		color: var(--status-chip-color);
		border-color: var(--status-chip-color);
	}

	.split-calendar__status-chip:active {
		transform: scale(0.97);
	}

	/* === Visual Drag Handle (Top Right) === */
	:global(.fc-event--draggable) {
		position: relative;
	}

	/* Hide in Month view */
	:global(.fc-dayGridMonth-view .fc-event__drag-handle) {
		display: none !important;
	}

	:global(.fc-event__drag-handle) {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: grab;
		z-index: 30;
		opacity: 0.9;
		transition: opacity 0.15s ease;
		pointer-events: auto;
	}

	:global(.fc-event__drag-handle svg) {
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45));
	}

	:global(.fc-event--draggable:hover) .fc-event__drag-handle {
		opacity: 1;
	}

	:global(.fc-event__drag-handle:hover) {
		cursor: grab;
	}

	:global(.fc-event--draggable:hover) {
		box-shadow: 0 0 0 1px var(--color-primary);
	}

	/* Event status styling */
	:global(.event-completed) {
		opacity: 0.55;
	}
	:global(.event-completed .fc-event-title) {
		text-decoration: line-through;
	}
	:global(.event-cancelled) {
		opacity: 0.65;
		border-style: dashed !important;
		cursor: not-allowed;
	}
	:global(.event-cancelled .fc-event-title) {
		text-decoration: line-through;
		color: var(--color-danger-emphasis);
	}

	:global(.event-highlighted) {
		outline: 3px solid var(--color-warning);
		outline-offset: 2px;
		box-shadow:
			0 0 0 4px color-mix(in srgb, var(--color-warning) 40%, transparent),
			0 4px 14px rgb(0 0 0 / 0.25);
		z-index: 6 !important;
		animation: split-calendar-event-highlight 1.1s ease-in-out 4;
	}

	@keyframes split-calendar-event-highlight {
		0%,
		100% {
			outline-color: var(--color-warning);
			box-shadow:
				0 0 0 4px color-mix(in srgb, var(--color-warning) 40%, transparent),
				0 4px 14px rgb(0 0 0 / 0.25);
		}
		50% {
			outline-color: var(--color-primary);
			box-shadow:
				0 0 0 6px color-mix(in srgb, var(--color-primary) 35%, transparent),
				0 6px 18px rgb(0 0 0 / 0.3);
		}
	}

	/* Crew avatars — LEFT rail of each time-grid card (flex, not absolute right).
	   Always shown; short/narrow cards only scale faces down.
	   Contain paint with overflow:hidden so FC harness z-index owns concurrent stacking
	   (no avatars/titles punching through neighboring cards).
	   )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	:global(.fc-event) {
		position: relative;
	}

	:global(.fc-timegrid-event.fc-event--has-crew-avatars) {
		/* Clip to card so concurrent overlaps stack by harness z-index only */
		overflow: hidden !important;
	}

	/* Flex row: [avatars | time+title] — forces left placement regardless of FC internals */
	:global(.fc-timegrid-event.fc-event--has-crew-avatars .fc-event-main) {
		display: flex !important;
		flex-direction: row !important;
		align-items: center;
		gap: 4px;
		padding: 2px 4px 2px 3px !important;
		box-sizing: border-box;
		overflow: hidden;
		min-width: 0;
		height: 100%;
	}

	:global(.fc-timegrid-event.fc-event--has-crew-avatars .fc-event-main-frame) {
		flex: 1 1 auto;
		min-width: 0;
		order: 2;
		overflow: hidden;
	}

	:global(.fc-timegrid-event.fc-event--has-crew-avatars .fc-event-title) {
		padding-bottom: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Left rail — in document order first; never right/absolute; no local z-index elevating faces over siblings */
	:global(.fc-timegrid-event .fc-event__crew-avatars) {
		position: relative !important;
		left: auto !important;
		right: auto !important;
		top: auto !important;
		bottom: auto !important;
		transform: none !important;
		order: 1;
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		align-self: center;
		gap: 3px;
		z-index: auto;
		pointer-events: none;
		max-height: 100%;
		overflow: hidden;
		margin: 0;
	}

	/* Multi-crew: heavy stack overlap so faces fit inside short/narrow clipped cards */
	:global(.fc-event__crew-avatars--multi) {
		gap: 0;
	}

	:global(.fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		/* ~55% vertical overlap of default 38px face */
		margin-top: -20px;
	}

	/* Default face size: ~20% smaller than prior 48px */
	:global(.fc-event__crew-avatar) {
		width: 38px;
		height: 38px;
		flex-shrink: 0;
		border-radius: 50%;
		overflow: hidden;
		/* Hairline only — thick ring + outline shadow ate too much of the photo */
		border: 1px solid color-mix(in srgb, var(--color-surface) 70%, rgba(0, 0, 0, 0.35));
		background: var(--color-text-muted);
		color: var(--color-surface);
		font-size: 13px;
		font-weight: 700;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
	}

	:global(.fc-event__crew-avatar img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	/* Height tiers — ~20% smaller faces + more overlap as card shrinks */
	:global(.fc-event--avatar-md .fc-event__crew-avatar) {
		width: 29px;
		height: 29px;
		font-size: 11px;
		border-width: 1px;
	}
	:global(.fc-event--avatar-md .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: -16px;
	}

	/* Short cards: row stack with horizontal overlap (fits better than tall column stack) */
	:global(.fc-event--avatar-sm .fc-event__crew-avatars) {
		flex-direction: row;
	}
	:global(.fc-event--avatar-sm .fc-event__crew-avatar) {
		width: 22px;
		height: 22px;
		font-size: 9px;
		border-width: 1px;
	}
	:global(.fc-event--avatar-sm .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: 0;
		margin-left: -12px;
	}

	:global(.fc-event--avatar-xs .fc-event__crew-avatars) {
		flex-direction: row;
		align-self: flex-start;
	}
	:global(.fc-event--avatar-xs .fc-event__crew-avatar) {
		width: 16px;
		height: 16px;
		font-size: 8px;
		border-width: 1px;
	}
	:global(.fc-event--avatar-xs .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: 0;
		margin-left: -10px;
	}

	/* Narrow concurrent columns — still LEFT, just smaller + tighter stack */
	:global(.fc-event--avatar-narrow .fc-event__crew-avatars) {
		flex-direction: column;
	}
	:global(.fc-event--avatar-narrow .fc-event__crew-avatar) {
		width: 21px;
		height: 21px;
		font-size: 8px;
		border-width: 1px;
	}
	:global(.fc-event--avatar-narrow .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: -12px;
		margin-left: 0;
	}

	:global(.fc-event--avatar-tight .fc-event__crew-avatars) {
		flex-direction: column;
		align-self: flex-start;
	}
	:global(.fc-event--avatar-tight .fc-event__crew-avatar) {
		width: 18px;
		height: 18px;
		font-size: 7px;
		border-width: 1px;
	}
	:global(.fc-event--avatar-tight .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: -11px;
		margin-left: 0;
	}

	/* Short + multi: prefer horizontal pile even when narrow width classes also apply */
	:global(.fc-event--avatar-sm.fc-event--avatar-narrow .fc-event__crew-avatars),
	:global(.fc-event--avatar-xs.fc-event--avatar-narrow .fc-event__crew-avatars),
	:global(.fc-event--avatar-sm.fc-event--avatar-tight .fc-event__crew-avatars),
	:global(.fc-event--avatar-xs.fc-event--avatar-tight .fc-event__crew-avatars) {
		flex-direction: row;
	}
	:global(.fc-event--avatar-sm.fc-event--avatar-narrow .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar),
	:global(.fc-event--avatar-xs.fc-event--avatar-narrow .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar),
	:global(.fc-event--avatar-sm.fc-event--avatar-tight .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar),
	:global(.fc-event--avatar-xs.fc-event--avatar-tight .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: 0;
		margin-left: -10px;
	}

	/*
	 * Mobile time-grid cards: faces +30% vs desktop tiers, lighter stack so assigned
	 * crew is identifiable (portrait day + any --mobile shell; 3-day sizes set above).
	 */
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-timegrid-event .fc-event__crew-avatar) {
		width: 49px;
		height: 49px;
		font-size: 16px;
	}

	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		/* ~28% vertical overlap (was ~53% at -20px / 38px) */
		margin-top: -14px;
	}

	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-md .fc-event__crew-avatar) {
		width: 38px;
		height: 38px;
		font-size: 13px;
		border-width: 1px;
	}
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-md .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: -11px;
	}

	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-sm .fc-event__crew-avatar) {
		width: 29px;
		height: 29px;
		font-size: 11px;
	}
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-sm .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: 0;
		margin-left: -8px;
	}

	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-xs .fc-event__crew-avatar) {
		width: 21px;
		height: 21px;
		font-size: 9px;
	}
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-xs .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: 0;
		margin-left: -6px;
	}

	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-narrow .fc-event__crew-avatar) {
		width: 27px;
		height: 27px;
		font-size: 10px;
	}
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-narrow .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: -8px;
		margin-left: 0;
	}

	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-tight .fc-event__crew-avatar) {
		width: 23px;
		height: 23px;
		font-size: 9px;
	}
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-tight .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: -7px;
		margin-left: 0;
	}

	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-sm.fc-event--avatar-narrow .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar),
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-xs.fc-event--avatar-narrow .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar),
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-sm.fc-event--avatar-tight .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar),
	.split-calendar-container--mobile:not(.split-calendar-container--three-day)
		:global(.fc-event--avatar-xs.fc-event--avatar-tight .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: 0;
		margin-left: -7px;
	}

	/* Desktop (fine pointer + hover): grow face 40% on hover, pop above siblings */
	@media (hover: hover) and (pointer: fine) {
		:global(.fc-timegrid-event .fc-event__crew-avatars) {
			/* Allow hover; keep clipped until a face is hovered so concurrent cards don't bleed */
			pointer-events: auto;
		}

		:global(.fc-timegrid-event.fc-event--has-crew-avatars:has(.fc-event__crew-avatar:hover)) {
			overflow: visible !important;
			z-index: 40;
		}

		:global(.fc-timegrid-event.fc-event--has-crew-avatars:has(.fc-event__crew-avatar:hover) .fc-event-main),
		:global(.fc-timegrid-event.fc-event--has-crew-avatars:has(.fc-event__crew-avatar:hover) .fc-event__crew-avatars) {
			overflow: visible;
		}

		:global(.fc-event__crew-avatar) {
			position: relative;
			z-index: 1;
			transform: scale(1);
			transform-origin: center center;
			transition:
				transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
				box-shadow 0.22s cubic-bezier(0.22, 1, 0.36, 1),
				z-index 0s linear 0.22s;
		}

		:global(.fc-event__crew-avatar:hover) {
			transform: scale(1.4);
			z-index: 30;
			/* Apply z-index immediately on hover (override delayed leave) */
			transition:
				transform 0.22s cubic-bezier(0.22, 1, 0.36, 1),
				box-shadow 0.22s cubic-bezier(0.22, 1, 0.36, 1),
				z-index 0s;
			box-shadow:
				0 0 0 1px color-mix(in srgb, var(--color-primary) 50%, transparent),
				0 6px 16px rgba(0, 0, 0, 0.25);
		}

		/* Month chips stay compact; no grow (too dense) */
		:global(.fc-dayGridMonth-view .fc-event__crew-avatar:hover) {
			transform: none;
			z-index: 1;
			box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
		}
	}

	/* Month view: inline after title (~20% smaller) */
	:global(.fc-dayGridMonth-view .fc-event__crew-avatars),
	:global(.fc-dayGridMonth-view .fc-event__crew-avatars--inline) {
		position: static !important;
		display: inline-flex;
		flex-direction: row;
		vertical-align: middle;
		margin-left: 4px;
		gap: 0;
		transform: none !important;
		max-height: none;
		overflow: visible;
		z-index: auto;
		order: unset;
	}

	:global(.fc-dayGridMonth-view .fc-event__crew-avatar) {
		width: 11px;
		height: 11px;
		font-size: 6px;
		border-width: 1px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
	}

	:global(.fc-dayGridMonth-view .fc-event__crew-avatars--multi .fc-event__crew-avatar + .fc-event__crew-avatar) {
		margin-top: 0;
		margin-left: -5px;
	}

	/* Mobile / touch (portrait day + landscape 3-day):
	   - Tap = select (move grip + resize pills + coaching hint)
	   - Long-press any movable card = drag (Google Calendar style)
	   - Drag edge pills = resize with live HUD
	   - Second clean tap = open
	   - Swipe day grid left/right (incl. unselected cards) = next/prev day
	   Class-based so phone landscape keeps gesture chrome when width > 768.
	*/
	.split-calendar-container--mobile :global(.fc-event__drag-handle) {
		display: none !important;
	}

	.split-calendar-container--mobile :global(.fc-event--draggable) {
		/* Vertical scroll through cards; long-press claims the pointer for drag. */
		touch-action: pan-y;
	}

	.split-calendar-container--mobile :global(.fc-event--mobile-selected) {
		box-shadow:
			0 0 0 2px var(--color-primary),
			0 6px 16px rgb(0 0 0 / 0.2);
		z-index: 12;
		/* Selected: free pointer for hold-to-drag + edge resize. */
		touch-action: none;
		transform: scale(1.01);
	}

	.split-calendar-container--mobile :global(.fc-event--draggable:active:not(.fc-event-dragging)) {
		transform: scale(0.99);
	}

	@media (max-width: 768px), (orientation: landscape) and (max-height: 500px) {
		:global(.fc-event__drag-handle) {
			display: none !important;
		}

		:global(.fc-event--draggable) {
			/* Vertical scroll through cards; long-press claims the pointer for drag. */
			touch-action: pan-y;
		}

		:global(.fc-event--mobile-selected) {
			box-shadow:
				0 0 0 2px var(--color-primary),
				0 6px 16px rgb(0 0 0 / 0.2);
			z-index: 12;
			/* Selected: free pointer for hold-to-drag + edge resize. */
			touch-action: none;
			transform: scale(1.01);
		}

		:global(.fc-event--draggable:active:not(.fc-event-dragging)) {
			transform: scale(0.99);
		}

		/* Coaching strip above the day grid while a card is selected. */
		.split-calendar__gesture-hint {
			flex: 0 0 auto;
			margin: 0;
			padding: 6px 10px;
			font-size: 0.72rem;
			font-weight: 600;
			letter-spacing: 0.01em;
			text-align: center;
			color: var(--color-primary);
			background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
			border-bottom: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--color-border));
			z-index: 5;
		}

		/* Live time chip — mounted on document.body (fixed) so grid stacking never hides it. */
		:global(.split-calendar__gesture-hud) {
			position: fixed;
			left: 50%;
			top: max(10px, env(safe-area-inset-top, 0px));
			transform: translateX(-50%) translateY(-6px);
			z-index: 10050;
			pointer-events: none;
			opacity: 0;
			padding: 10px 16px;
			border-radius: 999px;
			font-size: 0.8125rem;
			font-weight: 700;
			letter-spacing: 0.01em;
			white-space: nowrap;
			max-width: min(420px, 94vw);
			overflow: hidden;
			text-overflow: ellipsis;
			color: #fff;
			background: rgba(20, 24, 32, 0.94);
			box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
			transition:
				opacity 0.12s ease,
				transform 0.12s ease;
		}

		:global(.split-calendar__gesture-hud--visible) {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}

		:global(.split-calendar__gesture-hud[data-mode='resize']) {
			background: color-mix(in srgb, var(--color-primary) 88%, #111);
		}

		:global(.split-calendar__gesture-hud[data-mode='move']) {
			background: rgba(15, 18, 28, 0.95);
		}

		/* Move grip + resize handles only after selection (large fat-finger targets). */
		:global(.fc-event__move-handle) {
			display: none;
			position: absolute;
			top: 4px;
			right: 4px;
			min-width: 44px;
			height: 36px;
			margin: 0;
			padding: 0 8px;
			border: 0;
			border-radius: 10px;
			background: rgba(0, 0, 0, 0.38);
			color: #fff;
			align-items: center;
			justify-content: center;
			gap: 4px;
			z-index: 24;
			touch-action: none;
			cursor: grab;
			box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.28);
			-webkit-tap-highlight-color: transparent;
			font-size: 0.65rem;
			font-weight: 700;
			letter-spacing: 0.02em;
			text-transform: uppercase;
		}

		:global(.fc-event__move-handle-label) {
			line-height: 1;
		}

		:global(.fc-event__move-handle--armed) {
			background: var(--color-primary);
			transform: scale(1.05);
		}

		:global(.fc-event--mobile-selected .fc-event__move-handle) {
			display: flex;
		}

		:global(.event-completed .fc-event__move-handle),
		:global(.event-cancelled .fc-event__move-handle) {
			display: none !important;
		}

		/* Custom edge pills (injected in JS). Hidden until the card is selected.
		   FC native resizers are never mounted on mobile (eventDurationEditable=false). */
		:global(.fc-event__edge-pill),
		:global(.fc-event-resizer.fc-event__edge-pill) {
			position: absolute;
			left: 6px;
			right: 6px;
			height: 44px;
			z-index: 30;
			display: none;
			align-items: center;
			justify-content: center;
			margin: 0;
			padding: 0;
			border: 0;
			border-radius: 10px;
			background: rgba(0, 0, 0, 0.28);
			touch-action: none;
			cursor: ns-resize;
			-webkit-tap-highlight-color: transparent;
			pointer-events: auto;
		}

		:global(.fc-event__edge-pill--end),
		:global(.fc-event-resizer-end.fc-event__edge-pill) {
			bottom: -8px;
			top: auto;
		}

		:global(.fc-event__edge-pill--start),
		:global(.fc-event-resizer-start.fc-event__edge-pill) {
			top: -8px;
			bottom: auto;
		}

		:global(.fc-event__edge-pill-bar) {
			display: block;
			width: 52px;
			height: 7px;
			border-radius: 999px;
			background: rgba(255, 255, 255, 0.98);
			box-shadow:
				0 0 0 1px rgba(0, 0, 0, 0.22),
				0 2px 6px rgba(0, 0, 0, 0.18);
			pointer-events: none;
		}

		/* Selected rules MUST come after base display:none so pills actually appear. */
		:global(.fc-event--mobile-selected .fc-event__edge-pill),
		:global(.fc-event--mobile-selected .fc-event-resizer.fc-event__edge-pill) {
			display: flex !important;
		}

		:global(.event-completed.fc-event--mobile-selected .fc-event__edge-pill),
		:global(.event-cancelled.fc-event--mobile-selected .fc-event__edge-pill) {
			display: none !important;
		}

		:global(.fc-event--mobile-selected .fc-event__edge-pill:active),
		:global(.fc-event-resizing .fc-event__edge-pill) {
			background: color-mix(in srgb, var(--color-primary) 55%, rgba(0, 0, 0, 0.35));
		}

		/* Touch-friendly event resizing on mobile.
		   Drag the top or bottom edge pills after selecting the card.
		   Avatars sit bottom-right (inset above resizers).
		*/
		:global(.fc-timegrid-event .fc-event__crew-avatars) {
			top: auto;
			bottom: 14px;
			left: auto;
			right: 4px;
		}

		:global(.fc-timegrid-event .fc-event__crew-avatar) {
			width: 18px;
			height: 18px;
			font-size: 8px;
		}

		:global(.fc-timegrid-event .fc-event-time) {
			padding-right: 52px;
		}

		:global(.fc-timegrid-event .fc-event-title) {
			padding-bottom: 8px;
			padding-top: 2px;
			padding-right: 4px;
		}

		:global(.fc-event--mobile-selected .fc-event-title) {
			padding-bottom: 28px;
			padding-top: 18px;
		}

		/* Let edge pills overhang without being clipped by the card. */
		:global(.fc-timegrid-event.fc-event--mobile-selected),
		:global(.fc-timegrid-event-harness:has(.fc-event--mobile-selected)) {
			overflow: visible !important;
		}

		/* Elevated “picked up” ghost while dragging (Material-style lift).
		   Must beat neighboring event harness z-index or the mirror slides under them.
		   IMPORTANT: never set position:relative on timegrid harness mirrors — FC sizes
		   duration via position:absolute + top/bottom; relative collapses them to ~1h content. */
		:global(.fc-event.fc-event-dragging) {
			opacity: 0.2 !important;
			transform: none !important;
		}

		:global(.fc-event-mirror),
		:global(.fc-timegrid-event.fc-event-mirror) {
			opacity: 0.96 !important;
			z-index: 2000 !important;
			box-shadow:
				0 14px 32px rgba(0, 0, 0, 0.32),
				0 0 0 2px color-mix(in srgb, var(--color-primary) 75%, #fff) !important;
			outline: none !important;
			border-radius: 8px;
		}

		/* In-grid harness mirror — keep absolute positioning so top/bottom duration height holds. */
		:global(.fc-timegrid-event-harness.fc-event-mirror),
		:global(html.calendar-appointment-dragging .fc-timegrid-event-harness.fc-event-mirror) {
			opacity: 1 !important;
			z-index: 5000 !important;
			/* position must remain absolute (FC default); do not override */
		}

		:global(html.calendar-appointment-dragging .fc-event-mirror) {
			z-index: 5000 !important;
		}

		/* Floating ElementMirror clone (position:fixed) — duration height is set inline from
		   source rect; reinforce so CSS never shrinks a multi-hour card to one slot. */
		:global(html.calendar-appointment-dragging .fc-event-mirror.fc-event-dragging) {
			/* height is applied inline by FC from source getBoundingClientRect */
			min-height: var(--mobile-drag-mirror-height, 0px);
		}

		:global(html.calendar-appointment-dragging .fc-timegrid-col-events) {
			/* Keep event layer from trapping the mirror under later siblings. */
			z-index: 5;
		}

		:global(.fc-event-resizing) {
			box-shadow:
				0 0 0 2px var(--color-primary),
				0 8px 20px rgba(0, 0, 0, 0.2);
			z-index: 14;
		}

		.split-calendar__day-wrapper {
			position: relative;
		}
	}

	/* Ghost / drag visual feedback (desktop + base).
	   Mobile overrides above raise mirror elevation so the finger-follower reads as “picked up”.
	   Month-picker drops still need a readable ghost over day numbers.
	   Reference: mobile-specific-tweaks
	*/
	:global(.fc-event.fc-event-dragging) {
		opacity: 0.25 !important;
		transition: opacity 0.1s ease;
	}

	:global(.fc-event-mirror) {
		opacity: 0.72;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
		outline: 1px dashed var(--color-border);
		outline-offset: 1px;
	}

	:global(.month-picker--edge-left .month-picker__nav--prev) {
		background: var(--color-primary-soft);
		border-color: var(--color-primary);
		box-shadow: inset 0 -3px 0 var(--color-primary);
	}

	:global(.month-picker--edge-right .month-picker__nav--next) {
		background: var(--color-primary-soft);
		border-color: var(--color-primary);
		box-shadow: inset 0 -3px 0 var(--color-primary);
	}

	:global(.month-picker--drag-active) {
		outline: 1px dashed color-mix(in srgb, var(--color-primary) 50%, transparent);
		outline-offset: 2px;
	}

	/* === Compact MonthPicker on mobile ===
	   Portrait: sticky so it stays visible while the tall day grid scrolls at page level.
	   Landscape 3-day: sticky is disabled above — day grid scrolls inside its own wrapper,
	   and sticky was painting over the time-grid day headers on short viewports.
	   BEM rules + tokens. */
	.split-calendar-container--mobile :global(.month-picker) {
		border-radius: var(--radius-sm);
		position: sticky;
		top: 0;
		z-index: 20;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		background: var(--color-surface);
		max-height: 58dvh;
		/* Prevent tall months / content from painting over the day grid under max-height. */
		overflow: auto;
	}

	.split-calendar-container--mobile :global(.month-picker__header) {
		padding: 0 2px;
	}

	.split-calendar-container--mobile :global(.month-picker__title) {
		font-size: var(--font-size-xs);
	}

	/* Portrait-only sticky (and media fallback). Landscape three-day overrides to relative. */
	@media (max-width: 768px) {
		:global(.month-picker) {
			border-radius: var(--radius-sm);
			position: sticky;
			top: 0;
			z-index: 20;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
			background: var(--color-surface);
			max-height: 58dvh;
			overflow: auto;
		}

		:global(.month-picker__header) {
			padding: 0 2px;
		}

		:global(.month-picker__title) {
			font-size: var(--font-size-xs);
		}
	}

	/* Phone landscape without the three-day class still shouldn't sticky-overlap. */
	@media (orientation: landscape) and (max-height: 500px) {
		:global(.month-picker) {
			border-radius: var(--radius-sm);
			position: relative;
			top: auto;
			z-index: 1;
			box-shadow: none;
			background: var(--color-surface);
			max-height: none;
			overflow: hidden;
		}
	}

	/* Landscape 3-day picker: MUST come after mobile sticky rules so it wins specificity order.
	   Sticky + max-height (overflow visible) was painting the month grid over day headers. */
	.split-calendar-container--three-day :global(.month-picker),
	.split-calendar-container--mobile.split-calendar-container--three-day :global(.month-picker) {
		--month-picker-grid-height: 78px;
		--month-picker-nav-height: 32px;
		position: relative !important;
		top: auto !important;
		z-index: 1;
		max-height: none !important;
		/* Clip any residual overflow instead of covering the day grid. */
		overflow: hidden;
		box-shadow: none;
		border-bottom: 1px solid var(--color-border);
	}
</style>
