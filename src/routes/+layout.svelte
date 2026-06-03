<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';
	import favicon from '$lib/assets/favicon.svg';
	import Toast from '$lib/components/Toast.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if browser}
	{@render children()}
	<Toast />
{:else}
	<div class="loading-screen">
		<div class="loading-screen__spinner"></div>
		<p>Loading CapitalCity Windows...</p>
	</div>
{/if}

<style>
	.loading-screen {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: #f8fafc;
		color: #64748b;
		gap: 1rem;
	}

	.loading-screen__spinner {
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