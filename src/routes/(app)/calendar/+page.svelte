<script lang="ts">
    import { onMount } from 'svelte';
    import Calendar from '$lib/calendar/Calendar.svelte';
    import { seedSampleData } from '$lib/db/seed';
    import { getUpcomingJobs } from '$lib/db';

    //Reactive State
    let jobs: any[] = $state([]);

    onMount(async () => {
        // Seed sample data (only for development/testing)
        await seedSampleData();

        // Fetch upcoming jobs to display on the calendar
        jobs = await getUpcomingJobs(30);
    });

</script>

<div class="page">
    <header class="page-header">
        <h1>Schedule</h1>
    </header>
    <div class="calendar-container">
        <Calendar />
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

	.page-subtitle {
		margin: 0.25rem 0 0;
		color: #64748b;
		font-size: 0.95rem;
	}

	.calendar-container {
		flex: 1;
		overflow: hidden;
		padding: 0.5rem;
		min-width: 0;
	}
</style>