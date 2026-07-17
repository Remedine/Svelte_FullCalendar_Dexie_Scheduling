<script lang="ts">
	import SplitCalendar from '$lib/calendar/SplitCalendar.svelte';
</script>

<div class="schedule-page">
	<div class="schedule-page__content">
		<SplitCalendar />
	</div>
</div>

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

	/* Desktop: allow the day wrapper to size based on calendar content (no fixed cap) */
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

	/* Mobile: lock the page to the viewport above the fixed bottom nav so FullCalendar can use
	   height:100%. That pins the day/date header while only the time-grid body scrolls.
	   (flex:1 0 auto on the day-wrapper was growing with content → page scroll → header left.) */
	@media (max-width: 768px), (orientation: landscape) and (max-height: 500px) {
		.schedule-page {
			/* Bottom tab bar is fixed ~62px; top-nav is hidden on mobile. */
			height: calc(100dvh - 62px);
			max-height: calc(100dvh - 62px);
			min-height: 0;
			flex: 1;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.schedule-page__content {
			flex: 1 1 0;
			min-height: 0;
			display: flex;
			flex-direction: column;
			height: 100%;
			padding: 0;
			margin: 0;
			overflow: hidden;
		}

		:global(.split-calendar-container),
		:global(.split-calendar-container--mobile) {
			flex: 1 1 0;
			min-height: 0;
			height: 100%;
		}

		:global(.split-calendar__day-wrapper) {
			flex: 1 1 0 !important;
			min-height: 0 !important;
			border-radius: 0;
			border-left: none;
			border-right: none;
		}
	}
</style>
