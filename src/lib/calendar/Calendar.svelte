<script lang="ts">
	import { onMount } from 'svelte';
	import FullCalendar from '@fullcalendar/core';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import interactionPlugin from '@fullcalendar/interaction';

	import { BUSINESS_CONFIG } from '$lib/config';
	import type { Job } from '$lib/db';
	import { getJobsForRange } from '$lib/db';

	// Svelte 5 Props
	let { jobs = [] }: { jobs?: Job[] } = $props();

	let calendarEl: HTMLElement;
	let calendar: FullCalendar | null = null;

	onMount(() => {
		calendar = new FullCalendar(calendarEl, {
			plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],

			initialView: 'timeGridWeek',
			headerToolbar: {
				left: 'prev,next today',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,timeGridDay'
			},

			editable: true,
			selectable: true,
			selectMirror: true,
			dayMaxEvents: true,

			// Custom Event Rendering using colors from config
			eventContent: (arg) => {
				const job = arg.event.extendedProps as Job;
				const areaConfig = BUSINESS_CONFIG.areasOfTown[job.areaOfTown];

				const html = `
					<div class="calendar-event" 
					     style="background-color: ${areaConfig.color};">
						<div class="calendar-event__title">${arg.event.title}</div>
						<div class="calendar-event__crew">
							${job.assignedCrew.map((crew) => 
								`<span class="calendar-event__crew-member">${crew}</span>`
							).join('')}
						</div>
					</div>
				`;

				const div = document.createElement('div');
				div.innerHTML = html;
				return { domNodes: [div] };
			},

			eventClick: (info) => {
				console.log('Job clicked:', info.event.extendedProps);
			},

			events: async (fetchInfo, successCallback) => {
				const fetchedJobs = await getJobsForRange(fetchInfo.start, fetchInfo.end);
				const events = fetchedJobs.map((job) => ({
					id: job.id?.toString(),
					title: job.title,
					start: job.start,
					end: job.end,
					extendedProps: job
				}));
				successCallback(events);
			}
		});

		calendar.render();

		return () => calendar?.destroy();
	});
</script>

<div class="calendar-wrapper">
	<div bind:this={calendarEl} class="calendar"></div>
</div>

<style>
	.calendar-wrapper {
		padding: 1rem;
		height: 100%;
		background: white;
	}

	.calendar {
		max-width: 100%;
		margin: 0 auto;
	}

	/* BEM Base Styles */
	.calendar-event {
		padding: 6px 8px;
		border-radius: 6px;
		font-size: 0.875rem;
		color: white;
		overflow: hidden;
		line-height: 1.3;
	}

	.calendar-event__title {
		font-weight: 600;
		margin-bottom: 4px;
	}

	.calendar-event__crew {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}

	.calendar-event__crew-member {
		background: rgba(255, 255, 255, 0.3);
		padding: 1px 7px;
		border-radius: 9999px;
		font-size: 0.75rem;
	}
</style>