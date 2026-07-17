<!-- src/routes/(app)/calendar/split/+page.svelte -->
<script lang="ts">
	import SplitCalendar from '$lib/calendar/SplitCalendar.svelte';
</script>

<div class="split-page">
	<div class="split-page__content">
		<SplitCalendar />
	</div>
</div>

<style>
	.split-page {
		padding: var(--space-4);
		margin: 0 auto;
	}

	/* )=- Removed unused .split-page__header / __title / __subtitle (current layout uses different structure). */

	.split-page__content {
		background: var(--color-bg);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
	}

	/* Mobile: lock to viewport above bottom nav so FC height:100% pins the day/date header
	   while only the time-grid body scrolls. */
	@media (max-width: 768px), (orientation: landscape) and (max-height: 500px) {
		.split-page {
			flex: 1;
			min-height: 0;
			height: calc(100dvh - 62px);
			max-height: calc(100dvh - 62px);
			display: flex;
			flex-direction: column;
			padding: var(--space-2);
			overflow: hidden;
		}

		.split-page__content {
			flex: 1 1 0;
			min-height: 0;
			height: 100%;
			display: flex;
			flex-direction: column;
			padding: var(--space-2);
			overflow: hidden;
		}
	}
</style>
