<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import { browser } from '$app/environment';
	import favicon from '$lib/assets/favicon.svg';
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
	<!-- )=- Primary SVG favicon. Modern browsers use this.
	     The /favicon.ico 404 (and similar LastPass extension errors on inputs) are expected legacy/extension noise and harmless.
	     If you want to fully silence the .ico 404, add a favicon.ico to /static (1x1 transparent png renamed works). -->
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="shortcut icon" href={favicon} />
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
