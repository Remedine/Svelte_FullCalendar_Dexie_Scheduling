<!-- src/lib/calendar/Calendar.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { Calendar } from '@fullcalendar/core';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import multiMonthPlugin from '@fullcalendar/multimonth';
	import { getJobsForRange, updateJobDates, updateJob, cancelJob } from '$lib/db/index';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { db } from '$lib/db';
	import JobFormModal, { openJobModal } from '$lib/components/JobFormModal.svelte';

	let calendarEl: HTMLDivElement;
	let calendarInstance: Calendar | null = $state(null);

	let crewOptions = $state<string[]>([]);

	// Load crew members
	$effect(() => {
		db.users
			.toArray()
			.then(users => {
				crewOptions = users
					.filter(u => u.active === true)
					.map(u => u.name)
					.sort();
			})
			.catch(err => {
				console.error('Failed to load crew:', err);
				crewOptions = [];
			});
	});

	// )=- Ensure options are loaded and refresh calendar when areas change
	$effect(() => {
		if (optionsStore.data?.areasOfTown) {
			calendarInstance?.refetchEvents();
		} else {
			optionsStore.load?.();
		}
	});

	function getEventColor(areaId: string): string {
		if (!areaId || !optionsStore.data?.areasOfTown?.length) {
			return '#6b7280'; // fallback gray
		}
		const area = optionsStore.data.areasOfTown.find((a: any) => a.id === areaId);
		return area?.color || '#6b7280';
	}

	onMount(async () => {
		await optionsStore.load?.();

		calendarInstance = new Calendar(calendarEl, {
			plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin],
			initialView: 'timeGridWeek',
			editable: true,
			selectable: true,
			height: '100%',
			expandRows: true,

			headerToolbar: {
				left: 'prev,next today',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,timeGridDay'
			},

			select: (info) => {
				const startTime = info.start;
				const endTime = info.end || new Date(startTime.getTime() + 4 * 60 * 60 * 1000);

				openJobModal({
					start: startTime,
					end: endTime
				}, () => {
					calendarInstance?.refetchEvents();
				});
			},

			eventDrop: async (info) => {
				const jobId = info.event.id;
				if (!jobId) return;

				try {
					await updateJobDates(jobId, info.event.start!, info.event.end!);
					setTimeout(() => calendarInstance?.refetchEvents(), 400);
				} catch (err) {
					console.error('❌ Update failed', err);
					info.revert();
				}
			},

			eventResize: async (info) => {
				const jobId = info.event.id;
				if (!jobId) return;

				try {
					await updateJobDates(jobId, info.event.start!, info.event.end!);
					setTimeout(() => calendarInstance?.refetchEvents(), 300);
				} catch (err) {
					console.error('❌ Resize failed', err);
					info.revert();
				}
			},

			eventClick: async (info) => {
				const job = info.event.extendedProps as any;
				if (!job?.id) return;

				openJobModal(job, () => {
					calendarInstance?.refetchEvents();
				});
			},

			events: async (fetchInfo, successCallback) => {
				let jobs = await getJobsForRange(fetchInfo.start, fetchInfo.end);

				if (auth.currentUser?.role === 'crew') {
					jobs = jobs.filter((job: any) => 
						job.assignedCrew?.some((crewName: string) => 
							crewName === auth.currentUser!.name
						)
					);
				}

				const events = jobs.map((job: any) => ({
					id: job.id,
					title: `${job.title} — ${job.assignedCrew.join(', ')}`,
					start: job.start,
					end: job.end,
					backgroundColor: getEventColor(job.areaOfTown),
					extendedProps: job
				}));

				successCallback(events);
			}
		});

		calendarInstance.render();
	});

	$effect(() => {
		return () => calendarInstance?.destroy();
	});
</script>

<div class="calendar-wrapper">
	<!-- Role indicator -->
	<div class="calendar-header__role">
		{#if auth.currentUser}
			<span class="calendar-header__role-badge {auth.currentUser.role}">
				{auth.currentUser.role === 'admin' ? '👑 Admin - All Jobs' : `👷 Crew View - ${auth.currentUser.name}`}
			</span>
		{/if}
	</div>

	<div bind:this={calendarEl} class="calendar-container"></div>
</div>

<!-- Reusable Job Modal -->
<JobFormModal />

<style>
	.calendar-wrapper {
		height: 100vh;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		background: #f8fafc;
	}

	.calendar-container {
		flex: 1;
		min-height: 0;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}

	.calendar-header__role {
		padding: 0.75rem 1rem;
		text-align: right;
		background: white;
		border-bottom: 1px solid #e2e8f0;
	}

	.calendar-header__role-badge {
		display: inline-block;
		padding: 0.4rem 1rem;
		border-radius: 9999px;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.calendar-header__role-badge.admin {
		background: #1e40af;
		color: white;
	}

	.calendar-header__role-badge.crew {
		background: #166534;
		color: white;
	}
</style>