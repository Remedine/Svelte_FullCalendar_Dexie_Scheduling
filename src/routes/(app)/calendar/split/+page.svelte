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
		padding: 1rem;
		
		margin: 0 auto;
	}

	.split-page__header {
		margin-bottom: 1.5rem;
	}

	.split-page__title {
		margin: 0 0 0.25rem 0;
		font-size: 1.75rem;
		font-weight: 700;
		color: #0f172a;
	}

	.split-page__subtitle {
		margin: 0;
		color: #64748b;
		font-size: 0.95rem;
	}

	.split-page__content {
		background: #f8fafc;
		border-radius: 12px;
		padding: 1rem;
	}
</style>