<!-- src/routes/(app)/jobs/+page.svelte -->
<script lang="ts">
	import {
		db,
		type Job,
		type Client,
		getInvoiceForJob,
		getUserPhotoSrc,
		isInvoiceOverdue,
		dedupJobs
	} from '$lib/db';
	import { pullJobsFromServer, pullUsersFromServer, pullInvoicesFromServer, pb } from '$lib/db/pb';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { openJobDetailsModal } from '$lib/components/JobDetailsModal.svelte';

	// )=- Phase 5 overhaul of /jobs page per JOBS_AND_INVOICES_SPEC.md.
	// Rich filters (quick presets, date range, facets, broad search, has-invoice), pagination, enriched cards,
	// and click now opens the shared JobDetailsModal (with full invoice support from previous phases).
	// All in Svelte 5 runes + strict BEM. Pre-existing simple version replaced.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

	let jobs = $state<Job[]>([]);
	let clients = $state<Client[]>([]);
	let users = $state<any[]>([]);
	let loading = $state(true);
	let page = $state(1);
	const PAGE_SIZE = 25;

	// Filter state (rich surface as specified)
	let activeQuick = $state<'all' | 'upcoming' | 'past' | 'this-month'>('all');
	let searchTerm = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let includeCancelled = $state(false);
	let selectedAreas = $state<string[]>([]);
	let minAmount = $state<number | null>(null);
	let maxAmount = $state<number | null>(null);
	let hasInvoiceFilter = $state<'all' | 'has' | 'none'>('all');

	// )=- invoiceMap kept for has-invoice facets (boolean). Added invoiceStatus for richer cards/facets.
	// Now includes status + isOverdue so we can render overdue visuals (red badge/pill) on cards per Phase 7.
	// )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 (overdue visual treatment everywhere)
	let invoiceMap = $state<Record<string, boolean>>({});
	let invoiceStatus = $state<Record<string, { status?: string; isOverdue?: boolean }>>({});

	// )=- Error state for Phase 7 polish: proper loading / empty / error states with BEM.
	// Set during load/refresh so we can show user-friendly error with retry (the refresh button will work).
	let error = $state<string | null>(null);

	// )=- Load jobs + clients + build invoice presence + overdue info for facets and rich cards.
	// We enrich client-side (local-first Dexie). Uses shared isInvoiceOverdue helper for consistency with modal.
	// )=- Also load users for crew photo resolution in cards.
	async function loadJobs() {
		loading = true;
		error = null;
		try {
			const [allJobs, allClients, allUsers] = await Promise.all([
				db.jobs.toArray(),
				db.clients.toArray(),
				db.users.toArray()
			]);
			// Dedup to avoid showing duplicates when Dexie has both local-UUID and PB-id versions of the same job
			// (common after local create + pull). Matches logic used in calendar/clients/getJobsForRange.
			jobs = dedupJobs(allJobs);
			clients = allClients;
			users = allUsers;

			// Build maps for facets (has invoice) + cards (status + overdue badge treatment)
			invoiceMap = {};
			invoiceStatus = {};
			for (const j of jobs) {
				if (j.id) {
					const inv = await getInvoiceForJob(j.id);
					const has = !!inv;
					invoiceMap[j.id] = has;
					if (has && inv) {
						invoiceStatus[j.id] = {
							status: inv.status,
							isOverdue: isInvoiceOverdue(inv)
						};
					}
				}
			}
		} catch (e: any) {
			error = e?.message || 'Failed to load local jobs data';
			console.error('loadJobs failed', e);
		} finally {
			loading = false;
		}
	}

	async function refreshFromServer() {
		if (pb.authStore.isValid) {
			error = null;
			try {
				await pullJobsFromServer();
				await pullInvoicesFromServer();
				await loadJobs();
				if (auth.currentUser?.role === 'admin') {
					await pullUsersFromServer(true);
					users = await db.users.toArray();
				}
			} catch (e: any) {
				error = e?.message || 'Failed to refresh from PocketBase';
				console.error('refreshFromServer failed', e);
			}
		}
	}

	// )=- Auth + initial load (runes pattern consistent with rest of app)
	let jobsLoaded = $state(false);
	$effect(() => {
		if (!auth.loading && (!auth.isAuthenticated || !auth.currentUser)) {
			goto('/login', { replaceState: true });
			return;
		}
	});

	$effect(() => {
		if (!auth.loading && auth.isAuthenticated && !jobsLoaded) {
			jobsLoaded = true;
			// )=- Load options early so area chips have proper labels + colors (not raw IDs).
			optionsStore.load?.();
			loadJobs().then(async () => {
				if (navigator.onLine) {
					await refreshFromServer();
					// )=- For admins, ensure user roster is hydrated so crew avatars in cards resolve from server data (photos, names).
					// The pull is guarded (session + in-flight) so safe and non-spammy. Self-sync inside guarantees current admin.
					// This makes the enrichment in cards (and similarly in modal/calendar) work reliably.
					if (auth.currentUser?.role === 'admin') {
						await pullUsersFromServer();
						// re-load local users after possible pull so the cards see fresh data immediately
						users = await db.users.toArray();
					}
				}
			});
		}
	});

	// )=- Rich derived filtered + paginated list.
	// Search is deliberately broad (title, notes, crew, client name/address, billable titles).
	// Facets: areas (multi), amount range, has-invoice, includeCancelled.
	// Pagination applied after filtering (per Phase 5 decision).
	// )=- Legacy/imperfect data: code uses extensive || guards and optional chaining so old imported jobs
	// (with importSource, missing billables/area/crew, partial fields) don't break display, search or filters.
	// 'imperfection allowed' is a core requirement (see spec Phase 10 and Phase 7 'Test with imperfect legacy-shaped data').
	// Reference: JOBS_AND_INVOICES_SPEC.md + Remedine/Svelte_FullCalendar_Dexie_Scheduling
	const filteredAndSorted = $derived.by(() => {
		let result = [...jobs];

		const term = searchTerm.toLowerCase().trim();
		if (term) {
			result = result.filter((j) => {
				const client = clients.find((c) => c.id === j.clientId || c.pbId === j.clientId);
				const clientText = client
					? `${client.name} ${client.serviceAddressStreet} ${client.email}`.toLowerCase()
					: '';
				const billableText = (j.billableItems || [])
					.map((b) => b.title)
					.join(' ')
					.toLowerCase();
				// )=- Legacy/imperfect data guards: assignedCrew or areaOfTown may be missing/null/undefined for old imported jobs (importSource).
				// 'imperfection allowed' per spec. Use || [] and || '' to prevent crashes in search.
				// Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 (Test with imperfect legacy-shaped data) + Phase 10
				return (
					(j.title || '').toLowerCase().includes(term) ||
					(j.notes || '').toLowerCase().includes(term) ||
					(j.assignedCrew || []).join(' ').toLowerCase().includes(term) ||
					clientText.includes(term) ||
					billableText.includes(term) ||
					(j.areaOfTown || '').toLowerCase().includes(term)
				);
			});
		}

		// Quick presets
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		if (activeQuick === 'upcoming') {
			result = result.filter((j) => new Date(j.start) >= now);
		} else if (activeQuick === 'past') {
			result = result.filter((j) => new Date(j.start) < now);
		} else if (activeQuick === 'this-month') {
			result = result.filter((j) => new Date(j.start) >= startOfMonth);
		}

		// Date range
		if (dateFrom) {
			const from = new Date(dateFrom);
			result = result.filter((j) => new Date(j.start) >= from);
		}
		if (dateTo) {
			const to = new Date(dateTo);
			result = result.filter((j) => new Date(j.start) <= to);
		}

		// Cancelled facet
		if (!includeCancelled) {
			result = result.filter((j) => j.status !== 'cancelled');
		}

		// Area chips
		// )=- Guard for legacy jobs that may lack areaOfTown (null/undefined/missing from import).
		if (selectedAreas.length > 0) {
			result = result.filter((j) => selectedAreas.includes(j.areaOfTown || ''));
		}

		// Amount range
		// )=- Non-null guards + ! casts to satisfy TS (pre-existing pnpm noise on minAmount/maxAmount state was number|null). UI sets/clears them; filter only applies when present.
		if (minAmount != null)
			result = result.filter((j) => (j.totalAmount || 0) >= (minAmount as number));
		if (maxAmount != null)
			result = result.filter((j) => (j.totalAmount || 0) <= (maxAmount as number));

		// Has invoice facet (uses the map we built)
		if (hasInvoiceFilter !== 'all') {
			result = result.filter((j) => {
				const has = j.id ? invoiceMap[j.id] : false;
				return hasInvoiceFilter === 'has' ? has : !has;
			});
		}

		// Sort most recent first
		result.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

		return result;
	});

	const paginatedJobs = $derived(filteredAndSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	const totalPages = $derived(Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE)));

	function setQuick(q: typeof activeQuick) {
		activeQuick = q;
		page = 1;
	}

	function toggleArea(area: string) {
		if (selectedAreas.includes(area)) {
			selectedAreas = selectedAreas.filter((a) => a !== area);
		} else {
			selectedAreas = [...selectedAreas, area];
		}
		page = 1;
	}

	function resetFilters() {
		searchTerm = '';
		activeQuick = 'all';
		dateFrom = '';
		dateTo = '';
		includeCancelled = false;
		selectedAreas = [];
		minAmount = null;
		maxAmount = null;
		hasInvoiceFilter = 'all';
		page = 1;
	}

	function goToPage(p: number) {
		page = Math.max(1, Math.min(p, totalPages));
	}

	// Open the shared details modal (the whole point of the reusable modal)
	function openDetails(job: Job) {
		openJobDetailsModal(job);
	}

	// )=- Use full area objects from optionsStore (id + label + color) for chips.
	// Filtering still uses the area id (stored on jobs).
	// This was the root cause of "areas filter pulling in the area id and not the corresponding area label or color".
	const areaOptions = $derived(optionsStore.data?.areasOfTown ?? []);
</script>

<div class="job-page">
	<header class="job-page__header">
		<div>
			<h1 class="job-page__title">All Jobs</h1>
			<p class="job-page__subtitle">
				{paginatedJobs.length} shown • {filteredAndSorted.length} matching
				{#if auth.currentUser?.role === 'crew'}
					• Your assigned jobs only{/if}
			</p>
		</div>
		<button
			class="job-page__btn job-page__btn--primary"
			onclick={refreshFromServer}
			disabled={loading}
		>
			🔄 Sync
		</button>
	</header>

	<!-- Rich filters (Phase 5) -->
	<div class="job-page__filters">
		<!-- Quick presets -->
		<div class="job-page__quick">
			<button class:active={activeQuick === 'all'} onclick={() => setQuick('all')}>All</button>
			<button class:active={activeQuick === 'upcoming'} onclick={() => setQuick('upcoming')}
				>Upcoming</button
			>
			<button class:active={activeQuick === 'past'} onclick={() => setQuick('past')}>Past</button>
			<button class:active={activeQuick === 'this-month'} onclick={() => setQuick('this-month')}
				>This Month</button
			>
		</div>

		<input
			type="text"
			class="job-page__search"
			placeholder="Search title, notes, crew, client, billables, area..."
			bind:value={searchTerm}
		/>

		<div class="job-page__date-range">
			<input type="date" bind:value={dateFrom} title="From date" />
			<input type="date" bind:value={dateTo} title="To date" />
		</div>

		<label class="job-page__toggle">
			<input type="checkbox" bind:checked={includeCancelled} /> Include cancelled
		</label>

		<button class="job-page__btn" onclick={resetFilters}>Reset</button>
	</div>

	<!-- Facets -->
	<div class="job-page__facets">
		<!-- Areas (use label + color from options, filter by id) -->
		<div class="job-page__facet">
			{#each areaOptions as area (area.id)}
				<button
					class="area-chip"
					class:active={selectedAreas.includes(area.id)}
					onclick={() => toggleArea(area.id)}
					style="background-color: {area.color}20; color: {area.color}; border-color: {area.color};"
				>
					{area.label}
				</button>
			{/each}
		</div>

		<!-- Amount range -->
		<div class="job-page__facet job-page__amount">
			<input type="number" placeholder="Min $" bind:value={minAmount} oninput={() => (page = 1)} />
			<input type="number" placeholder="Max $" bind:value={maxAmount} oninput={() => (page = 1)} />
		</div>

		<!-- Invoice presence -->
		<div class="job-page__facet">
			<button
				class:active={hasInvoiceFilter === 'all'}
				onclick={() => {
					hasInvoiceFilter = 'all';
					page = 1;
				}}>All</button
			>
			<button
				class:active={hasInvoiceFilter === 'has'}
				onclick={() => {
					hasInvoiceFilter = 'has';
					page = 1;
				}}>Has Invoice</button
			>
			<button
				class:active={hasInvoiceFilter === 'none'}
				onclick={() => {
					hasInvoiceFilter = 'none';
					page = 1;
				}}>No Invoice</button
			>
		</div>
	</div>

	{#if loading}
		<div class="job-page__loading">Loading jobs…</div>
	{:else if error}
		<!-- )=- Proper error state per Phase 7. Shows friendly message + reuses the refresh button (which calls refreshFromServer and will clear error on success).
		     BEM classes for styling. The initial load and manual refresh (see button near top) both feed this state. -->
		<div class="job-page__error">
			<p>Failed to load jobs: {error}</p>
			<button class="job-page__btn" onclick={() => refreshFromServer()}>Retry</button>
		</div>
	{:else if paginatedJobs.length === 0}
		<div class="job-page__empty">
			No jobs match your filters. Try clearing search, dates, or facets.
		</div>
	{:else}
		<div class="job-page__list">
			{#each paginatedJobs as job (job.id)}
				{@const client = clients.find((c) => c.id === job.clientId || c.pbId === job.clientId)}
				{@const area = areaOptions.find((a: any) => a.id === job.areaOfTown)}
				<div
					class="job-page__card card card--interactive"
					role="button"
					tabindex="0"
					style="border-left: 6px solid {getDisplayAreaColor(area?.color) || '#64748b'};"
					onclick={() => openDetails(job)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openDetails(job);
						}
					}}
				>
					<div class="job-page__card-header">
						<span class="badge badge--{job.status}">{job.status}</span>
						<span class="job-page__total">${(job.totalAmount || 0).toFixed(2)}</span>
						{#if job.id && invoiceMap[job.id]}
							{@const info = invoiceStatus[job.id]}
							<span class="job-page__invoice-badge badge" class:overdue={info?.isOverdue}>
								📄 Invoice
								{#if info?.isOverdue}
									<span class="badge--overdue-pill">OVERDUE</span>
								{/if}
							</span>
						{/if}
					</div>

					<h3 class="job-page__card-title">{job.title}</h3>

					<div class="job-page__meta">
						{#if client}
							<span class="job-page__client" title={client.serviceAddressStreet || ''}
								>{client.name}</span
							>
						{/if}
						<span
							>{new Date(job.start).toLocaleDateString()} • {new Date(job.start).toLocaleTimeString(
								[],
								{ hour: '2-digit', minute: '2-digit' }
							)}</span
						>
						<!-- )=- Crew avatars + names for richer cards. Resolves from loaded users by name (photos may be data: URLs for offline or PB refs). Stack of small circles, full names on title. -->
						<div class="job-page__crew">
							<!-- )=- Guard for legacy jobs where assignedCrew may be missing or null (imperfect import data). -->
							{#each job.assignedCrew || [] as crewName, idx (idx)}
								{@const u = users.find((uu) => uu.name === crewName)}
								<span class="job-page__crew-avatar" title={crewName}>
									{#if u?.photo}
										<!-- )=- Use central helper for normalization (data:/http as-is; bare filename -> full getURL). -->
										<img src={getUserPhotoSrc(u.photo, u)} alt={crewName} />
									{:else}
										<span class="job-page__crew-initial">{crewName?.[0]?.toUpperCase() || '?'}</span
										>
									{/if}
								</span>
							{/each}
							<span class="job-page__crew-names">{job.assignedCrew.join(', ')}</span>
						</div>
						{#if area}
							<span class="job-page__area" style="color: {area.color};">{area.label}</span>
						{/if}
					</div>

					{#if job.notes}
						<p class="job-page__notes">{job.notes}</p>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		<div class="job-page__pagination">
			<button disabled={page === 1} onclick={() => goToPage(page - 1)}>← Prev</button>
			<span>Page {page} / {totalPages}</span>
			<button disabled={page === totalPages} onclick={() => goToPage(page + 1)}>Next →</button>
		</div>
	{/if}
</div>

<!-- Note: JobDetailsModal is globally mounted in (app)/+layout.svelte for the openJobDetailsModal singleton to work across pages (jobs, clients related jobs, etc.). -->

<style>
	/* BEM strictly followed for Phase 5 rich jobs page */
	.job-page {
		padding: var(--space-6) var(--space-4);
		max-width: 1200px;
		margin: 0 auto;
	}
	.job-page__header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: var(--space-4);
	}
	.job-page__title {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-text);
		margin: 0;
	}
	.job-page__subtitle {
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-sm);
	}

	.job-page__filters {
		display: flex;
		gap: var(--space-3);
		margin-bottom: var(--space-3);
		flex-wrap: wrap;
		align-items: center;
	}
	.job-page__quick {
		display: flex;
		gap: var(--space-1);
	}
	.job-page__quick button {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		cursor: pointer;
		color: var(--color-text);
	}
	.job-page__quick button.active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.job-page__search {
		flex: 1;
		min-width: 220px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
	}
	.job-page__date-range {
		display: flex;
		gap: var(--space-1);
	}
	.job-page__date-range input {
		padding: var(--space-1);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		color: var(--color-text);
	}
	.job-page__toggle {
		font-size: var(--font-size-xs);
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--color-text-muted);
	}

	.job-page__btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}
	.job-page__btn--primary {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.job-page__facets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	.job-page__facet {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}
	.area-chip {
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		font-size: var(--font-size-xs);
		cursor: pointer;
		background: var(--color-surface);
		color: var(--color-text);
	}
	.area-chip.active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}
	.job-page__amount input {
		width: 80px;
		padding: var(--space-1);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.job-page__list {
		display: grid;
		gap: var(--space-3);
	}
	.job-page__card {
		/* composes global .card + .card--interactive for cohesion */
		padding: var(--space-3) var(--space-4);
	}
	.job-page__card-header {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin-bottom: var(--space-2);
		flex-wrap: wrap;
	}
	/* Status badges now use global .badge + .badge--* primitives (tokens + dark support).
	   Overdue uses .badge--overdue (defined in globals). The inner pill is a small variant. */
	.job-page__invoice-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 1px var(--space-1);
		font-size: var(--font-size-xs);
		border-radius: var(--radius-sm);
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	.job-page__invoice-badge.overdue {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: 1px solid var(--color-danger);
	}
	.badge--overdue-pill {
		font-size: var(--font-size-xs);
		background: var(--color-danger);
		color: white;
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
		text-transform: uppercase;
		font-weight: var(--font-weight-semibold);
	}
	.job-page__total {
		font-weight: var(--font-weight-bold);
		color: var(--color-text);
		margin-left: auto;
	}

	.job-page__card-title {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-semibold);
	}
	.job-page__meta {
		display: flex;
		gap: var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}
	.job-page__crew {
		font-weight: var(--font-weight-medium);
	}
	.job-page__client {
		font-weight: var(--font-weight-medium);
		color: var(--color-primary-emphasis);
	}
	.job-page__area {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		margin-left: auto;
	}
	.job-page__crew {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.job-page__crew-avatar {
		width: 20px;
		height: 20px;
		border-radius: var(--radius-full);
		overflow: hidden;
		border: 1px solid var(--color-border);
		flex-shrink: 0;
		background: var(--color-surface-alt);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
	}
	.job-page__crew-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.job-page__crew-initial {
		font-size: var(--font-size-xs);
	}
	.job-page__crew-names {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-left: var(--space-1);
	}
	.job-page__notes {
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.job-page__pagination {
		display: flex;
		justify-content: center;
		gap: var(--space-4);
		margin-top: var(--space-4);
		font-size: var(--font-size-sm);
	}
	.job-page__pagination button {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
	}

	/* )=- Loading / empty / error states with BEM (Phase 7 polish).
	   Consistent centered messaging. Error gets a distinct red tint for visibility.
	   The retry button reuses .job-page__btn for simplicity. */
	.job-page__loading,
	.job-page__empty,
	.job-page__error {
		text-align: center;
		padding: var(--space-8);
		color: var(--color-text-muted);
		border-radius: var(--radius-md);
		background: var(--color-surface-alt);
	}
	.job-page__error {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
	}
	.job-page__error p {
		margin: 0 0 var(--space-2);
	}

	/* Mobile responsive for token cohesion and tighter layout on small screens.
	   Matches the pattern used on clients, options, crew pages. */
	@media (max-width: 768px) {
		.job-page {
			padding: var(--space-3) var(--space-2);
		}
		.job-page__search {
			min-width: 160px;
		}
		.job-page__card {
			padding: var(--space-2) var(--space-3);
		}
		.job-page__card-title {
			margin-bottom: var(--space-1);
		}
		.job-page__notes {
			margin-top: var(--space-1);
		}
	}
</style>
