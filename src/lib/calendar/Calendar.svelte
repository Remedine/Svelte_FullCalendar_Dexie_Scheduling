<!-- src/lib/calendar/Calendar.svelte -->
<script lang="ts">
	// )=- Final cleaned version after successful debugging.
	// )=- Removed unused crewOptions state (was never referenced).
	// )=- All core functionality preserved. File is now leaner and maintainable.
	// )=- Pure Svelte 5 runes + strict BEM. References Remedine/Svelte_FullCalendar_Dexie_Scheduling.

	import { Calendar } from '@fullcalendar/core';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import multiMonthPlugin from '@fullcalendar/multimonth';
	import { browser } from '$app/environment';
	import { getJobsForRange, updateJobDates } from '$lib/db/index';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { getUserDisplayName, isJobAssignedToCrew } from '$lib/utils/crew';
	import { getCalendarSlotBounds } from '$lib/utils/calendar';
	import { db } from '$lib/db';
	import JobFormModal, { openJobModal } from '$lib/components/JobFormModal.svelte';
	import { toast } from '$lib/stores/toast.svelte';

	let calendarEl = $state<HTMLDivElement | null>(null);
	let calendarInstance = $state<Calendar | null>(null);

	// Optional: keep this effect if you plan to use crewOptions later for filtering
	// $effect(() => { ... load crew ... });

	$effect(() => {
		if (optionsStore.data?.areasOfTown) {
			calendarInstance?.refetchEvents();
		} else {
			optionsStore.load?.();
		}
	});

	// )=- Ensure colors load right away if options arrive after initial events render.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	$effect(() => {
		if (calendarInstance && optionsStore.data?.areasOfTown?.length) {
			calendarInstance.refetchEvents();
		}
	});

	function getEventColor(areaId: string): string {
		if (!areaId || !optionsStore.data?.areasOfTown?.length) return '#6b7280';
		const area = optionsStore.data.areasOfTown.find((a: any) => a.id === areaId);
		return area?.color || '#6b7280';
	}

	$effect(() => {
		if (!browser || !calendarEl || calendarInstance) return;
		initCalendar(calendarEl);
	});

	const calendarSlotBounds = $derived(getCalendarSlotBounds(optionsStore.data));

	async function initCalendar(el: HTMLDivElement) {
		await optionsStore.load?.();
		const bounds = getCalendarSlotBounds(optionsStore.data);

		calendarInstance = new Calendar(el, {
			plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin],
			initialView: 'timeGridWeek',
			editable: true,
			selectable: true,
			height: '100%',
			expandRows: true,
			nowIndicator: true,
			slotMinTime: bounds.slotMinTime,
			slotMaxTime: bounds.slotMaxTime,
			// Mobile hold-to-drag support (see SplitCalendar for details + rationale).
			eventLongPressDelay: 280,
			selectLongPressDelay: 280,
			longPressDelay: 280,
			eventDragMinDistance: 10,

			headerToolbar: {
				left: 'prev,next today',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,timeGridDay'
			},

			select: (info) => {
				openJobModal({ start: info.start }, () => calendarInstance?.refetchEvents());
			},

			eventDrop: async (info: any) => {
				try {
					await updateJobDates(info.event.id!, info.event.start!, info.event.end!);
					setTimeout(() => calendarInstance?.refetchEvents(), 400);
				} catch (e) {
					info.revert();
					toast.error('Could not move appointment');
				}
			},

			eventResize: async (info) => {
				try {
					await updateJobDates(info.event.id!, info.event.start!, info.event.end!);
					setTimeout(() => calendarInstance?.refetchEvents(), 300);
				} catch (e) {
					info.revert();
					toast.error('Could not resize appointment');
				}
			},

			eventClick: (info) => {
				openJobModal(info.event.extendedProps, () => calendarInstance?.refetchEvents());
			},

			events: async (fetchInfo, successCallback) => {
				let jobs = await getJobsForRange(fetchInfo.start, fetchInfo.end);

				if (auth.currentUser?.role === 'crew') {
					const crewName = getUserDisplayName(auth.currentUser);
					jobs = jobs.filter((j: any) => isJobAssignedToCrew(j, crewName));
				}

				successCallback(
					jobs.map((job: any) => ({
						id: job.id,
						// )=- Title simplified (crew shown via avatars on right of card in Split view; here for compatibility).
						title: job.title,
						start: job.start,
						end: job.end,
						backgroundColor: getEventColor(job.areaOfTown),
						extendedProps: job
					}))
				);
			}
		});

		requestAnimationFrame(() => {
			calendarInstance?.render();
			calendarInstance?.updateSize();
		});
	}

	$effect(() => {
		const { slotMinTime, slotMaxTime } = calendarSlotBounds;
		if (calendarInstance) {
			calendarInstance.setOption('slotMinTime', slotMinTime);
			calendarInstance.setOption('slotMaxTime', slotMaxTime);
		}
	});

	$effect(() => {
		return () => calendarInstance?.destroy();
	});
</script>

<div class="calendar__wrapper">
	<div class="calendar__header">
		{#if auth.currentUser}
			<span
				class="calendar__role-badge"
				class:calendar__role-badge--admin={auth.currentUser.role === 'admin'}
				class:calendar__role-badge--crew={auth.currentUser.role === 'crew'}
			>
				{auth.currentUser.role === 'admin'
					? '👑 Admin - All Jobs'
					: `👷 Crew View - ${auth.currentUser.name}`}
			</span>
		{/if}
	</div>

	<div bind:this={calendarEl} class="calendar__container"></div>
</div>

<JobFormModal />

<style>
	.calendar__wrapper {
		flex: 1;
		min-height: 2000px; /* Safety net so it never collapses */
		display: flex;
		flex-direction: column;
		padding: 0.5rem;
		background: #f8fafc;
		margin-bottom: 20px !important;
	}

	.calendar__header {
		padding: 0.5rem 0.75rem;
		text-align: right;
		background: white;
		border-bottom: 1px solid #e2e8f0;
		flex-shrink: 0;
	}

	.calendar__role-badge {
		display: inline-block;
		padding: 0.35rem 0.9rem;
		border-radius: 9999px;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.calendar__role-badge--admin {
		background: #1e40af;
		color: white;
	}
	.calendar__role-badge--crew {
		background: #166534;
		color: white;
	}

	.calendar__container {
		flex: 1;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		max-width: 98vw;
		height: 2000px;
	}
</style>
