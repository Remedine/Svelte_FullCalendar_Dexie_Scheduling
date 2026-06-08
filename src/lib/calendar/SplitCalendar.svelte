<!-- src/lib/calendar/SplitCalendar.svelte -->
<script lang="ts">
	import { Calendar } from '@fullcalendar/core';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getJobsForRange, updateJobDates } from '$lib/db/index';
	import { pullJobsFromServer, pb } from '$lib/db/pb';
	import { openJobModal } from '$lib/components/JobFormModal.svelte';
	import MonthPicker from './MonthPicker.svelte';
	import { toast } from '$lib/stores/toast.svelte.ts';

	let dayEl = $state<HTMLDivElement | null>(null);
	let selectedDate = $state(getLocalDateString());
	let jobs = $state<any[]>([]);
	let dayApi: Calendar | null = null;
	let isSyncing = $state(false);

	// Get today's date in local time (avoids UTC shift bug)
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
		const start = new Date(); start.setMonth(start.getMonth() - 2);
		const end = new Date(); end.setMonth(end.getMonth() + 2);
		jobs = await getJobsForRange(start, end);
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
			await loadData();
			dayApi?.refetchEvents();
		} catch (e) {
			toast.dismiss(syncToast);
			toast.error('Failed to sync changes');
		} finally {
			isSyncing = false;
		}
	}

	$effect(() => {
		if (!dayEl || dayApi) return;

		loadData().then(() => {
			dayApi = new Calendar(dayEl, {
				plugins: [timeGridPlugin, interactionPlugin],
				initialView: 'timeGridDay',
				initialDate: parseLocalDate(selectedDate),
				headerToolbar: false,
				dayHeaders: false,
				height: 'auto',
				allDaySlot: true,
				slotMinTime: '06:00:00',
				slotMaxTime: '22:00:00',
				expandRows: false,
				editable: true,

				eventDragStart: () => {},
				eventDragStop: () => {},

				select: (info) => {
					openJobModal({ start: info.start, end: info.end }, () => {
						refreshAfterUpdate();
					});
				},

				eventClick: (info) => {
					openJobModal(info.event.extendedProps, () => {
						refreshAfterUpdate();
					});
				},

				eventDrop: async (info) => {
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

				events: (info, successCallback) => {
					const selectedStr = selectedDate;
					const dayJobs = jobs.filter((job: any) => {
						const jobStartStr = toDateString(job.start);
						const jobEndStr = job.end ? toDateString(job.end) : jobStartStr;
						return selectedStr >= jobStartStr && selectedStr <= jobEndStr;
					});

					successCallback(dayJobs.map((job: any) => ({
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

			setTimeout(() => {
				dayApi?.refetchEvents();
			}, 100);
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
				{jobs}
				bind:selectedDate 
				onDateSelect={handleDateSelect} 
			/>
		</div>

		<!-- Day View -->
		<div class="split-calendar__day-wrapper" class:refreshing={isSyncing}>
			<div class="split-calendar__day-header">
				{parseLocalDate(selectedDate).toLocaleDateString(undefined, { 
					weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' 
				})}
			</div>
			<div class="split-calendar__day" bind:this={dayEl}></div>
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

	@container split-calendar (min-width: 900px) {
		.split-calendar {
			flex-direction: row;
			gap: 1.5rem;
			align-items: flex-start;
		}

		.split-calendar__sidebar {
			flex: 0 0 340px;
		}

		.split-calendar__day-wrapper {
			flex: 1;
			min-height: 700px;
		}
	}

	.split-calendar__sidebar {
		width: 100%;
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
	}

	.split-calendar__day-wrapper.refreshing {
		opacity: 0.6;
		pointer-events: none;
	}

	.split-calendar__day-header {
		padding: 0.75rem 1rem;
		font-weight: 600;
		text-align: center;
		background: #f8fafc;
		border-bottom: 1px solid #e2e8f0;
		flex-shrink: 0;
	}

	.split-calendar__day {
		flex: 1;
		min-height: 600px;
		min-width: 0;
		overflow: hidden;
	}

	/* Drag visual feedback */
	:global(.fc-event-dragging) {
		opacity: 0.85;
		transform: scale(1.02);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		transition: transform 0.1s ease, box-shadow 0.1s ease;
	}

	/* Wider sidebar on very large screens */
	@container split-calendar (min-width: 1400px) {
		.split-calendar__sidebar {
			flex-basis: 380px;
		}
	}
</style>