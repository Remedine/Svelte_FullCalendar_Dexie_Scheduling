<!-- src/lib/calendar/SplitCalendar.svelte -->
<script lang="ts">
	import { Calendar } from '@fullcalendar/core';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getJobsForRange, updateJobDates, getUserPhotoSrc, db, cleanupDuplicateUsers, dedupJobs, repairJobDateFields } from '$lib/db/index';
	import { pullJobsFromServer, applyServerJobRecord, pb } from '$lib/db/pb';
	import { onJobsRealtime } from '$lib/db/realtime';
	import { openJobModal } from '$lib/components/JobFormModal.svelte';
	import MonthPicker from './MonthPicker.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	// )=- Date helpers extracted to pure $lib/utils/dates.ts in Phase 1 of the testing plan.
	// This removes duplication with JobInvoicePanel and enables strong unit testing of the local-date logic
	// that was the source of multiple due-date / calendar jump bugs.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md
	import { getLocalDateString, parseLocalDate, toDateString } from '$lib/utils/dates';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { auth } from '$lib/stores/auth.svelte';
	import { getUserDisplayName, isJobAssignedToCrew } from '$lib/utils/crew';
	import { getCalendarSlotBounds } from '$lib/utils/calendar';

	// )=- Drag state kept as plain `let` (not $state) to avoid triggering reactivity, deriveds,
	// and $effects (which do refetch/update) on every pointer event during drag.
	// This was causing the "dog slow" feel and inability to complete drops – FullCalendar's
	// drag handling was being interrupted by parent re-renders and refetch thrashing.
	// Only used inside drag handlers; no UI binding depends on them reactively.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	let isExternalDrop = false;
	let originalEventRect: DOMRect | null = null;
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

	// Mobile touch zones: drag only from + handle, resize only from edge pills (custom gesture).
	// FullCalendar touch resize requires pre-selecting by internal instanceId and fights scroll.
	const MOBILE_EDGE_SCROLL_THRESHOLD_PX = 56;
	const MOBILE_EDGE_SCROLL_MAX_VELOCITY = 300;

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
		initialHarnessTop: number;
		initialHarnessHeight: number;
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
		return !!(
			target.closest('.fc-event-resizer') ||
			target.closest('.fc-event__drag-handle')
		);
	}

	function clearStaleEventHarnessStyles(eventEl: HTMLElement) {
		const harness = eventEl.closest('.fc-timegrid-event-harness') as HTMLElement | null;
		harness?.style.removeProperty('height');
		harness?.style.removeProperty('top');
		harness?.style.removeProperty('bottom');
	}

	// Custom mobile resize mutates harness inline styles in the live DOM. Incremental refetch /
	// setDates can leave the stale harness node collapsed. Remove + refetch forces a fresh mount.
	function finalizeMobileResizeVisual(eventId: string, eventEl: HTMLElement) {
		dayApi?.getEventById(eventId)?.remove();
		dayApi?.refetchEvents();
		requestAnimationFrame(() => {
			clearStaleEventHarnessStyles(eventEl);
			dayApi?.updateSize();
			endCalendarInteraction();
		});
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
		end: Date,
		slotMs: number
	) {
		const { slotHeight } = getMobileSlotMetrics(gesture.harnessEl);
		const startSlotDelta = Math.round((start.getTime() - gesture.originalStart.getTime()) / slotMs);
		const endSlotDelta = Math.round((end.getTime() - gesture.originalEnd.getTime()) / slotMs);

		// FC positions harness with top+bottom; switch to top+height for preview and clear bottom.
		gesture.harnessEl.style.removeProperty('bottom');

		if (gesture.resizeStartEdge) {
			const newTop = gesture.initialHarnessTop + startSlotDelta * slotHeight;
			const newHeight = Math.max(
				slotHeight,
				gesture.initialHarnessHeight - startSlotDelta * slotHeight
			);
			gesture.harnessEl.style.top = `${newTop}px`;
			gesture.harnessEl.style.height = `${newHeight}px`;
			return;
		}

		gesture.harnessEl.style.top = `${gesture.initialHarnessTop}px`;
		gesture.harnessEl.style.height = `${Math.max(
			slotHeight,
			gesture.initialHarnessHeight + endSlotDelta * slotHeight
		)}px`;
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
		activeMobileResize.previewStart = snapped.start;
		activeMobileResize.previewEnd = snapped.end;
		applyMobileResizePreview(activeMobileResize, snapped.start, snapped.end, slotMs);
	}

	function stopMobileEdgeAutoScroll() {
		if (mobileEdgeScrollRaf != null) {
			cancelAnimationFrame(mobileEdgeScrollRaf);
			mobileEdgeScrollRaf = null;
		}
		mobileEdgeScrollPointerY = null;
		mobileEdgeScrollLastTs = null;
	}

	function runMobileEdgeAutoScrollFrame(ts: number) {
		if (!activeMobileResize) {
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

			if (fromTop >= 0 && fromTop < MOBILE_EDGE_SCROLL_THRESHOLD_PX) {
				const proximity =
					(MOBILE_EDGE_SCROLL_THRESHOLD_PX - fromTop) / MOBILE_EDGE_SCROLL_THRESHOLD_PX;
				velocity = -(proximity * proximity) * MOBILE_EDGE_SCROLL_MAX_VELOCITY;
			} else if (fromBottom >= 0 && fromBottom < MOBILE_EDGE_SCROLL_THRESHOLD_PX) {
				const proximity =
					(MOBILE_EDGE_SCROLL_THRESHOLD_PX - fromBottom) / MOBILE_EDGE_SCROLL_THRESHOLD_PX;
				velocity = proximity * proximity * MOBILE_EDGE_SCROLL_MAX_VELOCITY;
			}

			if (velocity !== 0 && mobileEdgeScrollLastTs != null) {
				const dt = Math.min(0.05, (ts - mobileEdgeScrollLastTs) / 1000);
				const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
				scrollEl.scrollTop = Math.min(
					maxScroll,
					Math.max(0, scrollEl.scrollTop + velocity * dt)
				);
			}

			updateMobileResizeFromClientY(pointerY);
		}

		mobileEdgeScrollLastTs = ts;
		mobileEdgeScrollRaf = requestAnimationFrame(runMobileEdgeAutoScrollFrame);
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

	async function handleMobileResizeEnd() {
		const gesture = activeMobileResize;
		activeMobileResize = null;
		clearMobileResizeListeners();

		if (!gesture) {
			endCalendarInteraction();
			return;
		}

		const changed =
			gesture.previewStart.getTime() !== gesture.originalStart.getTime() ||
			gesture.previewEnd.getTime() !== gesture.originalEnd.getTime();

		gesture.eventEl.classList.remove('fc-event-resizing');

		if (!changed) {
			clearStaleEventHarnessStyles(gesture.eventEl);
			dayApi?.refetchEvents();
			requestAnimationFrame(() => {
				dayApi?.updateSize();
				endCalendarInteraction();
			});
			return;
		}

		try {
			await updateJobDates(gesture.eventId, gesture.previewStart, gesture.previewEnd);
			applyOptimisticDatePatch(gesture.eventId, gesture.previewStart, gesture.previewEnd);
			finalizeMobileResizeVisual(gesture.eventId, gesture.eventEl);
		} catch {
			clearStaleEventHarnessStyles(gesture.eventEl);
			dayApi?.refetchEvents();
			toast.error('Could not resize appointment');
			requestAnimationFrame(() => {
				dayApi?.updateSize();
				endCalendarInteraction();
			});
		}
	}

	function bindMobileDragHandle(eventEl: HTMLElement) {
		eventEl.classList.remove('fc-event-draggable');
		const dragHandle = eventEl.querySelector('.fc-event__drag-handle');
		dragHandle?.classList.add('fc-event-draggable');
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
		if (eventEl.dataset.mobileTouchZones === '1') {
			bindMobileDragHandle(eventEl);
			return;
		}
		eventEl.dataset.mobileTouchZones = '1';

		clearStaleEventHarnessStyles(eventEl);
		bindMobileDragHandle(eventEl);

		const eventId = info.event.id;
		if (!info.event.start) return;
		const originalStart = new Date(info.event.start);
		const originalEnd = info.event.end
			? new Date(info.event.end)
			: new Date(originalStart.getTime() + getMobileSlotMetrics().slotMs);

		eventEl.addEventListener(
			'touchstart',
			(e) => {
				const target = e.target;
				if (!(target instanceof Element)) return;
				const resizer = target.closest('.fc-event-resizer');
				if (!resizer) return;

				const status = info.event.extendedProps?.status;
				if (status === 'completed' || status === 'cancelled') {
					toast.error('Cannot resize cancelled or completed jobs');
					return;
				}

				const touch = e.changedTouches[0] || e.touches[0];
				if (!touch) return;

				const harnessEl = eventEl.closest('.fc-timegrid-event-harness') as HTMLElement | null;
				if (!harnessEl) return;

				e.stopPropagation();

				const scrollEl = getMobileScrollEl();

				beginCalendarInteraction();
				activeMobileResize = {
					eventId,
					eventEl,
					harnessEl,
					resizeStartEdge: resizer.classList.contains('fc-event-resizer-start'),
					pointerStartY: touch.clientY,
					initialScrollTop: scrollEl?.scrollTop ?? 0,
					initialHarnessTop: harnessEl.offsetTop,
					initialHarnessHeight: harnessEl.offsetHeight,
					originalStart,
					originalEnd,
					previewStart: originalStart,
					previewEnd: originalEnd
				};

				eventEl.classList.add('fc-event-resizing');
				updateMobileResizeFromClientY(touch.clientY);
				ensureMobileEdgeAutoScrollRunning(touch.clientY);
				document.addEventListener('touchmove', handleMobileResizeMove, { passive: false });
				document.addEventListener('touchend', handleMobileResizeEnd, { passive: true });
				document.addEventListener('touchcancel', handleMobileResizeEnd, { passive: true });
			},
			{ capture: true, passive: true }
		);
	}

	let dayEl = $state<HTMLDivElement | null>(null);
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

	const CALENDAR_STATUS_FILTERS = ['scheduled', 'confirmed', 'completed', 'cancelled'] as const;
	let jobs = $state<any[]>([]);
	let dayApi: Calendar | null = null;
	let isSyncing = $state(false);
	let currentView = $state('timeGridWeek');
	let crewOptions = $state<string[]>([]);

	// Mobile detection for day-only view, compact MonthPicker, reclaimed space, anchored top month picker,
	// and mobile footer behaviors in the parent layout.
	let isMobile = $state(false);

	$effect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia('(max-width: 768px)');
		isMobile = mql.matches;

		const listener = (e: MediaQueryListEvent) => {
			isMobile = e.matches;
			// When crossing to mobile, force day view only (per spec)
			if (isMobile && currentView !== 'timeGridDay' && dayApi) {
				currentView = 'timeGridDay';
				dayApi.changeView('timeGridDay');
			}
			if (dayApi) {
				dayApi.setOption('eventResizableFromStart', isMobile);
			}
		};
		mql.addEventListener('change', listener);

		return () => mql.removeEventListener('change', listener);
	});

	// )=- Map of crew name to photo URL for rendering circular avatars on event cards.
	let crewPhotoMap = $state<Record<string, string>>({});
	let filtersOpen = $state(true);
	let draggedJobId: string | null = null;

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

	// Load crew options
	$effect(() => {
		cleanupDuplicateUsers().then(() => {
			db.users.toArray().then((users: any[]) => {
				// )=- Dedup by display name...
				crewOptions = Array.from(
					new Set(
						users
							.filter((u: any) => u.active)
							.map((u: any) => u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim())
					)
				).sort();
			});
		});
	});

	// )=- Load crew photos once (for circular avatars on job event cards, right edge under drag icon).
	$effect(() => {
		if (Object.keys(crewPhotoMap).length === 0) {
			db.users.toArray().then((users: any[]) => {
				const map: Record<string, string> = {};
				users.forEach((u: any) => {
					if (u.name && u.photo) {
						// )=- Use central helper (normalizes bare filenames via getURL, keeps data:).
						map[u.name] = getUserPhotoSrc(u.photo, u) || u.photo;
					}
				});
				crewPhotoMap = map;
			});
		}
	});

	// )=- Once crew photos loaded (or when dayApi becomes ready), refetch so eventDidMount appends the circular avatars.
	// DayApi assignment re-runs this (reads dayApi), so if eager load in loadData already finished we get avatars on first paint too.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	$effect(() => {
		if (dayApi && Object.keys(crewPhotoMap).length > 0) {
			// )=- Removed unconditional refetch here (and similar in options effect below).
			// These were firing on every photo/options update (including during/after login syncs
			// and filter changes), causing repeated FullCalendar event list rebuilds.
			// This + reactive drag state was the main source of "dog slow" + drag not working
			// (heavy work on every pointer event + visual "reloading" of events).
			// Colors/avatars are now populated before calendar creation (via loadData eager loads),
			// and one refetch after initial render is sufficient. Extra refetches only on explicit
			// data changes that matter (jobs, filters that affect range).
			// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
			// dayApi.refetchEvents();  // removed for perf
		}
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
	// If realtime fails (PB restart, Railway multi-instance, stale clientId), login pulls + manual
	// sync + periodic fallback pull below still keep the calendar correct.
	$effect(() => {
		if (!pb.authStore.isValid) return;

		let pollTimer: ReturnType<typeof setInterval> | null = null;

		const offRealtime = onJobsRealtime(async (e) => {
			const rec = e.record as any;
			if (!rec) return;

			// )=- Batch A: same updatedAt merge as pullJobsFromServer — do not clobber newer local edits.
			const outcome = await applyServerJobRecord(rec);
			if (outcome === 'skipped') return;

			const includeCancelled = shouldIncludeCancelledJobs();
			const start = new Date();
			start.setMonth(start.getMonth() - 2);
			const end = new Date();
			end.setMonth(end.getMonth() + 2);

			const fresh = await getJobsForRange(start, end, includeCancelled);
			jobs.splice(0, jobs.length, ...fresh);
			dayApi?.refetchEvents();
		});

		// Fallback when realtime is down: light periodic pull while calendar is open.
		pollTimer = setInterval(() => {
			if (navigator.onLine && pb.authStore.isValid) {
				pullJobsFromServer().catch(() => {});
			}
		}, 120_000);

		return () => {
			offRealtime();
			if (pollTimer) clearInterval(pollTimer);
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
		return jobs.filter((job: any) => isJobAssignedToCrew(job, crewName));
	});

	const calendarSlotBounds = $derived(getCalendarSlotBounds(optionsStore.data));

	const filteredJobs = $derived(
		crewScopedJobs.filter((job: any) => {
			const matchesCrew =
				filters.crew.length === 0 ||
				job.assignedCrew?.some((c: string) => filters.crew.includes(c));
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
		// )=- Removed the unconditional pullFromPB here.
		// It was causing extra network roundtrips + optionsStore.data updates (which previously
		// triggered refetch effects) on every calendar loadData (initial + certain filter toggles).
		// This contributed to the "reloading slightly" feel. Freshness is handled at login
		// (pull*FromServer) and explicit options pulls when user visits the options page.
		// Eager crew photo load is kept for initial avatars.
		// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
		// if (navigator.onLine) { await optionsStore.pullFromPB?.(); }

		// )=- Eagerly kick off crew photo load (for the right-edge circular avatars under drag handle)
		// before we fetch jobs and create the FullCalendar instance. ...
		db.users.toArray().then((users: any[]) => {
			const map: Record<string, string> = {};
			users.forEach((u: any) => {
				if (u.name && u.photo) {
					map[u.name] = getUserPhotoSrc(u.photo, u) || u.photo;
				}
			});
			if (Object.keys(map).length > 0) {
				crewPhotoMap = map;
			}
		});

		const includeCancelled = shouldIncludeCancelledJobs();

		const start = new Date();
		start.setMonth(start.getMonth() - 2);
		const end = new Date();
		end.setMonth(end.getMonth() + 2);

		await repairJobDateFields();
		jobs = await getJobsForRange(start, end, includeCancelled);
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

			const includeCancelled = shouldIncludeCancelledJobs();

			const newJobs = await getJobsForRange(
				new Date(new Date().setMonth(new Date().getMonth() - 2)),
				new Date(new Date().setMonth(new Date().getMonth() + 2)),
				includeCancelled
			);

			jobs.splice(0, jobs.length, ...newJobs);
			dayApi?.refetchEvents();
		} catch (e) {
			toast.dismiss(syncToast);
			toast.error('Failed to sync changes');
		} finally {
			isSyncing = false;
		}
	}

	function changeView(newView: string) {
		// On mobile we only support Day view (time slots under anchored MonthPicker).
		// Week/Month are desktop only.
		if (isMobile && newView !== 'timeGridDay') {
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
			// Phase 1: optimistic patch for external drops (MonthPicker target).
			// The drag gesture is already over (this is called from eventDragStop), so it's safe to refetch
			// to remove the event from its old position in the main calendar and let the provider see the new date.
			applyOptimisticDatePatch(jobId, newDate, newEnd);
			dayApi?.refetchEvents();
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
				initialView: isMobile ? 'timeGridDay' : currentView,
				initialDate: parseLocalDate(selectedDate),
				headerToolbar: false,
				height: isMobile ? '100%' : 'auto',
				allDaySlot: true,
				slotMinTime: calendarSlotBounds.slotMinTime,
				slotMaxTime: calendarSlotBounds.slotMaxTime,
				nowIndicator: true,
				expandRows: false,
				editable: true,
				// On mobile, allow resizing from both top and bottom edges — doubles the touch targets.
				eventResizableFromStart: isMobile,
				dragScroll: true,
				snapDuration: '00:30:00',
				eventDragMinDistance: 10,
				// Mobile hold-to-drag (long press) support. Lower delay than desktop default (often 1000ms)
				// so "hold to drag" feels responsive on phones/tablets without fighting taps for modal open.
				// eventClick still fires on short taps; long-press starts the drag mirror.
				// Also improves reliability of eventDrop / eventDragStop firing correctly on touch.
				// Reference: mobile-specific-tweaks
				eventLongPressDelay: 280,
				selectLongPressDelay: 280,
				longPressDelay: 280,

				dateClick: (info) => {
					openJobModal({ start: info.date }, () => refreshAfterUpdate());
				},

				eventDidMount: (info) => {
					if (
						highlightJobId &&
						!hasScrolledToHighlight &&
						jobMatchesHighlight(info.event.id, info.event.extendedProps)
					) {
						hasScrolledToHighlight = true;
						requestAnimationFrame(() => {
							window.setTimeout(() => {
								info.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
							}, 120);
						});
					}

					// )=- Do NOT set draggable="true" here. It enables native HTML5 drag which interferes with FullCalendar's own drag system (editable events), causing D&D to not work or behave erratically (native vs FC drag fighting).
					// The visual drag handle + CSS hover is sufficient for UX. FC handles the actual drag start internally on the event.
					// This was likely contributing to "Drag and drop isn't working".
					// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
					info.el.classList.add('fc-event--draggable');

					// Only create the drag handle once per event element (idempotent).
					// Previously this + avatars were recreated on every refetch, contributing to "refreshing" feel and memory churn.
					const isTimeGrid =
						info.view.type === 'timeGridDay' || info.view.type === 'timeGridWeek';

					clearStaleEventHarnessStyles(info.el);

					if (!info.el.querySelector('.fc-event__drag-handle')) {
						const handle = document.createElement('div');
						handle.className = 'fc-event__drag-handle';

						handle.innerHTML = `
							<svg width="14" height="14" viewBox="0 0 24 24" fill="white">
								<rect x="3" y="11" width="18" height="2" rx="1"/>
								<rect x="11" y="3" width="2" height="18" rx="1"/>
								<polygon points="12,1 8,6 16,6"/>
								<polygon points="12,23 8,18 16,18"/>
								<polygon points="1,12 6,8 6,16"/>
								<polygon points="23,12 18,8 18,16"/>
							</svg>
						`;

						info.el.appendChild(handle);
					}

					if (isMobile && isTimeGrid) {
						setupMobileEventTouchZones(info);
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

					// )=- Add circular crew avatars.
					// - Regular timeGrid card views: placed *inside* the card at bottom-right (no overhang).
					// - dayGridMonth view: placed inline *to the right of the text/title*.
					// Uses crewPhotoMap (Dexie users). Letter fallback if no photo.
					// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
					const crew = info.event.extendedProps?.assignedCrew || [];
					if (crew.length > 0) {
						// Remove any previous (on re-render / refetch)
						const prev = info.el.querySelector('.fc-event__crew-avatars');
						if (prev) prev.remove();

						const crewEl = document.createElement('div');
						crewEl.className = 'fc-event__crew-avatars';

						const isMonthView =
							info.view.type === 'dayGridMonth' ||
							!!info.el.closest('.fc-dayGridMonth-view') ||
							!!info.el.closest('.fc-daygrid-month');

						if (isMonthView) {
							crewEl.classList.add('fc-event__crew-avatars--inline');
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
							// Place directly after the title so it sits to the right of the text in month list items.
							const titleEl = info.el.querySelector('.fc-event-title');
							if (titleEl && titleEl.parentNode) {
								titleEl.parentNode.insertBefore(crewEl, titleEl.nextSibling);
							} else {
								info.el.appendChild(crewEl);
							}
						} else {
							// Inside the card for timeGrid views.
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
						return;
					}

					beginCalendarInteraction();
					draggedJobId = info.event.id!;
					originalEventRect = info.el.getBoundingClientRect();
				},

				eventDragStop: (info) => {
					endCalendarInteraction();
					originalEventRect = null;

					if (!draggedJobId) return;

					const monthPickerEl = document.querySelector('.month-picker');
					if (!monthPickerEl) {
						draggedJobId = null;
						return;
					}

					// Use robust extractor so external drop (to MonthPicker) and cross-view move works on touch devices.
					// Without this, mobile hold-to-drag to the monthly picker always "snaps back" because hit-test fails.
					const { x: clientX, y: clientY } = getEventClientCoords(info.jsEvent);

					let dropTarget = document.elementFromPoint(clientX, clientY);
					let monthPickerDay = dropTarget?.closest('.month-picker__day');

					if (!monthPickerDay) {
						const rect = monthPickerEl.getBoundingClientRect();
						const isOverContainer =
							clientX >= rect.left && clientX <= rect.right &&
							clientY >= rect.top && clientY <= rect.bottom;

						if (isOverContainer) {
							const dayElements = monthPickerEl.querySelectorAll('.month-picker__day');
							for (const el of dayElements) {
								const r = el.getBoundingClientRect();
								if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
									monthPickerDay = el;
									break;
								}
							}
						}
					}

					if (monthPickerDay) {
						isExternalDrop = true;
						handleExternalDrop(draggedJobId, clientX, clientY);
					}

					draggedJobId = null;
				},

				select: (info) => {
					openJobModal({ start: info.start, end: info.end }, () => refreshAfterUpdate());
				},

				eventClick: (info) => {
					if (isMobile && isMobileGestureChromeTarget(info.jsEvent.target)) {
						return;
					}
					clearJobHighlight();
					openJobModal(info.event.extendedProps, () => refreshAfterUpdate());
				},

				eventResizeStart: (info) => {
					beginCalendarInteraction();
				},

				eventResizeStop: (info) => {
					endCalendarInteraction();
					clearStaleEventHarnessStyles(info.el);
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
						// If you ever need to force a provider sync for this event (rare), use a deferred refetch:
						// queueMicrotask(() => dayApi?.refetchEvents());
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

				events: (fetchInfo, successCallback) => {
					let visibleJobs = filteredJobs;

					if (currentView === 'timeGridDay') {
						const selectedStr = selectedDate;
						visibleJobs = filteredJobs.filter((job: any) => {
							const jobStartStr = toDateString(job.start);
							const jobEndStr = job.end ? toDateString(job.end) : jobStartStr;
							return selectedStr >= jobStartStr && selectedStr <= jobEndStr;
						});
					}

					successCallback(
						visibleJobs.map((job: any) => ({
							id: job.id,
							// )=- Title is now just the job title; crew members are shown as circular avatars on the right (see eventDidMount).
							title: job.title,
							start: job.start,
							end: job.end,
							backgroundColor: getJobColor(job),
							extendedProps: job
						}))
					);
				}
			});

			dayApi = api; // expose the local instance to other effects (refetch, etc.)

			api.render();

			requestAnimationFrame(() => {
				api?.updateSize();
				api?.setOption('height', 'auto'); // only once, during initial creation. Repeated calls from observers were a major source of idle "refreshing" and layout churn.
				api?.gotoDate(parseLocalDate(selectedDate));
			});
		});

		return () => {
			// Do NOT reset calendarInitialized here.
			// (See comment at declaration for why.)
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
	function handleDateSelect(dateStr: string) {
		clearJobHighlight();
		clearJumpCancelledMode();
		selectedDate = dateStr;
		syncDateToUrl(dateStr);
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

<div class="split-calendar-container">
	<div class="split-calendar">
		<!-- Sidebar -->
		<div class="split-calendar__sidebar">
			<MonthPicker jobs={filteredJobs} bind:selectedDate onDateSelect={handleDateSelect} />

			<!-- Filters -->
			<div class="split-calendar__filters">
				<details bind:open={filtersOpen}>
					<summary class="split-calendar__filters-summary">
						<span>Filters</span>
						{#if activeFilterCount > 0}
							<span class="split-calendar__filters-badge">{activeFilterCount}</span>
						{/if}
					</summary>

					<!-- Crew -->
					<div class="split-calendar__filter-group">
						<div class="split-calendar__filter-group-label">Crew</div>
						<div class="split-calendar__filter-options">
							{#each crewOptions as crew}
								<label class="split-calendar__filter-option">
									<input
										type="checkbox"
										checked={filters.crew.includes(crew)}
										onchange={() => toggleFilter('crew', crew)}
									/>
									<span class="split-calendar__filter-option-avatar">
										{#if crewPhotoMap[crew]}
											<img src={crewPhotoMap[crew]} alt={crew} />
										{:else}
											{(crew || '?').charAt(0).toUpperCase()}
										{/if}
									</span>
									<span>{crew}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- Area -->
					<div class="split-calendar__filter-group">
						<div class="split-calendar__filter-group-label">Area</div>
						<div class="split-calendar__filter-options">
							{#each optionsStore.data?.areasOfTown || [] as area}
								<label class="split-calendar__filter-option">
									<input
										type="checkbox"
										checked={filters.areas.includes(area.id)}
										onchange={() => toggleFilter('areas', area.id)}
									/>
									<span>{area.label}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- Status -->
					<div class="split-calendar__filter-group">
						<div class="split-calendar__filter-group-label">Status</div>
						<div class="split-calendar__filter-options">
							{#each ['scheduled', 'confirmed', 'completed', 'cancelled'] as status}
								<label class="split-calendar__filter-option">
									<input
										type="checkbox"
										checked={filters.statuses.includes(status)}
										onchange={() => toggleFilter('statuses', status)}
									/>
									<span class="split-calendar__status split-calendar__status--{status}">{status}</span>
								</label>
							{/each}
						</div>
					</div>

					{#if activeFilterCount > 0}
						<button class="split-calendar__filters-clear-btn" onclick={clearFilters}> Clear all filters </button>
					{/if}
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

			<div class="split-calendar__day-wrapper" class:refreshing={isSyncing}>
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

	@media (max-width: 768px) {
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

	/* Completely hide the (now mostly empty) view switcher on mobile since we force Day only */
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

	/* === Mobile day-focused layout (anchored top MonthPicker + scrolling time slots) === */
	/* The split-page and __content in the page get flex:1 from the main-content remaining space (after layout chrome/footer).
	   Here, the sidebar (MonthPicker compact) is flex-shrink:0, the main and day-wrapper flex:1 to take the remaining height.
	   The day-wrapper has overflow auto for the time grid slots (FC height 100% makes the calendar fill it, body scrolls if more slots than height).
	   This gives the calendar the full available height on the page for many hours visible + scroll.
	   The .month-picker is sticky (see below) to stay visible above the scrolling slots.
	   Reclaims gutters; relies on the full stack flex chain (layout main-content, page, this component).
	   BEM + tokens. */
	@media (max-width: 768px) {
		.split-calendar {
			gap: var(--space-2);
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}

		.split-calendar__sidebar {
			/* Only the compact MonthPicker is shown at top; filters moved out of way */
			margin-bottom: 0;
			flex-shrink: 0;
		}

		/* Hide the big filters panel on mobile day view (user can still use on desktop) */
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
			overflow-y: auto; /* internal scroll for the day's time slots */
			-webkit-overflow-scrolling: touch;
			margin-bottom: 0;
			border-radius: var(--radius-md);
		}

		/* Make the FC container inside fill the remaining height */
		.split-calendar__day {
			height: 100%;
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

	.split-calendar__filters-summary {
		font-weight: var(--font-weight-semibold);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		color: var(--color-text);
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

	.split-calendar__filter-group {
		margin-bottom: var(--space-3);
	}

	.split-calendar__filter-group-label {
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-bottom: var(--space-1);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.split-calendar__filter-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.split-calendar__filter-option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-base);
		padding: 0.1rem 0;
		cursor: pointer;
		color: var(--color-text);
	}

	.split-calendar__filter-option input {
		margin: 0;
		accent-color: var(--color-primary);
	}

	.split-calendar__filter-option-avatar {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		overflow: hidden;
		background-color: var(--color-surface-2);
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 9px;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.split-calendar__filter-option-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.split-calendar__status--completed {
		color: var(--color-success);
	}
	.split-calendar__status--cancelled {
		color: var(--color-danger-emphasis);
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

	/* )=- Crew avatars placed *inside* the event card (no more overhanging to the right).
	   - Time grid card views (week/day): horizontal row at bottom-right inside the card, larger 24px circles.
	   - Month view (dayGridMonth): inline row placed to the right of the event title text, smaller 14px.
	   Row layout for compactness on both. Larger on week/day per request while staying fully contained.
	   )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	:global(.fc-event) {
		position: relative;
		/* overflow visible no longer required for avatars (they stay inside) */
	}

	/* Reserve space at bottom of time-grid event titles so larger avatars at bottom-right don't cover the job title text.
	   )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	:global(.fc-timegrid-event .fc-event-title) {
		padding-bottom: 26px;
	}

	/* Default: inside card (timeGrid week/day views) - bottom right, horizontal row.
	   Larger size (24px) as requested for week and day views while staying fully inside the card.
	   )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	:global(.fc-event__crew-avatars) {
		position: absolute;
		right: 3px;
		bottom: 3px;
		display: flex;
		flex-direction: row;
		gap: 3px;
		z-index: 10;
		pointer-events: none;
	}

	:global(.fc-event__crew-avatar) {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		overflow: hidden;
		border: 1px solid var(--color-surface);
		background: var(--color-text-muted);
		color: var(--color-surface);
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
	}

	:global(.fc-event__crew-avatar img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	/* Month view: inline to the right of the title text (not absolute, flows naturally).
	   Kept small (14px) so they fit nicely in the compact month list items without pushing text around too much.
	   )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	:global(.fc-dayGridMonth-view .fc-event__crew-avatars),
	:global(.fc-dayGridMonth-view .fc-event__crew-avatars--inline) {
		position: static;
		display: inline-flex;
		vertical-align: middle;
		margin-left: 4px;
		gap: 2px;
		z-index: auto;
	}

	:global(.fc-dayGridMonth-view .fc-event__crew-avatar) {
		width: 14px;
		height: 14px;
		font-size: 8px;
		border-width: 1px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
	}

	/* Mobile / touch: larger drag handle + always-visible affordance.
	   The 16px handle is too small for fingers; long-press anywhere on the event still works,
	   but a bigger obvious target helps users discover "hold to drag".
	   Use 24px hit area, higher contrast, and force visible (no hover-only) below 768px.
	   Also slightly thicker shadow for lift visibility during active long-press drag.
	   BEM via the existing global fc- classes.
	   Reference: mobile-specific-tweaks
	*/
	@media (max-width: 768px) {
		:global(.fc-event__drag-handle) {
			width: 28px;
			height: 28px;
			top: 4px;
			right: 4px;
			opacity: 0.95;
			/* Only zone that moves the appointment on mobile (fc-event-draggable lives here). */
			touch-action: none;
		}

		:global(.fc-event__drag-handle.fc-event-draggable) {
			z-index: 25;
		}

		:global(.fc-event--draggable) {
			/* Make drag affordance obvious without relying on :hover on touch */
			box-shadow: 0 0 0 1.5px var(--color-primary);
		}

		:global(.fc-event--draggable:active) {
			/* During the long-press "pop" / active drag start, emphasize the lift */
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
			transform: scale(1.01);
		}

		/* Touch-friendly event resizing on mobile.
		   Drag the top or bottom edge (pill handles) to change length; move uses the + handle only.
		   Resize edge-scroll targets .fc-scroller; move edge-scroll uses FullCalendar dragScroll.
		   Crew avatars move to top-left so the bottom edge stays clear for resizing.
		*/
		:global(.fc-timegrid-event .fc-event__crew-avatars) {
			top: 3px;
			bottom: auto;
			left: 3px;
			right: auto;
		}

		:global(.fc-timegrid-event .fc-event-title) {
			padding-bottom: 10px;
			padding-top: 28px;
		}

		:global(.fc-event-resizer) {
			height: 44px;
			z-index: 22;
			background-color: rgba(255, 255, 255, 0.2);
			border-radius: 4px;
			touch-action: none;
		}

		:global(.fc-event-resizer-end) {
			bottom: -8px;
		}

		:global(.fc-event-resizer-end::after) {
			content: '';
			position: absolute;
			left: 50%;
			bottom: 10px;
			transform: translateX(-50%);
			width: 40px;
			height: 5px;
			border-radius: 3px;
			background: rgba(255, 255, 255, 0.92);
			box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
			pointer-events: none;
		}

		:global(.fc-event-resizer-start) {
			top: -8px;
		}

		:global(.fc-event-resizer-start::after) {
			content: '';
			position: absolute;
			left: 50%;
			top: 10px;
			transform: translateX(-50%);
			width: 40px;
			height: 5px;
			border-radius: 3px;
			background: rgba(255, 255, 255, 0.92);
			box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.15);
			pointer-events: none;
		}

	}

	/* Ghost / drag visual feedback.
	   - The source event (left in place) fades to show it's being moved.
	   - The mirror (the thing that follows the finger) is now semi-transparent (the "ghost")
	     so the user can see through it to the underlying dates/numbers/dots — especially important
	     when dragging over the compact MonthPicker on mobile to choose the exact drop day.
	   - Lower mirror opacity + subtle outline + softer shadow = clear ghost without completely
	     obscuring the target (month day numbers, dots, etc.).
	   Reference: mobile-specific-tweaks
	*/
	:global(.fc-event.fc-event-dragging) {
		opacity: 0.25 !important;
		transition: opacity 0.1s ease;
	}

	:global(.fc-event-mirror) {
		opacity: 0.65;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
		outline: 1px dashed var(--color-border);
		outline-offset: 1px;
	}

	/* === Compact + anchored MonthPicker on mobile ===
	   ~half the normal height. Sticky to top so it is "always visible" above the scrolling day calendar.
	   Reclaims vertical space and supports the "monthly at top, day slots scroll below" mobile pattern.
	   BEM rules + tokens. */
	@media (max-width: 768px) {
		:global(.month-picker) {
			padding: 4px 6px;
			border-radius: var(--radius-sm);
			/* Anchor to top of the mobile viewport / scroll container */
			position: sticky;
			top: 0;
			z-index: 20;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
			background: var(--color-surface);
		}

		:global(.month-picker__header) {
			margin-bottom: 2px;
			padding: 0 2px;
		}

		:global(.month-picker__title) {
			font-size: var(--font-size-xs);
		}

		:global(.month-picker__nav) {
			width: 22px;
			height: 22px;
			font-size: var(--font-size-sm);
		}

		:global(.month-picker__today-btn) {
			padding: 1px 6px;
			font-size: 10px;
		}

		:global(.month-picker__weekdays),
		:global(.month-picker__weekday) {
			font-size: 9px;
			padding: 0;
		}

		:global(.month-picker__day) {
			min-height: 18px; /* significantly tighter vertical space below the day number while keeping usable tap target */
			padding: 0 1px;
			font-size: 10px;
			line-height: 1;
		}

		:global(.month-picker__number) {
			font-size: 10px;
			line-height: 1;
		}

		:global(.month-picker__dots) {
			gap: 1px;
			margin-top: 0;
		}

		:global(.month-picker__dot) {
			width: 2.5px;
			height: 2.5px;
		}
	}
</style>
