<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { pb } from '$lib/db/pb';
	import { processSyncQueue } from '$lib/db';
	import { getUserPhotoSrc } from '$lib/db';
	import JobDetailsModal from '$lib/components/JobDetailsModal.svelte';

	let { children } = $props();

	let currentPath = $derived(page.url.pathname);

	// )=- Logout handler for the avatar dropdown menu. Uses dynamic import to match existing pattern in layout.
	async function handleLogout() {
		const { logout } = await import('$lib/stores/auth.svelte');
		await logout();
		goto('/login', { replaceState: true });
	}

	// )=- Converted from onMount to pure $effect for Svelte 5 runes compliance (per AGENTS.md).
	// Sets up online listener reactively with proper cleanup.
	$effect(() => {
		const handleOnline = async () => {
			console.log('🌐 Back online - processing sync queue');
			await processSyncQueue();
		};

		window.addEventListener('online', handleOnline);

		return () => {
			window.removeEventListener('online', handleOnline);
		};
	});

	// )=- Strengthened central auth guard using $effect.
	// - Waits for loading to complete before any redirects (prevents flash/early redirect).
	// - Single source of truth: central `auth` store (email/password via PB only; PIN login removed).
	// - Crew users are restricted to /calendar and sub-paths only.
	// - Uses replaceState to avoid polluting browser history.
	// - This provides consistency across all pages under the (app) route group.
	$effect(() => {
		if (auth.loading) return;

		if (!auth.isAuthenticated || !auth.currentUser) {
			goto('/login', { replaceState: true });
			return;
		}

		// Role-based access: non-admins (crew) can only access calendar views and their own profile.
		// )=- Updated to allow crew self-service profile management for password + photo (PIN login removed).
		if (auth.currentUser.role !== 'admin') {
			if (!currentPath.startsWith('/calendar') && currentPath !== '/profile') {
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
			<!-- )=- Role-aware navigation: only admins see Clients, Jobs, Crew, and Options.
			     Crew users are restricted by the auth guard above and only need Schedule.
			     This improves consistency and prevents UI confusion for restricted roles. -->
			{#if auth.currentUser?.role === 'admin'}
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
					href="/admin/crew" 
					class="top-nav__link"
					class:active={currentPath.startsWith('/admin/crew')}
				>
					Crew
				</a>
				<a 
					href="/admin/options" 
					class="top-nav__link"
					class:active={currentPath.startsWith('/admin/options')}
				>
					⚙️ Options
				</a>
			{/if}
		</nav>

		<div class="top-nav__user">
			{#if auth.currentUser}
				<!-- )=- Moved profile access here. Avatar (photo or initial) instead of "Logged in as" text.
				     Hover over wrapper to reveal menu with Profile and Logout.
				     Logout uses the pre-defined handleLogout for consistency. -->
				<div class="top-nav__user-avatar-wrapper">
					<div class="top-nav__user-avatar">
						{#if auth.currentUser.photo}
							<!-- )=- Use helper to normalize photo (fixes 404 for bare filenames like blob_xxx.png in top-nav avatar).
							     The stack in logs pointed here ( +layout.svelte:132 ). -->
							<img 
								src={getUserPhotoSrc(auth.currentUser.photo, auth.currentUser)} 
								alt="Profile" 
								class="top-nav__avatar-img" 
							/>
						{:else}
							<span class="top-nav__avatar-placeholder">
								{(auth.currentUser.firstName || auth.currentUser.name || 'U').slice(0,1).toUpperCase()}
							</span>
						{/if}
					</div>
					<div class="top-nav__user-menu">
						<a href="/profile" class="top-nav__user-menu-item">Profile</a>
						<button 
							onclick={handleLogout}
							class="top-nav__user-menu-item top-nav__user-menu-item--logout"
						>
							Logout
						</button>
					</div>
				</div>
			{:else}
				<span class="top-nav__user-info">Not logged in</span>
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

	<!-- )=- Global mount for JobDetailsModal (and future shared modals).
	     The singleton openJobDetailsModal pattern means the component only needs to be in the tree once.
	     This makes the details modal (with invoice support) available from jobs page, clients related jobs, etc. -->
	<JobDetailsModal />
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

	/* Old logout button styles kept for compatibility (not used in avatar menu) */
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

	/* )=- Avatar dropdown for profile access. Wrapper is relative for positioning the menu on hover.
	   Avatar is small circle with photo or placeholder initial. Menu appears below on hover.
	   BEM: top-nav__user-avatar-wrapper, top-nav__user-avatar, top-nav__avatar-img etc.
	   Menu is simple vertical list of items. Logout item styled differently. */
	.top-nav__user-avatar-wrapper {
		position: relative;
		cursor: pointer;
	}

	.top-nav__user-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		overflow: hidden;
		border: 1px solid #e2e8f0;
		background: #f1f5f9;
		flex-shrink: 0;
	}

	.top-nav__avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.top-nav__avatar-placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85rem;
		font-weight: 600;
		color: #475569;
		background: #e2e8f0;
	}

	.top-nav__user-menu {
		display: none;
		position: absolute;
		top: 100%;
		right: 0;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
		min-width: 130px;
		z-index: 100;
		padding: 0.25rem 0;
		margin-top: 4px;
	}

	.top-nav__user-avatar-wrapper:hover .top-nav__user-menu {
		display: block;
	}

	.top-nav__user-menu-item {
		display: block;
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
		color: #475569;
		text-decoration: none;
		white-space: nowrap;
		background: none;
		border: none;
		width: 100%;
		text-align: left;
		cursor: pointer;
		font-weight: 500;
	}

	.top-nav__user-menu-item:hover {
		background: #f1f5f9;
		color: #1e2937;
	}

	.top-nav__user-menu-item--logout {
		color: #ef4444;
	}

	.top-nav__user-menu-item--logout:hover {
		background: #fef2f2;
		color: #dc2626;
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