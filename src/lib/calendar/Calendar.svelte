<script lang="ts">
	import { onMount } from 'svelte';
	import { Calendar } from '@fullcalendar/core';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import multiMonthPlugin from '@fullcalendar/multimonth';

	import { getJobsForRange } from '$lib/db/index';
	import { forceSeed } from '$lib/db/seed';

	let calendarEl: HTMLDivElement;
	let calendarInstance: Calendar | null = $state(null);

	onMount(async () => {
		// )=- Force seed
		await forceSeed();

		calendarInstance = new Calendar(calendarEl, {
			plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin],
			initialView: 'timeGridWeek',
			editable: true,
			selectable: true,
			height: '100%',           // )=- Critical
			expandRows: true,         // )=- Helps fill the space
			headerToolbar: {
				left: 'prev,next today',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,timeGridDay'
			},
			events: async (fetchInfo, successCallback) => {
				const jobs = await getJobsForRange(fetchInfo.start, fetchInfo.end);
				console.log(`📅 Loaded ${jobs.length} jobs for range`, jobs); // )=- Debug

				const events = jobs.map((job: any) => ({
					id: job.id?.toString() || '',
					title: `${job.title} — ${job.assignedCrew.join(', ')}`,
					start: job.start,
					end: job.end,
					backgroundColor: getEventColor(job.areaOfTown),
					extendedProps: {
						clientId: job.clientId,
						assignedCrew: job.assignedCrew,
						status: job.status,
						areaOfTown: job.areaOfTown
					}
				}));

				successCallback(events);
			}
		});

		calendarInstance.render();
	});

	function getEventColor(area: string): string {
		switch (area) {
			case 'thane': return '#3b82f6';
			case 'downtown': return '#10b981';
			case 'douglas': return '#8b5cf6';
			default: return '#6b7280';
		}
	}

	// Cleanup
	$effect(() => {
		return () => calendarInstance?.destroy();
	});
</script>

<div class="calendar-wrapper">
	<div bind:this={calendarEl} class="calendar-container"></div>
</div>

<style>
	.calendar-wrapper {
		height: 100vh;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		background: #f8fafc;
	}

	.calendar-container {
		flex: 1;           /* )=- This is the key fix */
		min-height: 0;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}
</style>