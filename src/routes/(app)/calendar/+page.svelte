<!-- src/routes/(app)/calendar/+page.svelte -->
<script lang="ts">
	// )=- Mobile scrollbar cleanup: overflow hidden on page + content
	// )=- Ensures only FullCalendar's internal scrollbar appears on mobile.
	// )=- References Remedine/Svelte_FullCalendar_Dexie_Scheduling

	import { browser } from '$app/environment';
	import PinResetModal from '$lib/components/PinResetModal.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import SyncStatus from '$lib/components/SyncStatus.svelte';
	import JobFormModal from '$lib/components/JobFormModal.svelte';

	let showPinReset = $state(false);
	let CalendarComponent: any = $state(null);

	$effect(() => {
		if (auth.currentUser?.forcePinUpdate) showPinReset = true;
	});

	$effect(() => {
		if (browser && !CalendarComponent) {
			import('$lib/calendar/Calendar.svelte').then(m => CalendarComponent = m.default);
		}
	});

	function handlePinResetSuccess() {
		showPinReset = false;
		if (browser) window.location.reload();
	}
</script>

<div class="schedule-page">
	<header class="schedule-page__header">
		<SyncStatus />
	</header>

	<div class="schedule-page__content">
		{#if CalendarComponent}
			<svelte:component this={CalendarComponent} />
		{:else}
			<div class="schedule-page__loading">
				<div class="schedule-page__loading-spinner"></div>
				<p class="schedule-page__loading-text">Loading Calendar...</p>
			</div>
		{/if}
	</div>
</div>

{#if showPinReset}
	<PinResetModal onSuccess={handlePinResetSuccess} />
{/if}

<style>
	.schedule-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 100dvh;
		overflow: hidden;
		background-color: #f8fafc;
	}

	.schedule-page__header {
		padding: 0.75rem 1rem;
		background: white;
		border-bottom: 1px solid #e2e8f0;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.schedule-page__title {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 700;
		color: #0f172a;
	}

	.schedule-page__content {
		flex: 1;
		min-height: 0;
		overflow: hidden !important;     /* No intermediate scrollbar */
		padding: 0.25rem;
	}

	@media (max-width: 640px) {
		.schedule-page__header {
			padding: 0.5rem 0.75rem;
		}
		.schedule-page__title {
			font-size: 1.2rem;
		}
		.schedule-page__content {
			padding: 0.125rem;
		}
	}

	/* Loading state */
	.schedule-page__loading {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		color: #64748b;
	}

	.schedule-page__loading-spinner {
		width: 42px;
		height: 42px;
		border: 5px solid #e2e8f0;
		border-top: 5px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>