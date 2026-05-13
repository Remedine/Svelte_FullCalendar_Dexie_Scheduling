<script lang="ts">
	import { page } from '$app/stores';
</script>

<div class="app-layout">
	<!-- Top Navigation Bar -->
	<header class="top-nav">
		<div class="top-nav__brand">
			<h1>Capital City Windows</h1>
			<p class="top-nav__subtitle">Scheduler</p>
		</div>

		<nav class="top-nav__menu">
			<a href="/calendar" class="top-nav__link {$page.url.pathname === '/calendar' ? 'active' : ''}">
				📅 Schedule
			</a>
			<a href="/clients" class="top-nav__link {$page.url.pathname.startsWith('/clients') ? 'active' : ''}">
				👥 Clients
			</a>
			<a href="/jobs" class="top-nav__link">
				📋 Jobs
			</a>
		</nav>

		<div class="top-nav__user">
			<span>Brick Engstrom</span>
			<!-- Later: User avatar / logout -->
		</div>
	</header>

	<!-- Main Content Area -->
	<main class="main-content">
		<slot />
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

	.top-nav__subtitle {
		margin: 0;
		font-size: 0.8rem;
		color: #64748b;
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
		overflow: auto;
		padding: 0;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.top-nav__menu {
			gap: 1rem;
			font-size: 0.95rem;
		}
	}
</style>