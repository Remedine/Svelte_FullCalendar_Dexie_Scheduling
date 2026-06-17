<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';
	import Toast from '$lib/components/Toast.svelte';
	import PreloadFix from '$lib/components/PreloadFix.svelte';

	// Global tokens available on public surfaces (login, root loading)
	import '$lib/styles/globals.css';

	// Ensure theme store (and dark class application) runs for the entire app including login
	import '$lib/stores/theme.svelte.ts';

	const { children } = $props();
</script>

<svelte:head>
	<title>Capital City Windows</title>
	<!-- )=- Brand favicon (Capital City Windows logo). Matches static/ + app.html. -->
	<link rel="icon" href="/favicon.ico" sizes="32x32" />
	<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
	<link rel="shortcut icon" href="/favicon.ico" />
</svelte:head>

{#if browser}
	<PreloadFix />
	{@render children()}
	<Toast />
{:else}
	<div class="loading-screen">
		<div class="loading-screen__spinner"></div>
		<p>Loading Capital City Windows...</p>
	</div>
{/if}

<style>
	.loading-screen {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: var(--color-bg);
		color: var(--color-text-muted);
		gap: var(--space-4);
	}

	.loading-screen__spinner {
		width: 48px;
		height: 48px;
		border: 5px solid var(--color-border);
		border-top: 5px solid var(--color-primary);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
