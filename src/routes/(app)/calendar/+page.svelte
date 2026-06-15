<script lang="ts">
	import SplitCalendar from '$lib/calendar/SplitCalendar.svelte';
	import JobFormModal from '$lib/components/JobFormModal.svelte';
</script>

<div class="schedule-page">
	<div class="schedule-page__content">
		<SplitCalendar />
	</div>
</div>

<JobFormModal />

<style>
	.schedule-page {
		display: flex;
		flex-direction: column;
		height: auto; /* allow content (calendar) to determine full height */
		min-height: 100dvh;
		overflow: visible; /* enable main page scroll for tall calendar content */
		background-color: var(--color-bg);
	}

	.schedule-page__content {
		flex: 1 0 auto;
		height: auto;
		min-height: 0;
		display: flex;
		overflow: visible; /* let inner calendar push page scroll */
		background: var(--color-bg);
		padding: var(--space-3) var(--space-3) var(--space-4);
		margin: 0;
	}

	/* Allow the day wrapper to size based on calendar content (no fixed cap) */
	:global(.split-calendar__day-wrapper) {
		flex: 1 0 auto;
		min-height: 300px;
	}

	@media (max-width: 900px) {
		.schedule-page__content {
			margin: 0;
			padding: var(--space-1) var(--space-1) var(--space-2);
			border-radius: 0;
		}
	}

	/* Mobile: reclaim every bit of gutter. The anchored MonthPicker + scrolling day calendar
	   need the space. We now use internal scroll in the day-wrapper for the time slots. */
	@media (max-width: 768px) {
		.schedule-page__content {
			padding: 0;
			margin: 0;
		}

		:global(.split-calendar__day-wrapper) {
			border-radius: 0;
			border-left: none;
			border-right: none;
		}
	}
</style>
