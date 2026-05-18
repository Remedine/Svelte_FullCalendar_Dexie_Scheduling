<!-- src/routes/(app)/calendar/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { seedSampleData } from '$lib/db/seed';
	import { getUpcomingJobs } from '$lib/db';

	// )=- Dynamic import to avoid SSR/prefetch semVer error with FullCalendar
	let CalendarComponent: any = $state(null);
	let jobs: any[] = $state([]);

	onMount(async () => {
		await seedSampleData();

		jobs = await getUpcomingJobs(30);

		if (browser) {
			const module = await import('$lib/calendar/Calendar.svelte');
			CalendarComponent = module.default;
		}
	});
</script>

<div class="page">
	<header class="page-header">
		<h1>Schedule</h1>
	</header>
	<div class="calendar-container">
		{#if CalendarComponent}
			<svelte:component this={CalendarComponent} />
		{:else}
			<div class="calendar-loading">
				<div class="calendar-loading__spinner"></div>
				<p>Loading Calendar...</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.page {
		min-height: 0;
		display: flex;
		flex-direction: column;
		background-color: #f8fafc;
	}

	.page-header {
		padding: 1.5rem 1rem 1rem;
		background: white;
		border-bottom: 1px solid #e2e8f0;
	}

	.page-header h1 {
		margin: 0;
		font-size: 1.75rem;
		font-weight: 700;
		color: #0f172a;
	}

	.calendar-container {
		flex: 1;
		overflow: hidden;
		padding: 0.5rem;
		min-width: 0;
	}

	.calendar-loading {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		color: #64748b;
	}

	.calendar-loading__spinner {
		width: 48px;
		height: 48px;
		border: 5px solid #e2e8f0;
		border-top: 5px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>