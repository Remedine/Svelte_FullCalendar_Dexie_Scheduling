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

	/* Mobile: normal flow + padding. The calendar component uses auto heights so the full day
	   timegrid is rendered in the DOM. Scrolling is page/wrapper level — NOT a fixed 100dvh box.

	   === AI / AGENTS: DO NOT CHANGE CALENDAR HEIGHT ===
	   Do not lock this page to calc(100dvh - 62px) / height:100% / max-height to pin FC headers.
	   That collapses/hides the calendar. Keep content-driven height; FC must stay height:'auto'.
	*/
	/* Include phone landscape (width often > 768) so rotate keeps mobile calendar layout. */
	@media (max-width: 768px), (orientation: landscape) and (max-height: 500px) {
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
