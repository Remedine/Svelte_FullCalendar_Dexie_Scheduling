<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { pb } from '$lib/db/pb';
	import { processSyncQueue } from '$lib/db';

	let { children } = $props();

	let currentPath = $derived(page.url.pathname);

	onMount(() => {
		const handleOnline = async () => {
			console.log('🌐 Back online - processing sync queue');
			await processSyncQueue();
		};

		window.addEventListener('online', handleOnline);

		// Cleanup
		return () => {
			window.removeEventListener('online', handleOnline);
		};
	});

	// )=- Reliable auth guard
	$effect(() => {
    if (auth.loading) return;

    if (!auth.isAuthenticated || !auth.currentUser) {
      goto('/login', { replaceState: true });
      return;
    }

    // Optional: Non-admin users redirected to calendar
    if (auth.currentUser.role !== 'admin') {
      if (!currentPath.startsWith('/calendar')) {
        goto('/calendar', { replaceState: true });
      }
    }
  });
</script>

<div class="app-layout">
	<!-- Top Navigation Bar -->
	<header class="top-nav">
		<div class="top-nav__brand">
			<h1>Capital City Windows</h1>
		</div>

		<nav class="top-nav__menu">
			<a 
				href="/calendar" 
				class="top-nav__link"
				class:active={currentPath === '/calendar' || currentPath === '/'}
			>
				📅 Schedule
			</a>
			<a 
				href="/clients" 
				class="top-nav__link"
				class:active={currentPath.startsWith('/clients')}
			>
				👥 Clients
			</a>
			<a 
				href="/jobs" 
				class="top-nav__link"
				class:active={currentPath.startsWith('/jobs')}
			>
				📋 Jobs
			</a>
			<a 
				href="admin/crew" 
				class="top-nav__link"
				class:active={currentPath.startsWith('/admin/crew')}
			>
				Crew
			</a>
			<a 
				href="admin/options" 
				class="top-nav__link"
				class:active={currentPath.startsWith('/admin/options')}
			>
				⚙️ Options
			</a>
		</nav>

		<div class="top-nav__user">
			{#if auth.currentUser}
				<span class="top-nav__user-info">
					Logged in as <strong>{auth.currentUser.name}</strong>
				</span>
				<button 
					onclick={async () => {
						await import('$lib/stores/auth.svelte.ts').then(m => m.logout());
						window.location.href = '/login';
					}}
					class="top-nav__logout-btn"
				>
					Logout
				</button>
			{:else}
				<span>Not logged in</span>
			{/if}
		</div>
	</header>

	<!-- Main Content Area -->
	<main class="main-content">
		{#if auth.loading}
			<div class="loading-screen">Loading...</div>
		{:else}
			{@render children()}
		{/if}
	</main>
</div>

<style>
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background-color: #f8fafc;
	}

	/* Top Navigation */
	.top-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1.25rem;
		background: white;
		border-bottom: 1px solid #e2e8f0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.top-nav__brand h1 {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 700;
		color: #0f172a;
	}

	.top-nav__menu {
		display: flex;
		gap: 2rem;
	}

	.top-nav__link {
		text-decoration: none;
		color: #475569;
		font-weight: 500;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		transition: all 0.2s;
	}

	.top-nav__link:hover {
		background-color: #f1f5f9;
		color: #0f172a;
	}

	.top-nav__link.active {
		background-color: #1e40af;
		color: white;
	}

	/* Main Content */
	.main-content {
		flex: 1;
		min-height: 0;
		padding: 0;
	}

	/* Responsive adjustments 
	@media (max-width: 768px) {
		.top-nav__menu {
			gap: 1rem;
			font-size: 0.95rem;
		}
	}*/
	/*  User section styling */
	.top-nav__user {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.top-nav__user-info {
		font-size: 0.95rem;
		color: #475569;
	}

	.top-nav__logout-btn {
		background: #ef4444;
		color: white;
		border: none;
		padding: 0.4rem 0.9rem;
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.top-nav__logout-btn:hover {
		background: #dc2626;
	}
		.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 1.1rem;
		color: #64748b;
	}
</style>