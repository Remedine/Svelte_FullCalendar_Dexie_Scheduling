<!-- src/routes/(app)/calendar/split/+page.svelte -->
<script lang="ts">
	import SplitCalendar from '$lib/calendar/SplitCalendar.svelte';
	import JobFormModal from '$lib/components/JobFormModal.svelte';
</script>

<div class="split-page">
	<div class="split-page__content">
		<SplitCalendar />
	</div>
</div>

<JobFormModal />

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

	/* === Mobile: propagate full remaining height down the flex chain ===
	   Layout: .main-content (flex col + pb for footer/tabs) > children (this .split-page)
	   Without explicit flex:1 + min-height:0 + height:100% on the page wrappers, the
	   mobile 100% rules inside SplitCalendar (for .split-calendar, .main, .day-wrapper)
	   collapse to auto/min-content. Result: day time-grid gets very small height,
	   only showing ~first hour of slots (e.g. up to 7am) with no usable scroll.
	   The internal overflow:auto on day-wrapper then can't provide full day scroll.
	   Reclaims space for the anchored compact MonthPicker + scrolling day slots.
	   BEM + tokens. Matches the flex contract described in SplitCalendar mobile CSS.
	*/
	@media (max-width: 768px) {
		.split-page {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			height: 100%;
			padding: var(--space-2); /* tighter to give calendar more room */
		}

		.split-page__content {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			height: 100%;
			padding: var(--space-2);
			/* background/border-radius still apply to the calendar box */
		}
	}
</style>
