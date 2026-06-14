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
</style>
