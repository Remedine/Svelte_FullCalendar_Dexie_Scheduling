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
			margin: var(--space-1);
			padding: var(--space-2) var(--space-2) var(--space-4); /* keep a bit of bottom gap on smaller screens */
			border-radius: var(--radius-md);
		}
	}

	/* Mobile relief for "smooshed day schedule" (timeGridDay inside Split view) */
	@media (max-width: 768px) {
		:global(.split-calendar__day-wrapper) {
			min-height: 300px;
		}
	}
</style>
