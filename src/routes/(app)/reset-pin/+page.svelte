<!-- src/routes/(app)/reset-pin/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { auth } from '$lib/stores/auth.svelte';
	import PinResetModal from '$lib/components/PinResetModal.svelte';

	let showModal = $state(true);

	// )=- Converted from onMount to pure $effect for Svelte 5 runes compliance (per AGENTS.md).
	// Security guard: prevent bypassing forced reset. Runs reactively on auth changes.
	$effect(() => {
		if (!auth.currentUser) {
			goto('/login', { replaceState: true });
			return;
		}
		
		if (!auth.currentUser.forcePinUpdate) {
			goto('/calendar', { replaceState: true });
			return;
		}
	});

	// )=- Back button bypass prevention using $effect with cleanup (replaces onMount return).
	// Pushes state to block navigation away from forced PIN reset.
	$effect(() => {
		if (!auth.currentUser?.forcePinUpdate) return;

		const handlePopState = () => {
			if (auth.currentUser?.forcePinUpdate) {
				history.pushState(null, '', '/reset-pin');
			}
		};

		window.addEventListener('popstate', handlePopState);
		history.pushState(null, '', '/reset-pin');

		return () => {
			window.removeEventListener('popstate', handlePopState);
		};
	});

	// )=- Define handleSuccess for the modal. Hides modal and redirects after successful PIN set.
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