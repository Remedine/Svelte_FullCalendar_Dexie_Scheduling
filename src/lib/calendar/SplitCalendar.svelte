<!-- src/lib/calendar/SplitCalendar.svelte -->
<script lang="ts">
	import { Calendar } from '@fullcalendar/core';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getJobsForRange, updateJobDates } from '$lib/db/index';
	import { pullJobsFromServer, pb } from '$lib/db/pb';
	import { openJobModal } from '$lib/components/JobFormModal.svelte';
	import MonthPicker from './MonthPicker.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let isExternalDrop = $state(false);
	let dragMouseListener: ((e: MouseEvent) => void) | null = null;
	let originalEventRect: DOMRect | null = null;

	let dayEl = $state<HTMLDivElement | null>(null);
	let selectedDate = $state(getLocalDateString());
	let jobs = $state<any[]>([]);
	let dayApi: Calendar | null = null;
	let isSyncing = $state(false);
	let currentView = $state('timeGridWeek');
	let crewOptions = $state<string[]>([]);
	let filtersOpen = $state(true);
	let draggedJobId: string | null = $state(null);

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
		import('$lib/db').then(({ db }) => {
			db.users.toArray().then((users: any[]) => {
				crewOptions = users
					.filter((u: any) => u.active)
					.map((u: any) => u.name)
					.sort();
			});
		});
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

	const filteredJobs = $derived(
		jobs.filter((job: any) => {
			const matchesCrew =
				filters.crew.length === 0 ||
				job.assignedCrew?.some((c: string) => filters.crew.includes(c));
			const matchesArea =
				filters.areas.length === 0 || filters.areas.includes(job.areaOfTown);
			const matchesStatus =
				filters.statuses.length === 0 || filters.statuses.includes(job.status);
			return matchesCrew && matchesArea && matchesStatus;
		})
	);

	function getLocalDateString(date: Date = new Date()): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function parseLocalDate(dateStr: string): Date {
		const [y, m, d] = dateStr.split('-').map(Number);
		return new Date(y, m - 1, d);
	}

	function toDateString(d: any): string {
		if (!d) return '';
		const date = d instanceof Date ? d : new Date(d);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getJobColor(job: any): string {
		if (!job?.areaOfTown || !optionsStore.data?.areasOfTown) return '#6b7280';
		const area = optionsStore.data.areasOfTown.find((a: any) => a.id === job.areaOfTown);
		return area?.color || '#6b7280';
	}

	async function loadData() {
		await optionsStore.load?.();
		const includeCancelled = filters.statuses.includes('cancelled');

		const start = new Date(); start.setMonth(start.getMonth() - 2);
		const end = new Date(); end.setMonth(end.getMonth() + 2);

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
			filters[type] = arr.filter(v => v !== value);
		} else {
			filters[type] = [...arr, value];
		}

		const isCancelledToggled = type === 'statuses' && value === 'cancelled';
		const nowCancelledSelected = filters.statuses.includes('cancelled');

		if (isCancelledToggled || (type === 'statuses' && wasCancelledSelected !== nowCancelledSelected)) {
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
			toast.error("Cannot move job to a past date");
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
			toast.error("Failed to move job");
		}
	}

	$effect(() => {
		if (!dayEl || dayApi) return;

		loadData().then(() => {
			dayApi = new Calendar(dayEl, {
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
					openJobModal(
						{ start: info.date },
						() => refreshAfterUpdate()
					);
				},

				eventDidMount: (info) => {
					info.el.setAttribute('draggable', 'true');
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
						toast.error("Cannot move cancelled or completed jobs");
						return;
					}

					draggedJobId = info.event.id!;
					originalEventRect = info.el.getBoundingClientRect();
				},

				eventDragStop: (info) => {
					if (dragMouseListener) {
						document.removeEventListener('mousemove', dragMouseListener);
						dragMouseListener = null;
					}
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

					successCallback(visibleJobs.map((job: any) => ({
						id: job.id,
						title: `${job.title} — ${job.assignedCrew?.join(', ') || ''}`,
						start: job.start,
						end: job.end,
						backgroundColor: getJobColor(job),
						extendedProps: job
					})));
				}
			});

			dayApi.render();
			dayApi.updateSize();
			dayApi.gotoDate(parseLocalDate(selectedDate));
		});
	});

	function handleDateSelect(dateStr: string) {
		selectedDate = dateStr;
		if (dayApi) {
			dayApi.gotoDate(parseLocalDate(dateStr));
			dayApi.refetchEvents();
		}
	}
</script>

<div class="split-calendar-container">
	<div class="split-calendar">
		<!-- Sidebar -->
		<div class="split-calendar__sidebar">
			<MonthPicker 
				jobs={filteredJobs}
				bind:selectedDate 
				onDateSelect={handleDateSelect}
			/>

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
							{#each (optionsStore.data?.areasOfTown || []) as area}
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
						<button class="filters__clear-btn" onclick={clearFilters}>
							Clear all filters
						</button>
					{/if}
				</details>
			</div>
		</div>

		<!-- Main Calendar -->
		<div class="split-calendar__main">
			<div class="split-calendar__view-switcher">
				<button class="view-btn" class:active={currentView === 'timeGridDay'} onclick={() => changeView('timeGridDay')}>Day</button>
				<button class="view-btn" class:active={currentView === 'timeGridWeek'} onclick={() => changeView('timeGridWeek')}>Week</button>
				<button class="view-btn" class:active={currentView === 'dayGridMonth'} onclick={() => changeView('dayGridMonth')}>Month</button>
			</div>

			<div class="split-calendar__day-wrapper" class:refreshing={isSyncing}>
				<div class="split-calendar__day" bind:this={dayEl}></div>
			</div>
		</div>
	</div>
</div>

<style>
	.split-calendar-container { container-type: inline-size; container-name: split-calendar; width: 100%; }
	.split-calendar { display: flex; flex-direction: column; gap: 1rem; width: 100%; min-width: 0; }

	@container split-calendar (min-width: 900px) {
		.split-calendar { flex-direction: row; gap: 1.5rem; align-items: flex-start; }
		.split-calendar__sidebar { flex: 0 0 340px; }
		.split-calendar__main { flex: 1; }
	}

	.split-calendar__sidebar { width: 100%; }
	.split-calendar__main { flex: 1; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }

	.split-calendar__view-switcher { display: none; gap: 0.25rem; }
	@container split-calendar (min-width: 900px) { .split-calendar__view-switcher { display: flex; } }

	.view-btn { padding: 0.4rem 1rem; border: 1px solid #e2e8f0; background: white; border-radius: 6px; font-size: 0.9rem; cursor: pointer; }
	.view-btn:hover { background: #f8fafc; }
	.view-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }

	.split-calendar__day-wrapper { flex: 1; display: flex; flex-direction: column; background: white; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; min-height: 650px; transition: opacity 0.2s ease; }
	.split-calendar__day-wrapper.refreshing { opacity: 0.6; pointer-events: none; }
	.split-calendar__day { flex: 1; min-height: 600px; min-width: 0; overflow: hidden; }

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

	.filter-group { margin-bottom: 0.85rem; }
	.filter-group__label { font-weight: 600; font-size: 0.85rem; color: #334155; margin-bottom: 0.35rem; }
	.filter-options { display: flex; flex-direction: column; gap: 0.25rem; }
	.filter-option { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; padding: 0.15rem 0; cursor: pointer; }
	.filter-option input { margin: 0; }

	.status-completed { color: #166534; }
	.status-cancelled { color: #991b1b; }

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
	:global(.event-completed) { opacity: 0.55; }
	:global(.event-completed .fc-event-title) { text-decoration: line-through; }
	:global(.event-cancelled) { opacity: 0.65; border-style: dashed !important; cursor: not-allowed; }
	:global(.event-cancelled .fc-event-title) { text-decoration: line-through; color: #991b1b; }
</style>