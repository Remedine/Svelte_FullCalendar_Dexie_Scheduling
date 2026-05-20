<!-- src/routes/(app)/reset-pin/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import PinResetModal from '$lib/components/PinResetModal.svelte';

	let showModal = $state(true);

	onMount(() => {
		// Security: only allow if user is logged in and needs reset
		if (!auth.currentUser || !auth.currentUser.forcePinUpdate) {
			goto('/calendar', { replaceState: true });
		}
	});

	function handleSuccess() {
		showModal = false;
		goto('/calendar', { replaceState: true });
	}
</script>

<div class="reset-page">
	<div class="reset-card">
		<h1 class="reset-card__title">Set New PIN</h1>
		<p class="reset-card__subtitle">You are required to set a new 4-digit PIN</p>
	</div>
</div>

{#if showModal && auth.currentUser}
	<PinResetModal onSuccess={handleSuccess} />
{/if}

<style>
	.reset-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #1e3a8a, #3b82f6);
		padding: 1rem;
	}

	.reset-card {
		background: white;
		width: 100%;
		max-width: 380px;
		border-radius: 16px;
		padding: 2rem 1.5rem;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
		text-align: center;
	}

	.reset-card__title {
		font-size: 1.75rem;
		font-weight: 700;
		color: #1e3a8a;
		margin: 0 0 0.25rem;
	}

	.reset-card__subtitle {
		color: #64748b;
		margin-bottom: 2rem;
	}
</style>