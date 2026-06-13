<!-- src/lib/calendar/SplitCalendar.svelte -->
<script lang="ts">
	import { Calendar } from '@fullcalendar/core';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getJobsForRange, updateJobDates, getUserPhotoSrc } from '$lib/db/index';
	import { pullJobsFromServer, pb } from '$lib/db/pb';
	import { openJobModal } from '$lib/components/JobFormModal.svelte';
	import MonthPicker from './MonthPicker.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	// )=- Date helpers extracted to pure $lib/utils/dates.ts in Phase 1 of the testing plan.
	// This removes duplication with JobInvoicePanel and enables strong unit testing of the local-date logic
	// that was the source of multiple due-date / calendar jump bugs.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + TESTING_PLAN.md
	import { getLocalDateString, parseLocalDate, toDateString } from '$lib/utils/dates';

	// )=- Drag state kept as plain `let` (not $state) to avoid triggering reactivity, deriveds,
	// and $effects (which do refetch/update) on every pointer event during drag.
	// This was causing the "dog slow" feel and inability to complete drops – FullCalendar's
	// drag handling was being interrupted by parent re-renders and refetch thrashing.
	// Only used inside drag handlers; no UI binding depends on them reactively.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	let isExternalDrop = false;
	let originalEventRect: DOMRect | null = null;

	let dayEl = $state<HTMLDivElement | null>(null);
	let selectedDate = $state(
		// )=- Support ?date=YYYY-MM-DD from job details "Jump to calendar" (and direct links).
		// Sets the initial view date so the calendar focuses the relevant day/week when jumping from a job.
		// Works on initial load of the split calendar page.
		// Reference: JOBS_AND_INVOICES_SPEC.md (calendar jump improvements in Phase 7)
		typeof window !== 'undefined'
			? new URLSearchParams(window.location.search).get('date') || getLocalDateString()
			: getLocalDateString()
	);
	let jobs = $state<any[]>([]);
	let dayApi: Calendar | null = null;
	let isSyncing = $state(false);
	let currentView = $state('timeGridWeek');
	let crewOptions = $state<string[]>([]);

	// )=- Map of crew name to photo URL for rendering circular avatars on event cards.
	let crewPhotoMap = $state<Record<string, string>>({});
	let filtersOpen = $state(true);
	let draggedJobId: string | null = null;

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
		import('$lib/db').then(async ({ db, cleanupDuplicateUsers }) => {
			await cleanupDuplicateUsers();
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
	// )=- Use dynamic import to match the crewOptions pattern and avoid top-level db dependency.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	$effect(() => {
		if (Object.keys(crewPhotoMap).length === 0) {
			import('$lib/db').then(({ db }) => {
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

		const observer = new ResizeObserver(() => {
			// )=- Throttled with rAF + only updateSize (render is expensive and was causing jank).
			// setTimeout + nested render was adding to the constant "reloading" feel.
			// FullCalendar will handle most layout in updateSize during normal use.
			// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
			requestAnimationFrame(() => {
				if (dayApi) {
					dayApi.updateSize();
					dayApi.setOption('height', 'auto');
				}
			});
		});

		observer.observe(wrapper);

		return () => observer.disconnect();
	});
	// === FILTERS ===
	let filters = $state({
		crew: [] as string[],
		areas: [] as string[],
		statuses: [] as string[]
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

	const filteredJobs = $derived(
		jobs.filter((job: any) => {
			const matchesCrew =
				filters.crew.length === 0 ||
				job.assignedCrew?.some((c: string) => filters.crew.includes(c));
			const matchesArea = filters.areas.length === 0 || filters.areas.includes(job.areaOfTown);
			const matchesStatus = filters.statuses.length === 0 || filters.statuses.includes(job.status);
			return matchesCrew && matchesArea && matchesStatus;
		})
	);

	// )=- Local date functions were extracted to $lib/utils/dates (imported above).
	// getJobColor remains local because it depends on the optionsStore (not a pure date util).
	function getJobColor(job: any): string {
		if (!job?.areaOfTown || !optionsStore.data?.areasOfTown) return '#6b7280';
		const area = optionsStore.data.areasOfTown.find((a: any) => a.id === job.areaOfTown);
		return area?.color || '#6b7280';
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
		import('$lib/db').then(({ db }) => {
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
		});

		const includeCancelled = filters.statuses.includes('cancelled');

		const start = new Date();
		start.setMonth(start.getMonth() - 2);
		const end = new Date();
		end.setMonth(end.getMonth() + 2);

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

			const includeCancelled = filters.statuses.includes('cancelled');

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
		filters = {
			crew: [],
			areas: [],
			statuses: []
		};
		loadData().then(() => {
			dayApi?.refetchEvents();
		});
	}

	async function handleExternalDrop(jobId: string, mouseX: number, mouseY: number) {
		const job = jobs.find((j: any) => j.id === jobId);
		if (!job) return;

		const dropTarget = document.elementFromPoint(mouseX, mouseY);
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
			await refreshAfterUpdate();
		} catch (e) {
			toast.error('Failed to move job');
		}
	}

	$effect(() => {
		// )=- Use a *local* `api` variable for this effect execution (Svelte 5 best practice
		// for imperative libs like FullCalendar). Added early `if (dayApi) return;` to
		// prevent the effect from even scheduling creation on re-runs (e.g. other state
		// changes in the component or parent re-renders). This avoids accumulation of
		// multiple FC instances (each holding significant memory: internal date state,
		// event renderers, DOM structures, plugins, closures) which was likely causing
		// the 700MB+ usage even with 1 job.
		// Previous cleanup still destroys on teardown.
		// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
		if (dayApi) return;

		let api: Calendar | null = null;

		const container = dayEl;
		if (!container) return;

		loadData().then(() => {
			if (api || !container.isConnected) return;

			api = new Calendar(container, {
				plugins: [timeGridPlugin, dayGridPlugin, interactionPlugin],
				initialView: currentView,
				initialDate: parseLocalDate(selectedDate),
				headerToolbar: false,
				height: 'auto',
				allDaySlot: true,
				slotMinTime: '06:00:00',
				slotMaxTime: '22:00:00',
				expandRows: false,
				editable: true,
				dragScroll: false,
				eventDragMinDistance: 8,

				dateClick: (info) => {
					openJobModal({ start: info.date }, () => refreshAfterUpdate());
				},

				eventDidMount: (info) => {
					// )=- Do NOT set draggable="true" here. It enables native HTML5 drag which interferes with FullCalendar's own drag system (editable events), causing D&D to not work or behave erratically (native vs FC drag fighting).
					// The visual drag handle + CSS hover is sufficient for UX. FC handles the actual drag start internally on the event.
					// This was likely contributing to "Drag and drop isn't working".
					// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
					info.el.classList.add('fc-event--draggable');

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
					const status = arg.event.extendedProps?.status;
					if (status === 'completed') return ['event-completed'];
					if (status === 'cancelled') return ['event-cancelled'];
					return [];
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

					draggedJobId = info.event.id!;
					originalEventRect = info.el.getBoundingClientRect();
				},

				eventDragStop: (info) => {
					originalEventRect = null;

					if (!draggedJobId) return;

					const monthPickerEl = document.querySelector('.month-picker');
					if (!monthPickerEl) {
						draggedJobId = null;
						return;
					}

					const mouseX = info.jsEvent.clientX;
					const mouseY = info.jsEvent.clientY;

					let dropTarget = document.elementFromPoint(mouseX, mouseY);
					let monthPickerDay = dropTarget?.closest('.month-picker__day');

					if (!monthPickerDay) {
						const rect = monthPickerEl.getBoundingClientRect();
						const isOverContainer =
							mouseX >= rect.left && mouseX <= rect.right &&
							mouseY >= rect.top && mouseY <= rect.bottom;

						if (isOverContainer) {
							const dayElements = monthPickerEl.querySelectorAll('.month-picker__day');
							for (const el of dayElements) {
								const r = el.getBoundingClientRect();
								if (mouseX >= r.left && mouseX <= r.right && mouseY >= r.top && mouseY <= r.bottom) {
									monthPickerDay = el;
									break;
								}
							}
						}
					}

					if (monthPickerDay) {
						isExternalDrop = true;
						handleExternalDrop(draggedJobId, mouseX, mouseY);
					}

					draggedJobId = null;
				},

				select: (info) => {
					openJobModal({ start: info.start, end: info.end }, () => refreshAfterUpdate());
				},

				eventClick: (info) => {
					openJobModal(info.event.extendedProps, () => refreshAfterUpdate());
				},

				eventDrop: async (info) => {
					if (isExternalDrop) {
						isExternalDrop = false;
						return;
					}
					try {
						await updateJobDates(info.event.id!, info.event.start!, info.event.end!);
						await refreshAfterUpdate();
					} catch (e) {
						info.revert();
					}
				},

				eventResize: async (info) => {
					try {
						await updateJobDates(info.event.id!, info.event.start!, info.event.end!);
						await refreshAfterUpdate();
					} catch (e) {
						info.revert();
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
				api?.gotoDate(parseLocalDate(selectedDate));
			});
		});

		return () => {
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
			<div class="filters">
				<details bind:open={filtersOpen}>
					<summary class="filters__summary">
						<span>Filters</span>
						{#if activeFilterCount > 0}
							<span class="filters__badge">{activeFilterCount}</span>
						{/if}
					</summary>

					<!-- Crew -->
					<div class="filter-group">
						<div class="filter-group__label">Crew</div>
						<div class="filter-options">
							{#each crewOptions as crew}
								<label class="filter-option">
									<input
										type="checkbox"
										checked={filters.crew.includes(crew)}
										onchange={() => toggleFilter('crew', crew)}
									/>
									<span>{crew}</span>
								</label>
							{/each}
						</div>
					</div>

					<!-- Area -->
					<div class="filter-group">
						<div class="filter-group__label">Area</div>
						<div class="filter-options">
							{#each optionsStore.data?.areasOfTown || [] as area}
								<label class="filter-option">
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
					<div class="filter-group">
						<div class="filter-group__label">Status</div>
						<div class="filter-options">
							{#each ['scheduled', 'confirmed', 'completed', 'cancelled'] as status}
								<label class="filter-option">
									<input
										type="checkbox"
										checked={filters.statuses.includes(status)}
										onchange={() => toggleFilter('statuses', status)}
									/>
									<span class="status-{status}">{status}</span>
								</label>
							{/each}
						</div>
					</div>

					{#if activeFilterCount > 0}
						<button class="filters__clear-btn" onclick={clearFilters}> Clear all filters </button>
					{/if}
				</details>
			</div>
		</div>

		<!-- Main Calendar -->
		<div class="split-calendar__main">
			<div class="split-calendar__view-switcher">
				<button
					class="view-btn"
					class:active={currentView === 'timeGridDay'}
					onclick={() => changeView('timeGridDay')}>Day</button
				>
				<button
					class="view-btn"
					class:active={currentView === 'timeGridWeek'}
					onclick={() => changeView('timeGridWeek')}>Week</button
				>
				<button
					class="view-btn"
					class:active={currentView === 'dayGridMonth'}
					onclick={() => changeView('dayGridMonth')}>Month</button
				>
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
	}

	.split-calendar {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
		min-width: 0;
	}

	/* Desktop layout */
	@container split-calendar (min-width: 900px) {
		.split-calendar {
			flex-direction: row;
			gap: 1.5rem;
			align-items: flex-start;
		}

		.split-calendar__sidebar {
			flex: 0 0 340px;
			flex-shrink: 0;
			width: auto;
			max-width: 340px;
		}

		.split-calendar__main {
			flex: 1;
			min-width: 0;
		}
	}

	.split-calendar__sidebar {
		width: 100%;
	}

	.split-calendar__main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.split-calendar__view-switcher {
		display: none;
		gap: 0.25rem;
	}

	@container split-calendar (min-width: 900px) {
		.split-calendar__view-switcher {
			display: flex;
		}
	}

	.view-btn {
		padding: 0.4rem 1rem;
		border: 1px solid #e2e8f0;
		background: white;
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.view-btn:hover {
		background: #f8fafc;
	}

	.view-btn.active {
		background: #3b82f6;
		color: white;
		border-color: #3b82f6;
	}

	.split-calendar__day-wrapper {
		flex: 1;
		display: flex;
		flex-direction: column;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		overflow: hidden;
		min-height: 650px;
		transition: opacity 0.2s ease;
		width: 100%; /* Helps FullCalendar detect size changes */
	}

	.split-calendar__day-wrapper.refreshing {
		opacity: 0.6;
		pointer-events: none;
	}

	.split-calendar__day {
		flex: 1;
		min-height: 600px;
		min-width: 0;
		overflow: hidden;
		width: 100%; /* Important for responsive width */
	}

	/* Filters */
	.filters {
		margin-top: 1rem;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 1rem;
		font-size: 0.95rem;
	}

	.filters__summary {
		font-weight: 600;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.filters__badge {
		background: #3b82f6;
		color: white;
		font-size: 0.75rem;
		padding: 0.1rem 0.45rem;
		border-radius: 9999px;
		min-width: 18px;
		text-align: center;
	}

	.filters__clear-btn {
		margin-top: 0.75rem;
		width: 100%;
		padding: 0.5rem;
		background: #fee2e2;
		color: #b91c1c;
		border: none;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}

	.filters__clear-btn:hover {
		background: #fecaca;
	}

	.filter-group {
		margin-bottom: 0.85rem;
	}
	.filter-group__label {
		font-weight: 600;
		font-size: 0.85rem;
		color: #334155;
		margin-bottom: 0.35rem;
	}
	.filter-options {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.filter-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		padding: 0.15rem 0;
		cursor: pointer;
	}
	.filter-option input {
		margin: 0;
	}

	.status-completed {
		color: #166534;
	}
	.status-cancelled {
		color: #991b1b;
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
		box-shadow: 0 0 0 1px #3b82f6;
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
		color: #991b1b;
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
		border: 1px solid #fff;
		background: #64748b;
		color: #fff;
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
</style>
