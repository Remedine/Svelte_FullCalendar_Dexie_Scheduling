<!-- src/routes/(app)/calendar/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { seedSampleData } from '$lib/db/seed';
	import { getUpcomingJobs } from '$lib/db';
	import PinResetModal from '$lib/components/PinResetModal.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import SyncStatus from '$lib/components/SyncStatus.svelte';
  	import { isAuthenticated, pullJobsFromServer, pb } from '$lib/pb';

	$effect(() => {
		if (!isAuthenticated()) return;
		
		const unsubscribe = pb.collection('jobs').subscribe('*', async () => {
			console.log('🔔 Realtime update from another device');
			await pullJobsFromServer();
			// Refresh your jobs store / calendar here if needed
		});

		return () => unsubscribe();
	});

	

	let showPinReset = $state(false);
	//  Dynamic import to avoid SSR/prefetch semVer error with FullCalendar
	let CalendarComponent: any = $state(null);
	let jobs: any[] = $state([]);

	onMount(async () => {
		await seedSampleData();

		// )=- Check for forced PIN reset
		if (auth.currentUser?.forcePinUpdate) {
			showPinReset = true;
		}

		jobs = await getUpcomingJobs(30);

		if (browser) {
			const module = await import('$lib/calendar/Calendar.svelte');
			CalendarComponent = module.default;
		}
	});

	function handlePinResetSuccess() {
		showPinReset = false;
		// Optionally reload to refresh user data
		window.location.reload();
	}
</script>

<div class="page">
	<header class="page-header">
		<h1>Schedule</h1>
		<SyncStatus />
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
<!-- )=- Forced PIN Reset Modal -->
{#if showPinReset}
	<PinResetModal onSuccess={handlePinResetSuccess} />
{/if}

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