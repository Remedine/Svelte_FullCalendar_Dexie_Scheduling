<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte.ts';
</script>

<button
	type="button"
	class="theme-toggle__btn"
	onclick={() => theme.toggle()}
	aria-label={theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={theme.isDark ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if theme.isDark}
		<!-- Sun (light mode) -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="5"></circle>
			<line x1="12" y1="1" x2="12" y2="3"></line>
			<line x1="12" y1="21" x2="12" y2="23"></line>
			<line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
			<line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
			<line x1="1" y1="12" x2="3" y2="12"></line>
			<line x1="21" y1="12" x2="23" y2="12"></line>
			<line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
			<line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
		</svg>
	{:else}
		<!-- Moon (dark mode) -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
		</svg>
	{/if}
</button>

<style>
	.theme-toggle__btn {
		width: 36px;
		height: 36px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		cursor: pointer;
		padding: 0;
		transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
	}

	.theme-toggle__btn:hover {
		background: var(--color-surface);
		color: var(--color-text);
		border-color: var(--color-primary);
	}

	.theme-toggle__btn:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
</style>