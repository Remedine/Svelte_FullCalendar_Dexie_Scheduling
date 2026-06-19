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

	/* Mobile: normal flow + padding. The calendar component now uses auto heights so the
	   full day timegrid (all slots) is rendered in the DOM. Scrolling happens at page level
	   (main-content / viewport) to see later hours. The sticky MonthPicker (via global styles)
	   stays visible while scrolling the tall day content. No more 100% clipping the calendar short.
	   Looks at full stack: layout (main-content flex + in-flow footer + fixed tabs + 100dvh root),
	   this page, SplitCalendar + MonthPicker components.
	*/
	@media (max-width: 768px) {
		.split-page {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			padding: var(--space-2);
		}

		.split-page__content {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			padding: var(--space-2);
			/* background/rounded frame the calendar area; the flex gives the calendar the remaining space after layout chrome */
		}
	}
</style>
