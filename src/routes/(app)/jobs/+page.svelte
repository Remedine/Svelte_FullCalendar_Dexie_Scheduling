<!-- src/routes/(app)/jobs/+page.svelte -->
<script lang="ts">
	import {
		db,
		type Job,
		type Client,
		getInvoiceForJob,
		getUserPhotoSrc,
		isInvoiceOverdue
	} from '$lib/db';
	import { pullJobsFromServer, pullUsersFromServer, pullInvoicesFromServer, pb } from '$lib/db/pb';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { optionsStore } from '$lib/stores/options.svelte';
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
			jobs = allJobs;
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
					class="job-page__card"
					role="button"
					tabindex="0"
					style="border-left: 6px solid {area?.color || '#64748b'};"
					onclick={() => openDetails(job)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							openDetails(job);
						}
					}}
				>
					<div class="job-page__card-header">
						<span class="job-page__status job-page__status--{job.status}">{job.status}</span>
						<span class="job-page__total">${(job.totalAmount || 0).toFixed(2)}</span>
						{#if job.id && invoiceMap[job.id]}
							{@const info = invoiceStatus[job.id]}
							<span class="job-page__invoice-badge" class:overdue={info?.isOverdue}>
								📄 Invoice
								{#if info?.isOverdue}
									<span class="job-page__overdue-pill">OVERDUE</span>
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
		padding: 1.5rem;
		max-width: 1200px;
		margin: 0 auto;
	}
	.job-page__header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1rem;
	}
	.job-page__title {
		font-size: 1.75rem;
		font-weight: 700;
		color: #0f172a;
		margin: 0;
	}
	.job-page__subtitle {
		color: #64748b;
		margin: 0.25rem 0 0;
		font-size: 0.9rem;
	}

	.job-page__filters {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
		align-items: center;
	}
	.job-page__quick {
		display: flex;
		gap: 0.25rem;
	}
	.job-page__quick button {
		padding: 0.35rem 0.75rem;
		border: 1px solid #cbd5e1;
		background: white;
		border-radius: 6px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.job-page__quick button.active {
		background: #1e40af;
		color: white;
		border-color: #1e40af;
	}

	.job-page__search {
		flex: 1;
		min-width: 220px;
		padding: 0.55rem 0.8rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
	}
	.job-page__date-range {
		display: flex;
		gap: 0.25rem;
	}
	.job-page__date-range input {
		padding: 0.35rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 0.8rem;
	}
	.job-page__toggle {
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.job-page__btn {
		padding: 0.45rem 0.9rem;
		border-radius: 6px;
		font-weight: 500;
		cursor: pointer;
		border: 1px solid #cbd5e1;
		background: white;
		font-size: 0.85rem;
	}
	.job-page__btn--primary {
		background: #3b82f6;
		color: white;
		border-color: #3b82f6;
	}

	.job-page__facets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.job-page__facet {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}
	.area-chip {
		padding: 0.2rem 0.6rem;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		font-size: 0.75rem;
		cursor: pointer;
		background: white;
	}
	.area-chip.active {
		background: #1e40af;
		color: white;
		border-color: #1e40af;
	}
	.job-page__amount input {
		width: 80px;
		padding: 0.25rem;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		font-size: 0.8rem;
	}

	.job-page__list {
		display: grid;
		gap: 0.75rem;
	}
	.job-page__card {
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 0.9rem 1rem;
		cursor: pointer;
		transition:
			box-shadow 0.1s,
			transform 0.1s;
	}
	.job-page__card:hover {
		box-shadow: 0 3px 10px rgb(15 23 42 / 0.08);
		transform: translateY(-1px);
	}
	.job-page__card-header {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.4rem;
		flex-wrap: wrap;
	}
	.job-page__status {
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
	}
	.job-page__status--scheduled {
		background: #dbeafe;
		color: #1e40af;
	}
	.job-page__status--confirmed {
		background: #d1fae5;
		color: #166534;
	}
	.job-page__status--completed {
		background: #a7f3d0;
		color: #065f46;
	}
	.job-page__status--cancelled {
		background: #fee2e2;
		color: #991b1b;
	}
	.job-page__invoice-badge {
		font-size: 0.65rem;
		background: #ecfdf5;
		color: #166534;
		padding: 0.1rem 0.4rem;
		border-radius: 4px;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	/* )=- Overdue visual treatment on jobs cards (Phase 7). Red tint + small pill when the linked invoice is overdue (not paid + past dueDate).
	   Uses the enriched invoiceStatus from loadJobs + shared isInvoiceOverdue helper. BEM modifier + nested pill for clarity.
	   Matches the OVERDUE badge style in the details modal. */
	.job-page__invoice-badge.overdue {
		background: #fee2e2;
		color: #991b1b;
		border: 1px solid #fecaca;
	}
	.job-page__overdue-pill {
		font-size: 0.55rem;
		background: #991b1b;
		color: white;
		padding: 0 0.2rem;
		border-radius: 2px;
		text-transform: uppercase;
	}
	.job-page__total {
		font-weight: 700;
		color: #0f172a;
		margin-left: auto;
	}

	.job-page__card-title {
		margin: 0 0 0.3rem;
		font-size: 1rem;
		font-weight: 600;
	}
	.job-page__meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.8rem;
		color: #64748b;
	}
	.job-page__crew {
		font-weight: 500;
	}
	.job-page__client {
		font-weight: 500;
		color: #1e40af;
	}
	.job-page__area {
		font-size: 0.75rem;
		font-weight: 500;
		margin-left: auto;
	}
	.job-page__crew {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.job-page__crew-avatar {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		overflow: hidden;
		border: 1px solid #e2e8f0;
		flex-shrink: 0;
		background: #f1f5f9;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
		font-weight: 600;
		color: #475569;
	}
	.job-page__crew-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.job-page__crew-initial {
		font-size: 0.6rem;
	}
	.job-page__crew-names {
		font-size: 0.75rem;
		color: #64748b;
		margin-left: 0.25rem;
	}
	.job-page__notes {
		margin: 0.4rem 0 0;
		font-size: 0.8rem;
		color: #475569;
	}

	.job-page__pagination {
		display: flex;
		justify-content: center;
		gap: 1rem;
		margin-top: 1rem;
		font-size: 0.9rem;
	}
	.job-page__pagination button {
		padding: 0.3rem 0.7rem;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		background: white;
	}

	/* )=- Loading / empty / error states with BEM (Phase 7 polish).
	   Consistent centered messaging. Error gets a distinct red tint for visibility.
	   The retry button reuses .job-page__btn for simplicity. */
	.job-page__loading,
	.job-page__empty,
	.job-page__error {
		text-align: center;
		padding: 2.5rem;
		color: #64748b;
		border-radius: 8px;
	}
	.job-page__error {
		background: #fee2e2;
		color: #991b1b;
	}
	.job-page__error p {
		margin: 0 0 0.5rem;
	}
</style>
