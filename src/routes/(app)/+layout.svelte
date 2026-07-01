<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
	import { page } from '$app/state';
	import { auth, logout } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { processSyncQueue } from '$lib/db';
	import { getUserPhotoSrc } from '$lib/db';
	import JobDetailsModal from '$lib/components/JobDetailsModal.svelte';
	import JobFormModal from '$lib/components/JobFormModal.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import QuickUnlock from '$lib/components/QuickUnlock.svelte';
	import { theme } from '$lib/stores/theme.svelte.ts';
	import { isMobileViewport, MOBILE_MAX_WIDTH_PX } from '$lib/utils/device';

	// Import global design tokens + base styles (tokens power the entire overhaul)
	import '$lib/styles/globals.css';

	const { children } = $props();

	const currentPath = $derived(page.url.pathname);

	let showAvatarMenu = $state(false);
	let isMobile = $state(false);

	$effect(() => {
		isMobile = isMobileViewport();
		const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
		const onChange = (e: MediaQueryListEvent) => {
			isMobile = e.matches;
		};
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	});

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

	// Upload Dexie sync queue snapshot for backup bundling (admin only, throttled).
	$effect(() => {
		if (auth.loading || auth.currentUser?.role !== 'admin') return;
		import('$lib/backups/syncQueueUpload').then(({ uploadSyncQueueSnapshotIfDue }) => {
			void uploadSyncQueueSnapshotIfDue();
		});
	});

	// Process scheduled crew assignment notifications while the app is open.
	$effect(() => {
		if (auth.loading || !auth.currentUser) return;

		let cancelled = false;
		const tick = async () => {
			if (cancelled) return;
			const { processScheduledCrewNotifications } = await import(
				'$lib/notifications/crewAssignment'
			);
			await processScheduledCrewNotifications();
		};

		tick();
		const interval = setInterval(tick, 5 * 60 * 1000);

		return () => {
			cancelled = true;
			clearInterval(interval);
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

		// Role-based access: crew can use schedule, their assigned jobs list, and profile.
		if (auth.currentUser.role !== 'admin') {
			const allowed =
				currentPath.startsWith('/calendar') ||
				currentPath === '/profile' ||
				currentPath.startsWith('/jobs');
			if (!allowed) {
				goto('/calendar', { replaceState: true });
			}
		}
	});

	// Robust outside-click closer for the mobile avatar submenu.
	// Always attached (while layout is mounted) and only acts when menu is open.
	// This avoids timing issues.
	$effect(() => {
		const handleOutsideClick = (event: MouseEvent) => {
			if (!showAvatarMenu) return;
			const wrapper = document.querySelector('.bottom-nav__avatar-wrapper');
			if (wrapper && !wrapper.contains(event.target as Node)) {
				showAvatarMenu = false;
			}
		};

		document.addEventListener('click', handleOutsideClick, { capture: true });

		return () => {
			document.removeEventListener('click', handleOutsideClick, { capture: true });
		};
	});
</script>

<div class="app-layout">
	<!-- Top Navigation Bar (desktop only; brand removed per request for cleaner feel) -->
	<header class="top-nav">
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
			{/if}
			<a href="/jobs" class="top-nav__link" class:active={currentPath.startsWith('/jobs')}>
				📋 {auth.currentUser?.role === 'admin' ? 'Jobs' : 'My Jobs'}
			</a>
			{#if auth.currentUser?.role === 'admin'}
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

	<!-- Main Content Area (hidden while quick-unlock gate is active) -->
	<main class="main-content" class:main-content--locked={auth.locked && auth.isAuthenticated}>
		{#if auth.loading}
			<div class="loading-screen">Loading...</div>
		{:else if auth.locked && auth.isAuthenticated}
			<div class="loading-screen" aria-hidden="true">Locked</div>
		{:else}
			{@render children()}
		{/if}
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

		<a
			href="/jobs"
			class="bottom-nav__tab"
			class:bottom-nav__tab--active={currentPath.startsWith('/jobs')}
			role="tab"
			aria-selected={currentPath.startsWith('/jobs')}
		>
			<span class="bottom-nav__icon">📋</span>
			<span class="bottom-nav__label">{auth.currentUser?.role === 'admin' ? 'Jobs' : 'My Jobs'}</span>
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

		<!-- Mobile-only: avatar with submenu in bottom-right corner.
		     Submenu opens upward (bottom: 100%) and left (right: 0) per the recommended pattern
		     so it stays on screen. Uses .open class for visibility (or hover). Theme toggle inside.
		     No separate footer or brand text on mobile. -->
		{#if auth.currentUser}
			<div 
				class="bottom-nav__avatar-wrapper"
				role="button"
				tabindex="0"
				aria-expanded={showAvatarMenu}
				aria-haspopup="menu"
				aria-label="User menu"
				onclick={() => showAvatarMenu = !showAvatarMenu}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						showAvatarMenu = !showAvatarMenu;
						e.preventDefault();
					}
					if (e.key === 'Escape') showAvatarMenu = false;
				}}
			>
				<div class="bottom-nav__avatar">
					{#if auth.currentUser.photo}
						<img
							src={getUserPhotoSrc(auth.currentUser.photo, auth.currentUser)}
							alt="Profile"
							class="bottom-nav__avatar-img"
						/>
					{:else}
						<span class="bottom-nav__avatar-placeholder">
							{(auth.currentUser.firstName || auth.currentUser.name || 'U')
								.slice(0, 1)
								.toUpperCase()}
						</span>
					{/if}
				</div>
				<div class="bottom-nav__user-menu" class:open={showAvatarMenu} onclick={(e) => e.stopPropagation()}>
					<a href="/profile" class="bottom-nav__user-menu-item" onclick={() => showAvatarMenu = false}>Profile</a>
					<!-- Theme toggle inside the submenu for cleaner mobile nav -->
					<div class="bottom-nav__user-menu-item bottom-nav__theme-item" onclick={() => showAvatarMenu = false}>
						<span class="bottom-nav__theme-label">
							{theme.isDark ? 'Dark' : 'Light'}
						</span>
						<ThemeToggle />
					</div>
					<button
						onclick={() => { showAvatarMenu = false; handleLogout(); }}
						class="bottom-nav__user-menu-item bottom-nav__user-menu-item--logout"
					>
						Logout
					</button>
				</div>
			</div>
		{/if}
	</nav>

	<!-- )=- Global mount for shared job modals (singleton open* helpers).
	     JobDetailsModal: jobs/clients list → view details + invoice.
	     JobFormModal: edit/create job from details modal, calendar, etc. -->
	<JobDetailsModal />
	<JobFormModal />
	{#if auth.locked && auth.isAuthenticated}
		<QuickUnlock />
	{/if}
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
		position: relative;
		z-index: var(--z-sticky);
	}

	/* Brand removed on all sizes per request to reduce clunkiness. Top bar is now just menu + user controls on desktop. */

	/* Wide horizontal menu: hidden on mobile (bottom tab bar takes over per plan) */
	.top-nav__menu {
		display: flex;
		gap: var(--space-6);
	}

	/* Center the nav menu on desktop (menu is absolutely positioned in the center,
	   while user controls stay on the right via margin). Mobile top-nav is already hidden. */
	@media (min-width: 769px) {
		.top-nav__menu {
			position: absolute;
			left: 50%;
			transform: translateX(-50%);
		}

		.top-nav__user {
			margin-left: auto;
			z-index: 1; /* ensure user sits above the centered absolute menu if any overlap on narrow desktop */
		}
	}

	@media (max-width: 768px) {
		.top-nav__menu {
			display: none;
		}
		/* Completely hide the top navigation bar on mobile.
		   Avatar (profile/logout) + theme toggle are now integrated into the bottom tab bar (toggle placed under avatar). */
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
		z-index: 1;
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

	/* Invisible bridge so the menu stays open while moving the cursor from avatar to items */
	.top-nav__user-menu::before {
		content: '';
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		height: var(--space-1);
	}

	.top-nav__user-avatar-wrapper:hover .top-nav__user-menu,
	.top-nav__user-avatar-wrapper:focus-within .top-nav__user-menu {
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

	.main-content--locked {
		overflow: hidden;
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

		/* Reserve space at bottom of main-content for the fixed bottom tab bar (now also contains user avatar + toggle on mobile).
		   Content should not be hidden behind the fixed nav. */
		.main-content {
			display: flex;
			flex-direction: column;
			padding-bottom: 62px;
			/* allow tall page content (e.g. full mobile calendar with all time slots) so scrolling is at page level */
			height: auto;
			min-height: 100dvh;
		}

		/* Ensure the bottom-nav user section (avatar+toggle) doesn't push tabs too much; they share remaining space */
		.bottom-nav__tab {
			flex: 1;
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

	/* Mobile: avatar integrated into right side of bottom nav.
	   The dropdown uses position:fixed (declared in base rule) + JS-calculated coords
	   so it reliably appears above the avatar and to its left, fully on-screen,
	   and NEVER affects the height/layout of the bottom nav (no expansion).
	   The .open class (toggled on click) controls display. Hover/focus also work.
	   overflow on nav is safe because fixed is viewport-based. */
	@media (max-width: 768px) {
		.bottom-nav {
			align-items: center;
			padding: 0 8px 0 0; /* extra right padding so the avatar on the far right has breathing room like the other tabs */
			box-sizing: border-box;
			overflow: visible; /* safe with fixed-positioned submenu */
			max-width: 100vw;
		}

		.bottom-nav__avatar-wrapper {
			position: relative;
			cursor: pointer;
			margin-left: auto; /* push avatar + its menu to the right of the tabs */
			padding: 0 8px; /* give horizontal breathing room so avatar isn't crammed in the corner */
			min-width: 48px; /* allocate same room as other interactive items in the bar */
			min-height: 50px; /* match tab height for visual balance */
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
		}

		.bottom-nav__avatar {
			width: 28px;
			height: 28px;
			border-radius: 50%;
			overflow: hidden;
			border: 1px solid var(--color-border);
			background: var(--color-surface-alt);
			flex-shrink: 0;
		}

		.bottom-nav__avatar-img,
		.bottom-nav__avatar-placeholder {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 11px;
			font-weight: 700;
			color: var(--color-surface);
			background: var(--color-text-muted);
		}

		.bottom-nav__user-menu {
			/* Recommended pattern for bottom-right corner trigger:
			   Opens upward (bottom:100%) and left (right:0 so body extends left).
			   position:absolute on relative parent (.bottom-nav__avatar-wrapper).
			   Uses opacity/visibility for smooth open instead of display toggle
			   to avoid any layout shifts. */
			position: absolute;
			bottom: 100%;
			right: 0; /* aligns right edge with trigger's right; submenu extends left onto screen */
			transform: translateX(-11%);
			opacity: 0;
			visibility: hidden;
			pointer-events: none;

			background: var(--color-surface);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-sm);
			box-shadow: var(--shadow-md);
			min-width: 140px;
			padding: var(--space-1) 0;
			display: flex;
			flex-direction: column;
			transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
			z-index: calc(var(--z-fixed) + 1);
		}

		/* Bridge the gap between the upward menu and the avatar trigger */
		.bottom-nav__user-menu::after {
			content: '';
			position: absolute;
			top: 100%;
			left: 0;
			right: 0;
			height: 16px;
		}

		.bottom-nav__user-menu.open,
		.bottom-nav__avatar-wrapper:hover .bottom-nav__user-menu,
		.bottom-nav__avatar-wrapper:focus-within .bottom-nav__user-menu {
			opacity: 1;
			visibility: visible;
			pointer-events: auto;
			transform: translateX(0);
		}

		.bottom-nav__user-menu-item {
			display: flex;
			align-items: center;
			padding: 6px 10px;
			font-size: var(--font-size-sm);
			color: var(--color-text);
			text-decoration: none;
			white-space: nowrap;
			background: none;
			border: none;
			width: 100%;
			text-align: left;
			cursor: pointer;
			gap: 8px;
		}

		.bottom-nav__user-menu-item:hover {
			background: var(--color-surface-alt);
		}

		.bottom-nav__user-menu-item--logout {
			color: var(--color-danger);
			border-top: 1px solid var(--color-border);
		}

		.bottom-nav__user-menu-item--logout:hover {
			background: var(--color-danger-soft);
		}

		/* Theme toggle as a menu item inside the avatar submenu.
		   Label to the left of the icon button, using the parent item's flex + gap.
		   The btn is now icon-only sized. */
		.bottom-nav__theme-item {
			/* no padding override; rely on .bottom-nav__user-menu-item padding + gap */
		}

		.bottom-nav__theme-label {
			font-size: var(--font-size-sm);
			color: var(--color-text);
			white-space: nowrap;
		}

		.bottom-nav__theme-item .theme-toggle__btn {
			width: auto;
			height: 28px;
			padding: 0;
			border: none;
			background: transparent;
			justify-content: center;
			border-radius: 0;
			flex-shrink: 0;
		}

		.bottom-nav__theme-item .theme-toggle__btn:hover {
			background: var(--color-surface-alt);
			border: none;
		}

		.bottom-nav__theme-item .theme-toggle__btn svg {
			width: 16px;
			height: 16px;
		}

		/* Size the main nav tabs compactly on mobile so tabs + avatar fit without widening the viewport or causing horizontal overflow.
		   Icons and labels reduced; tabs allowed to shrink properly. */
		.bottom-nav__tab {
			flex: 1;
			min-width: 0; /* critical: allows shrinking below content size to prevent page widening */
			padding: 2px 2px;
			min-height: 50px;
		}

		.bottom-nav__icon {
			font-size: 15px; /* smaller than base lg, but still visible */
			margin-bottom: 0;
		}

		.bottom-nav__label {
			font-size: 9px;
			line-height: 1.1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

	}
</style>
