<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import { auth, logout } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { processSyncQueue } from '$lib/db';
	import { getUserPhotoSrc } from '$lib/db';
	import JobDetailsModal from '$lib/components/JobDetailsModal.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	// Import global design tokens + base styles (tokens power the entire overhaul)
	import '$lib/styles/globals.css';

	const { children } = $props();

	const currentPath = $derived(page.url.pathname);

	// )=- Logout handler for the avatar dropdown menu.
	async function handleLogout() {
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
				<a href="/clients" class="top-nav__link" class:active={currentPath.startsWith('/clients')}>
					👥 Clients
				</a>
				<a href="/jobs" class="top-nav__link" class:active={currentPath.startsWith('/jobs')}>
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
			<ThemeToggle />

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
								{(auth.currentUser.firstName || auth.currentUser.name || 'U')
									.slice(0, 1)
									.toUpperCase()}
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

		<!-- Mobile app chrome footer (beneath content on mobile).
		     On mobile: "Capital City Windows" + dark mode toggle + avatar (profile/logout).
		     Placed in flow after page content so it sits below the calendar.
		     Hidden on desktop. The fixed bottom tab bar stays below it. -->
		<footer class="mobile-app-footer">
			<span class="mobile-app-footer__brand">Capital City Windows</span>

			<div class="mobile-app-footer__controls">
				<ThemeToggle />

				{#if auth.currentUser}
					<div class="mobile-app-footer__avatar-wrapper">
						<div class="mobile-app-footer__avatar">
							{#if auth.currentUser.photo}
								<img
									src={getUserPhotoSrc(auth.currentUser.photo, auth.currentUser)}
									alt="Profile"
									class="mobile-app-footer__avatar-img"
								/>
							{:else}
								<span class="mobile-app-footer__avatar-placeholder">
									{(auth.currentUser.firstName || auth.currentUser.name || 'U')
										.slice(0, 1)
										.toUpperCase()}
								</span>
							{/if}
						</div>
						<div class="mobile-app-footer__user-menu">
							<a href="/profile" class="mobile-app-footer__user-menu-item">Profile</a>
							<button
								onclick={handleLogout}
								class="mobile-app-footer__user-menu-item mobile-app-footer__user-menu-item--logout"
							>
								Logout
							</button>
						</div>
					</div>
				{/if}
			</div>
		</footer>
	</main>

	<!-- Bottom tab bar (mobile-first solution for wide menu problem).
	     Per approved look-and-feel plan: Schedule always visible. Admins get Clients/Jobs/Crew/Options.
	     Desktop hides this via media query; top-nav menu remains for wide screens.
	     BEM: bottom-nav, bottom-nav__tab, bottom-nav__tab--active. Uses emoji icons for zero-dep consistency with existing nav. -->
	<nav class="bottom-nav" role="tablist" aria-label="Primary navigation">
		<a
			href="/calendar"
			class="bottom-nav__tab"
			class:bottom-nav__tab--active={currentPath === '/calendar' || currentPath === '/'}
			role="tab"
			aria-selected={currentPath === '/calendar' || currentPath === '/'}
		>
			<span class="bottom-nav__icon">📅</span>
			<span class="bottom-nav__label">Schedule</span>
		</a>

		{#if auth.currentUser?.role === 'admin'}
			<a
				href="/clients"
				class="bottom-nav__tab"
				class:bottom-nav__tab--active={currentPath.startsWith('/clients')}
				role="tab"
				aria-selected={currentPath.startsWith('/clients')}
			>
				<span class="bottom-nav__icon">👥</span>
				<span class="bottom-nav__label">Clients</span>
			</a>
			<a
				href="/jobs"
				class="bottom-nav__tab"
				class:bottom-nav__tab--active={currentPath.startsWith('/jobs')}
				role="tab"
				aria-selected={currentPath.startsWith('/jobs')}
			>
				<span class="bottom-nav__icon">📋</span>
				<span class="bottom-nav__label">Jobs</span>
			</a>
			<a
				href="/admin/crew"
				class="bottom-nav__tab"
				class:bottom-nav__tab--active={currentPath.startsWith('/admin/crew')}
				role="tab"
				aria-selected={currentPath.startsWith('/admin/crew')}
			>
				<span class="bottom-nav__icon">👷</span>
				<span class="bottom-nav__label">Crew</span>
			</a>
			<a
				href="/admin/options"
				class="bottom-nav__tab"
				class:bottom-nav__tab--active={currentPath.startsWith('/admin/options')}
				role="tab"
				aria-selected={currentPath.startsWith('/admin/options')}
			>
				<span class="bottom-nav__icon">⚙️</span>
				<span class="bottom-nav__label">Options</span>
			</a>
		{/if}
	</nav>

	<!-- )=- Global mount for JobDetailsModal (and future shared modals).
	     The singleton openJobDetailsModal pattern means the component only needs to be in the tree once.
	     This makes the details modal (with invoice support) available from jobs page, clients related jobs, etc. -->
	<JobDetailsModal />
</div>

<style>
	/* Adopt design tokens from globals.css for cohesion (Phase 1 of look-and-feel overhaul) */
	.app-layout {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		background-color: var(--color-bg);
	}

	/* On mobile, allow the content (calendar etc) to be taller than the viewport so the page can scroll to show the full calendar. */
	@media (max-width: 768px) {
		.app-layout {
			height: auto;
			min-height: 100dvh;
		}
	}

	/* Top Navigation — now token-driven + mobile slimmed */
	.top-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-3) var(--space-5);
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		box-shadow: var(--shadow-sm);
	}

	.top-nav__brand h1 {
		margin: 0;
		font-size: var(--font-size-2xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-text);
	}

	/* Wide horizontal menu: hidden on mobile (bottom tab bar takes over per plan) */
	.top-nav__menu {
		display: flex;
		gap: var(--space-6);
	}

	@media (max-width: 768px) {
		.top-nav__menu {
			display: none;
		}
		/* Completely hide the top navigation bar on mobile.
		   Branding, theme toggle and avatar/profile/logout are now in the mobile-app-footer below the content. */
		.top-nav {
			display: none;
		}
	}

	.top-nav__link {
		text-decoration: none;
		color: var(--color-text-muted);
		font-weight: var(--font-weight-medium);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		transition: all var(--transition-fast);
	}

	.top-nav__link:hover {
		background-color: var(--color-surface-alt);
		color: var(--color-text);
	}

	.top-nav__link.active {
		background-color: var(--color-primary);
		color: white;
	}

	/* Main Content */
	.main-content {
		flex: 1;
		min-height: 0;
		padding: 0;
	}

	/* User section */
	.top-nav__user {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.top-nav__user-info {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	/* Avatar dropdown (token updates only; behavior unchanged) */
	.top-nav__user-avatar-wrapper {
		position: relative;
		cursor: pointer;
	}

	.top-nav__user-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		overflow: hidden;
		border: 1px solid var(--color-border);
		background: var(--color-surface-alt);
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
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		background: var(--color-border);
	}

	.top-nav__user-menu {
		display: none;
		position: absolute;
		top: 100%;
		right: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		min-width: 130px;
		z-index: var(--z-dropdown);
		padding: var(--space-1) 0;
		margin-top: var(--space-1);
	}

	.top-nav__user-avatar-wrapper:hover .top-nav__user-menu {
		display: block;
	}

	.top-nav__user-menu-item {
		display: block;
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-decoration: none;
		white-space: nowrap;
		background: none;
		border: none;
		width: 100%;
		text-align: left;
		cursor: pointer;
		font-weight: var(--font-weight-medium);
	}

	.top-nav__user-menu-item:hover {
		background: var(--color-surface-alt);
		color: var(--color-text);
	}

	.top-nav__user-menu-item--logout {
		color: var(--color-danger);
	}

	.top-nav__user-menu-item--logout:hover {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
	}

	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: var(--font-size-lg);
		color: var(--color-text-muted);
	}

	/* ============================================
	   BOTTOM TAB NAV (mobile primary nav)
	   Fixed at bottom on small screens. Desktop hidden via media query.
	   BEM strictly followed.
	   ============================================ */
	.bottom-nav {
		display: none; /* shown only on mobile via media query below */
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: var(--z-fixed);
		background: var(--color-surface);
		border-top: 1px solid var(--color-border);
		box-shadow: 0 -2px 8px rgb(0 0 0 / 0.06);
	}

	@media (max-width: 768px) {
		.bottom-nav {
			display: flex;
		}

		/* Reserve space at bottom of main-content so the in-flow mobile-app-footer + fixed tabs don't get covered.
		   The footer itself sits in normal flow right after the page content (e.g. the calendar). */
		.main-content {
			display: flex;
			flex-direction: column;
			padding-bottom: 62px;
			/* allow tall page content (e.g. full mobile calendar with all time slots) so scrolling is at page level */
			height: auto;
			min-height: 100dvh;
		}
	}

	.bottom-nav__tab {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: var(--space-2) var(--space-1);
		text-decoration: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		min-height: 56px; /* solid touch target */
		transition: color var(--transition-fast), background var(--transition-fast);
	}

	.bottom-nav__tab--active {
		color: var(--color-primary);
		font-weight: var(--font-weight-semibold);
		background: var(--color-surface-alt);
		border-top: 3px solid var(--color-primary);
	}

	.bottom-nav__tab--active .bottom-nav__icon {
		transform: scale(1.1);
	}

	.bottom-nav__icon {
		font-size: var(--font-size-lg);
		line-height: 1;
		margin-bottom: var(--space-1);
	}

	.bottom-nav__label {
		font-size: var(--font-size-xs);
		letter-spacing: 0.2px;
	}

	/* ============================================
	   MOBILE APP CHROME FOOTER
	   Shows "Capital City Windows" + ThemeToggle + avatar (profile/logout)
	   beneath the main content on phones. Anchored as a persistent footer.
	   Hidden on desktop. Complements (does not replace) the bottom tab nav.
	   BEM: mobile-app-footer, etc.
	   ============================================ */
	.mobile-app-footer {
		display: none; /* desktop hidden */
	}

	@media (max-width: 768px) {
		.mobile-app-footer {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-2);
			padding: var(--space-2) var(--space-3);
			background: var(--color-surface);
			border-top: 1px solid var(--color-border);
			box-shadow: 0 -1px 4px rgb(0 0 0 / 0.04);
			font-size: var(--font-size-xs);
			color: var(--color-text-muted);
			flex-shrink: 0;
		}

		.mobile-app-footer__brand {
			font-weight: var(--font-weight-semibold);
			color: var(--color-text);
			font-size: var(--font-size-sm);
			white-space: nowrap;
		}

		.mobile-app-footer__controls {
			display: flex;
			align-items: center;
			gap: var(--space-2);
		}

		/* Compact avatar in the footer (slightly smaller than top) */
		.mobile-app-footer__avatar-wrapper {
			position: relative;
			cursor: pointer;
		}

		.mobile-app-footer__avatar {
			width: 26px;
			height: 26px;
			border-radius: 50%;
			overflow: hidden;
			border: 1px solid var(--color-border);
			background: var(--color-surface-alt);
			flex-shrink: 0;
		}

		.mobile-app-footer__avatar-img,
		.mobile-app-footer__avatar-placeholder {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 10px;
			font-weight: 700;
			color: var(--color-surface);
			background: var(--color-text-muted);
		}

		.mobile-app-footer__user-menu {
			position: absolute;
			bottom: calc(100% + 4px);
			right: 0;
			background: var(--color-surface);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-sm);
			box-shadow: var(--shadow-md);
			min-width: 120px;
			z-index: var(--z-dropdown);
			display: none;
			flex-direction: column;
		}

		.mobile-app-footer__avatar-wrapper:hover .mobile-app-footer__user-menu,
		.mobile-app-footer__avatar-wrapper:focus-within .mobile-app-footer__user-menu {
			display: flex;
		}

		.mobile-app-footer__user-menu-item {
			display: block;
			padding: 6px 12px;
			font-size: var(--font-size-sm);
			color: var(--color-text);
			text-decoration: none;
			white-space: nowrap;
		}

		.mobile-app-footer__user-menu-item:hover {
			background: var(--color-surface-alt);
		}

		.mobile-app-footer__user-menu-item--logout {
			color: var(--color-danger);
			border-top: 1px solid var(--color-border);
			background: none;
			width: 100%;
			text-align: left;
			cursor: pointer;
		}

		.mobile-app-footer__user-menu-item--logout:hover {
			background: var(--color-danger-soft);
		}

		/* When footer is present we already padded main-content for bottom-nav;
		   footer itself has margin-bottom to sit above the tabs. */
	}
</style>
