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
		height: 100%;
		min-height: 100dvh;
		overflow: hidden;
		background-color: #f8fafc;
	}

	.schedule-page__content {
		flex: 1;
		min-height: 0; /* Important for flex children */
		overflow: hidden;
		background: #f8fafc;
		border-radius: 12px;
		padding: 0.75rem;
		margin: 0.5rem;
	}

	/* Make sure SplitCalendar can grow properly */
	:global(.split-calendar__day-wrapper) {
		min-height: 650px; /* Base height */
		flex: 1; /* Allow it to grow */
	}

	@media (max-width: 900px) {
		.schedule-page__content {
			margin: 0.25rem;
			padding: 0.5rem;
			border-radius: 8px;
		}
	}
</style>
