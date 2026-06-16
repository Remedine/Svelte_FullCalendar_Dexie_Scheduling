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

	let showAvatarMenu = $state(false);

	// Refs for reliable positioning of the mobile avatar menu (fixed + on-screen clamp).
	let avatarWrapperEl: HTMLDivElement | null = $state(null);
	let menuEl: HTMLDivElement | null = $state(null);

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

	// Robust outside-click closer for the mobile avatar menu.
	// Always attached (while layout is mounted) and only acts when menu is open.
	// This avoids timing issues with adding the listener inside the "open" click itself
	// (which previously could prevent reliable opening on tap/click).
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

	// Position the mobile dropdown using position:fixed + measurements + clamping.
	// This guarantees it opens "top left" (above + extending left from the avatar)
	// and is fully visible on screen regardless of ancestor overflow/clipping.
	// We still rely on the CSS class:open rule for display:none <-> flex.
	$effect(() => {
		if (!menuEl) return;

		if (!showAvatarMenu || !avatarWrapperEl) {
			// Clear any inline fixed positioning when closed so CSS takes over (display:none).
			menuEl.style.position = '';
			menuEl.style.top = '';
			menuEl.style.left = '';
			menuEl.style.right = '';
			menuEl.style.zIndex = '';
			return;
		}

		// Defer to ensure Svelte has applied class:open (display:flex) and layout is updated.
		queueMicrotask(() => {
			if (!showAvatarMenu || !avatarWrapperEl || !menuEl) return;

			const rect = avatarWrapperEl.getBoundingClientRect();
			const vw = window.innerWidth || 360;
			const menuWidth = 150;
			const approxMenuHeight = 102; // Profile row + theme row + logout row + paddings/borders/gap
			const gapAbove = 6;

			// Anchor above the bottom bar near the avatar.
			let top = rect.top - approxMenuHeight - gapAbove;
			top = Math.max(8, top); // never off the top of the screen

			// "Top left" visible placement: menu's right edge near the avatar's right but
			// clamped so the entire menu (incl. border + shadow) has breathing room from the viewport right edge.
			// This extends the menu body leftward (inward) from the right side of the bar.
			let desiredRight = Math.min(rect.right, vw - 8);
			let left = desiredRight - menuWidth;
			if (left < 8) left = 8;

			menuEl.style.position = 'fixed';
			menuEl.style.top = `${top}px`;
			menuEl.style.left = `${left}px`;
			menuEl.style.right = 'auto';
			menuEl.style.bottom = 'auto';
			menuEl.style.zIndex = '999'; // above the fixed bottom nav and page content
		});
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

		<!-- Mobile-only: avatar with dropdown menu integrated into bottom nav.
		     Clicking avatar toggles the menu (Profile + dark mode toggle + Logout).
		     Menu opens top-left of avatar (via right calc + visible overflow) so it is always on-screen on mobile.
		     Theme toggle is inside the dropdown. No separate footer or brand text on mobile. -->
		{#if auth.currentUser}
			<div 
				class="bottom-nav__avatar-wrapper"
				bind:this={avatarWrapperEl}
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
				<div class="bottom-nav__user-menu" class:open={showAvatarMenu} bind:this={menuEl}>
					<a href="/profile" class="bottom-nav__user-menu-item" onclick={() => showAvatarMenu = false}>Profile</a>
					<!-- Theme toggle inside the dropdown for cleaner mobile nav -->
					<div class="bottom-nav__user-menu-item bottom-nav__theme-item" onclick={() => showAvatarMenu = false}>
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

	/* Brand removed on all sizes per request to reduce clunkiness. Top bar is now just menu + user controls on desktop. */

	/* Wide horizontal menu: hidden on mobile (bottom tab bar takes over per plan) */
	.top-nav__menu {
		display: flex;
		gap: var(--space-6);
	}

	/* Center the nav menu on desktop (menu is absolutely positioned in the center,
	   while user controls stay on the right via margin). Mobile top-nav is already hidden. */
	@media (min-width: 769px) {
		.top-nav {
			position: relative;
		}

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
	   Dropdown menu (opened by click) contains Profile + Theme toggle (as item) + Logout.
	   Opens top-left (right:calc(100%+...) + overflow-y:visible) to ensure fully visible on screen.
	   No stacking of toggle under avatar. Avatar wrapper pushed to far right. */
	@media (max-width: 768px) {
		.bottom-nav {
			align-items: center;
			padding: 0 8px 0 0; /* extra right padding so the avatar on the far right has breathing room like the other tabs */
			box-sizing: border-box;
			overflow-x: hidden; /* prevent horizontal page widening from nav tabs */
			overflow-y: visible; /* allow the avatar dropdown menu (positioned above) to be fully visible, not clipped */
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
			/* Positioning is now handled via JS + position:fixed + clamping in the $effect
			   (when .open + showAvatarMenu) to guarantee "top left" placement that is always
			   fully visible on screen (no ancestor clipping, right-edge breathing room).
			   We keep display control + visual styles here. */
			background: var(--color-surface);
			border: 1px solid var(--color-border);
			border-radius: var(--radius-sm);
			box-shadow: var(--shadow-md);
			min-width: 140px;
			z-index: var(--z-dropdown);
			display: none;
			flex-direction: column;
		}

		.bottom-nav__user-menu.open,
		.bottom-nav__avatar-wrapper:hover .bottom-nav__user-menu,
		.bottom-nav__avatar-wrapper:focus-within .bottom-nav__user-menu {
			display: flex;
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

		/* Theme toggle as a menu item inside the avatar dropdown.
		   Make the toggle button blend as a full-width menu row with icon only (or minimal). */
		.bottom-nav__theme-item {
			padding: 0;
		}

		.bottom-nav__theme-item .theme-toggle__btn {
			width: 100%;
			height: 28px;
			padding: 0 10px;
			border: none;
			background: transparent;
			justify-content: flex-start;
			border-radius: 0;
			gap: 8px;
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
