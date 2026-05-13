<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';

	import { BUSINESS_CONFIG } from '$lib/config';
	import type { Job } from '$lib/db';
	import { getJobsForRange } from '$lib/db';

	let { jobs = [] }: { jobs?: Job[] } = $props();

	let calendarEl = $state<HTMLElement | null>(null);
	let calendar: any = $state(null);

	// Only run on client
	onMount(async () => {
		if (!browser) return;

		try {
			const { Calendar } = await import('@fullcalendar/core');
			const dayGrid = await import('@fullcalendar/daygrid');
			const timeGrid = await import('@fullcalendar/timegrid');
			const interaction = await import('@fullcalendar/interaction');

			calendar = new Calendar(calendarEl!, {
				plugins: [dayGrid.default, timeGrid.default, interaction.default],

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

				eventContent: (arg: any) => {
					const job = arg.event.extendedProps as Job;
					const areaConfig = BUSINESS_CONFIG.areasOfTown[job.areaOfTown];

					const html = `
						<div class="calendar-event" style="background-color: ${areaConfig.color};">
							<div class="calendar-event__title">${arg.event.title}</div>
							<div class="calendar-event__crew">
								${job.assignedCrew.map((crew: string) => 
									`<span class="calendar-event__crew-member">${crew}</span>`
								).join('')}
							</div>
						</div>
					`;

					const div = document.createElement('div');
					div.innerHTML = html;
					return { domNodes: [div] };
				},

				events: async (fetchInfo: any, successCallback: any) => {
					const fetchedJobs = await getJobsForRange(fetchInfo.start, fetchInfo.end);
					const events = fetchedJobs.map((job: Job) => ({
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
		} catch (err) {
			console.error('Failed to load FullCalendar:', err);
		}

		return () => {
			calendar?.destroy();
		};
	});
</script>

<div class="calendar-wrapper">
	{#if browser}
		<div bind:this={calendarEl} class="calendar"></div>
	{:else}
		<div class="calendar-loading">Loading scheduler...</div>
	{/if}
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

	.calendar-loading {
		padding: 4rem 2rem;
		text-align: center;
		color: #64748b;
		font-size: 1.1rem;
	}

	:global(.calendar-event) {
		padding: 6px 8px;
		border-radius: 6px;
		font-size: 0.875rem;
		color: white;
		overflow: hidden;
		line-height: 1.3;
	}

	:global(.calendar-event__title) {
		font-weight: 600;
		margin-bottom: 4px;
	}

	:global(.calendar-event__crew) {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}

	:global(.calendar-event__crew-member) {
		background: rgba(255, 255, 255, 0.3);
		padding: 1px 7px;
		border-radius: 9999px;
		font-size: 0.75rem;
	}
</style>