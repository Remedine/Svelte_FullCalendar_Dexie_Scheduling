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
		height: auto;
		min-height: 100dvh;
		overflow: visible;
		background-color: var(--color-bg);
	}

	.schedule-page__content {
		flex: 1 0 auto;
		height: auto;
		min-height: 0;
		display: flex;
		overflow: visible;
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

	/* Mobile: full height chain so the day calendar can take the remaining space after the compact
	   anchored MonthPicker. The day-wrapper uses internal overflow auto for the time slots (so you
	   can scroll past 10am etc). Top nav is hidden, footer is in flow below this block. */
	@media (max-width: 768px) {
		.schedule-page {
			height: 100%;
			min-height: 0;
			flex: 1;
			display: flex;
			flex-direction: column;
		}

		.schedule-page__content {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			height: 100%;
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
