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
	import { goto, replaceState } from '$app/navigation';
	import { page as appPage } from '$app/state';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { openJobDetailsModal } from '$lib/components/JobDetailsModal.svelte';
	import { getUserDisplayName, isJobAssignedToCrew } from '$lib/utils/crew';

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
	// Primary quick segmented controls
	let quickTimeFilter = $state<'all' | 'upcoming' | 'past'>('all');
	let quickDateWindow = $state<'all' | 'this-month' | 'this-week'>('all');
	let showCancelled = $state(false); // true = show/include cancelled (replaces old checkbox)
	let searchTerm = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let selectedAreas = $state<string[]>([]);
	let selectedCrew = $state<string[]>([]);
	let showOverdueOnly = $state(false);
	let minAmount = $state<number | null>(null);
	let maxAmount = $state<number | null>(null);
	let invoiceFilter = $state<'all' | 'has' | 'none'>('all'); // now a segmented control inside Financial group
	// More Filters collapsible state (default closed, persisted)
	let moreFiltersOpen = $state(false);

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

	// Persist "More Filters" open state (default closed everywhere, remember last user preference)
	$effect(() => {
		const saved = localStorage.getItem('jobsMoreFiltersOpen');
		moreFiltersOpen = saved !== null ? saved === 'true' : false;
	});
	$effect(() => {
		localStorage.setItem('jobsMoreFiltersOpen', String(moreFiltersOpen));
	});

	// Deep link: /jobs?jobId=…&tab=invoice (e.g. after "Click to complete" from job form)
	let jobDeepLinkHandled = $state<string | null>(null);
	$effect(() => {
		if (loading) return;

		const jobId = appPage.url.searchParams.get('jobId');
		if (!jobId || jobDeepLinkHandled === jobId) return;

		jobDeepLinkHandled = jobId;
		const initialTab = appPage.url.searchParams.get('tab') === 'invoice' ? 'invoice' : 'job';

		const openFromDeepLink = async () => {
			let job =
				jobs.find((j) => j.id === jobId || j.pbId === jobId) ||
				(await db.jobs.get(jobId)) ||
				(await db.jobs.where('pbId').equals(jobId).first());

			if (job) {
				openJobDetailsModal(job, { initialTab });
			} else {
				openJobDetailsModal(jobId, { initialTab });
			}

			await loadJobs();

			const url = new URL(appPage.url);
			url.searchParams.delete('jobId');
			url.searchParams.delete('tab');
			replaceState(url.pathname + url.search, {});
		};

		void openFromDeepLink();
	});

	// )=- Rich derived filtered + paginated list.
	// Search is the primary (kept prominent on own line).
	// Quick row: All + Upcoming/Past toggle + ThisMonth/ThisWeek toggle + Show/Hide Cancel toggle + Reset.
	// More Filters (collapsible): Areas (tokens), Date range, Financial (amounts + invoice toggle).
	// All quick presets combine with manual filters in More Filters.
	// Pagination applied after filtering.
	// )=- Legacy/imperfect data: code uses extensive || guards and optional chaining so old imported jobs
	// (with importSource, missing billables/area/crew, partial fields) don't break display, search or filters.
	// 'imperfection allowed' is a core requirement (see spec Phase 10 and Phase 7 'Test with imperfect legacy-shaped data').
	// Reference: JOBS_AND_INVOICES_SPEC.md + Remedine/Svelte_FullCalendar_Dexie_Scheduling
	const filteredAndSorted = $derived.by(() => {
		let result = [...jobs];

		// )=- Crew users only see jobs they are assigned to (matches calendar crew view).
		if (auth.currentUser?.role === 'crew') {
			const crewName = getUserDisplayName(auth.currentUser);
			if (crewName) {
				result = result.filter((j) => isJobAssignedToCrew(j, crewName));
			}
		}

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

		// Quick presets (segmented controls - combine with manual date range in More Filters)
		const now = new Date();
		const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
		if (quickTimeFilter === 'upcoming') {
			result = result.filter((j) => new Date(j.start) >= now);
		} else if (quickTimeFilter === 'past') {
			result = result.filter((j) => new Date(j.start) < now);
		}

		if (quickDateWindow === 'this-month') {
			result = result.filter((j) => new Date(j.start) >= startOfMonth);
		} else if (quickDateWindow === 'this-week') {
			// This Week = current week starting Sunday (common convention; easy to adjust)
			const startOfWeek = new Date(now);
			startOfWeek.setDate(now.getDate() - now.getDay());
			startOfWeek.setHours(0, 0, 0, 0);
			result = result.filter((j) => new Date(j.start) >= startOfWeek);
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

		// Cancelled (Show/Hide toggle - combines with other filters)
		if (!showCancelled) {
			result = result.filter((j) => j.status !== 'cancelled');
		}

		// Area chips
		// )=- Guard for legacy jobs that may lack areaOfTown (null/undefined/missing from import).
		if (selectedAreas.length > 0) {
			result = result.filter((j) => selectedAreas.includes(j.areaOfTown || ''));
		}

		// Crew multi-select facet (admin only in UI; filter still safe if state set)
		if (selectedCrew.length > 0) {
			result = result.filter((j) =>
				(j.assignedCrew || []).some((c) => selectedCrew.includes((c || '').trim()))
			);
		}

		// Overdue invoices quick preset (JOBS_AND_INVOICES_SPEC.md)
		if (showOverdueOnly) {
			result = result.filter((j) => j.id && invoiceStatus[j.id]?.isOverdue);
		}

		// Amount range
		// )=- Non-null guards + ! casts to satisfy TS (pre-existing pnpm noise on minAmount/maxAmount state was number|null). UI sets/clears them; filter only applies when present.
		if (minAmount != null)
			result = result.filter((j) => (j.totalAmount || 0) >= (minAmount as number));
		if (maxAmount != null)
			result = result.filter((j) => (j.totalAmount || 0) <= (maxAmount as number));

		// Invoice presence (segmented control inside Financial group, combines with presets)
		if (invoiceFilter === 'has') {
			result = result.filter((j) => {
				const has = j.id ? invoiceMap[j.id] : false;
				return has;
			});
		} else if (invoiceFilter === 'none') {
			result = result.filter((j) => {
				const has = j.id ? invoiceMap[j.id] : false;
				return !has;
			});
		}

		// Sort most recent first
		result.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());

		return result;
	});

	const paginatedJobs = $derived(filteredAndSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	const totalPages = $derived(Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE)));

	// Quick segmented control setters (mutually exclusive within each segment)
	function setTimeFilter(value: typeof quickTimeFilter) {
		quickTimeFilter = value;
		page = 1;
	}

	function setDateWindow(value: typeof quickDateWindow) {
		quickDateWindow = value;
		page = 1;
	}

	function setInvoiceFilter(value: typeof invoiceFilter) {
		invoiceFilter = value;
		page = 1;
	}

	function toggleShowCancelled() {
		showCancelled = !showCancelled;
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

	function toggleCrew(crewName: string) {
		if (selectedCrew.includes(crewName)) {
			selectedCrew = selectedCrew.filter((c) => c !== crewName);
		} else {
			selectedCrew = [...selectedCrew, crewName];
		}
		page = 1;
	}

	function toggleOverdueOnly() {
		showOverdueOnly = !showOverdueOnly;
		page = 1;
	}

	function resetFilters() {
		searchTerm = '';
		quickTimeFilter = 'all';
		quickDateWindow = 'all';
		showCancelled = false;
		showOverdueOnly = false;
		dateFrom = '';
		dateTo = '';
		selectedAreas = [];
		selectedCrew = [];
		minAmount = null;
		maxAmount = null;
		invoiceFilter = 'all';
		moreFiltersOpen = false; // close on full reset for cleanliness
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

	// )=- Crew facet names: active users + any names already on jobs (legacy imports).
	const crewFacetOptions = $derived.by(() => {
		const names = new Set<string>();
		for (const u of users) {
			if (u.active !== false) {
				const n = u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim();
				if (n) names.add(n);
			}
		}
		for (const j of jobs) {
			for (const c of j.assignedCrew || []) {
				const t = (c || '').trim();
				if (t) names.add(t);
			}
		}
		return [...names].sort((a, b) => a.localeCompare(b));
	});

	const isAdmin = $derived(auth.currentUser?.role === 'admin');
</script>

<div class="job-page">
	<header class="job-page__header">
		<div>
			<h1 class="job-page__title">{isAdmin ? 'All Jobs' : 'My Jobs'}</h1>
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

	<!-- Primary filters: search (primary) on its own line, then quick row with new toggles + reset.
	     Per clarification: search own line; quicks (All + 3 toggles) + reset can wrap to second line on small screens.
	     Toggles are pill-style, highlight when selected, show text for the *next* option.
	     "All" clears the three toggles. Reset does full reset of everything. -->
	<div class="job-page__filters">
		<input
			type="text"
			class="job-page__search"
			placeholder="Search title, notes, crew, client, billables, area..."
			bind:value={searchTerm}
		/>

		<div class="job-page__quick-row">
			<!-- Segmented controls -->
			<div class="job-page__segmented">
				<button class:active={quickTimeFilter === 'all'} onclick={() => setTimeFilter('all')}>All</button>
				<button class:active={quickTimeFilter === 'upcoming'} onclick={() => setTimeFilter('upcoming')}>Upcoming</button>
				<button class:active={quickTimeFilter === 'past'} onclick={() => setTimeFilter('past')}>Past</button>
			</div>

			<div class="job-page__segmented">
				<button class:active={quickDateWindow === 'all'} onclick={() => setDateWindow('all')}>All</button>
				<button class:active={quickDateWindow === 'this-month'} onclick={() => setDateWindow('this-month')}>This Month</button>
				<button class:active={quickDateWindow === 'this-week'} onclick={() => setDateWindow('this-week')}>This Week</button>
			</div>

			<!-- Show/Hide Cancel toggle (replaces checkbox). Red outline when showing cancelled. -->
			<button
				class="job-page__quick-pill job-page__quick-pill--cancel"
				class:active={showCancelled}
				onclick={toggleShowCancelled}
			>
				{showCancelled ? 'Hide cancelled' : 'Show cancelled'}
			</button>

			<button
				class="job-page__quick-pill job-page__quick-pill--overdue"
				class:active={showOverdueOnly}
				onclick={toggleOverdueOnly}
			>
				{showOverdueOnly ? 'Overdue only' : 'Overdue'}
			</button>

			<button class="job-page__btn" onclick={resetFilters}>Reset</button>

			<!-- "More Filters" trigger - can sit next to reset or wrap to own line on small screens -->
			<button
				class="job-page__more-filters-trigger"
				class:open={moreFiltersOpen}
				onclick={() => (moreFiltersOpen = !moreFiltersOpen)}
				aria-expanded={moreFiltersOpen}
			>
				More Filters {moreFiltersOpen ? '▾' : '▸'}
			</button>
		</div>

		<!-- More Filters collapsible (default closed, remembers state).
		     Labels on same line as the filters. Invoice segment on same line as Min/Max. -->
		{#if moreFiltersOpen}
			<div class="job-page__more-filters">
				<!-- Area filters (tokens/chips - behavior unchanged). Label + chips on same line. -->
				<div class="job-page__filter-group job-page__filter-group--inline">
					<div class="job-page__filter-group-label">Areas</div>
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
				</div>

				{#if isAdmin}
					<div class="job-page__filter-group job-page__filter-group--inline">
						<div class="job-page__filter-group-label">Crew</div>
						<div class="job-page__facet">
							{#each crewFacetOptions as crewName (crewName)}
								<button
									class="crew-chip"
									class:active={selectedCrew.includes(crewName)}
									onclick={() => toggleCrew(crewName)}
								>
									{crewName}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Date filters. Label + inputs on same line. -->
				<div class="job-page__filter-group job-page__filter-group--inline">
					<div class="job-page__filter-group-label">Date range</div>
					<div class="job-page__date-range">
						<input type="date" bind:value={dateFrom} title="From date" oninput={() => (page = 1)} />
						<input type="date" bind:value={dateTo} title="To date" oninput={() => (page = 1)} />
					</div>
				</div>

				<!-- Financial: label + (Min/Max + invoice segmented) on same line. -->
				<div class="job-page__filter-group job-page__filter-group--inline">
					<div class="job-page__filter-group-label">Financial</div>
					<div class="job-page__financial-inline">
						<div class="job-page__amount">
							<input type="number" placeholder="Min $" bind:value={minAmount} oninput={() => (page = 1)} />
							<input type="number" placeholder="Max $" bind:value={maxAmount} oninput={() => (page = 1)} />
						</div>
						<!-- Invoice segmented control (All, Has, Not Invoiced) -->
						<div class="job-page__segmented job-page__segmented--invoice">
							<button class:active={invoiceFilter === 'all'} onclick={() => setInvoiceFilter('all')}>All</button>
							<button class:active={invoiceFilter === 'has'} onclick={() => setInvoiceFilter('has')}>Invoice</button>
							<button class:active={invoiceFilter === 'none'} onclick={() => setInvoiceFilter('none')}>Not Invoiced</button>
						</div>
					</div>
				</div>
			</div>
		{/if}
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
							<span class="job-page__crew-names">{(job.assignedCrew || []).join(', ')}</span>
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
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	/* Search is the primary filter - on its own line */
	.job-page__search {
		width: 100%;
		padding: var(--space-3) var(--space-4); /* match global .input sizing from other pages/modals */
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--font-size-base);
	}

	/* Quick row: All + toggles + Reset + More Filters trigger.
	   Pills for the controls (use global primitives + local tweaks for mobile touch).
	   Can wrap on small screens. */
	.job-page__quick-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	/* Pill style quick controls (All + the three toggles). Use global button tokens where possible. */
	.job-page__quick-pill {
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		border-radius: var(--radius-full); /* pill */
		font-size: var(--font-size-xs);
		cursor: pointer;
		color: var(--color-text);
		min-height: 36px; /* good touch target */
		white-space: nowrap;
	}
	.job-page__quick-pill.active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	/* Special red outline for the cancel (Show/Hide) toggle - inspired by cancel buttons in modals (e.g. invoice/job forms).
	   Only when active (showing cancelled). */
	.job-page__quick-pill--cancel.active {
		border-color: var(--color-danger);
		color: var(--color-danger-emphasis);
		background: var(--color-danger-soft);
	}

	.job-page__quick-pill--overdue.active {
		border-color: var(--color-warning);
		color: var(--color-warning-emphasis, #b45309);
		background: var(--color-warning-soft, rgba(245, 158, 11, 0.15));
	}

	/* The More Filters trigger (text + indicator). Placed at end of quick row (or wraps). */
	.job-page__more-filters-trigger {
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		background: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 36px;
	}
	.job-page__more-filters-trigger.open {
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	/* The expanded More Filters content. */
	.job-page__more-filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}

	/* Labels on same line as the filters (inline groups). */
	.job-page__filter-group--inline {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.job-page__filter-group-label {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		flex-shrink: 0;
	}

	/* Financial inline: Min/Max + invoice segmented on same line. */
	.job-page__financial-inline {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	/* Segmented controls (pill groups for All/Option1/Option2 style).
	   Used for the quick row segments and the invoice one inside Financial. */
	.job-page__segmented {
		display: inline-flex;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		overflow: hidden;
		background: var(--color-surface);
	}
	.job-page__segmented button {
		padding: var(--space-1) var(--space-2);
		border: none;
		background: transparent;
		font-size: var(--font-size-xs);
		cursor: pointer;
		color: var(--color-text);
		min-height: 32px;
		white-space: nowrap;
		border-right: 1px solid var(--color-border-strong);
	}
	.job-page__segmented button:last-child {
		border-right: none;
	}
	.job-page__segmented button.active {
		background: var(--color-primary);
		color: white;
	}
	/* Slightly tighter for the one inside financial row */
	.job-page__segmented--invoice button {
		padding: 2px 8px;
		min-height: 28px;
		font-size: 11px;
	}

	/* Reuse/adapt existing date and amount for the groups */
	.job-page__date-range {
		display: flex;
		gap: var(--space-1);
	}
	.job-page__date-range input {
		padding: var(--space-2) var(--space-3); /* match global .input sizing */
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		background: var(--color-surface);
		color: var(--color-text);
		min-width: 140px;
	}

	.job-page__amount {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}
	.job-page__amount input {
		width: 90px;
		padding: var(--space-2) var(--space-3); /* match global .input sizing from other pages/modals */
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		background: var(--color-surface);
		color: var(--color-text);
	}

	/* Reuse area chips (unchanged behavior) */
	.area-chip {
		padding: var(--space-1) var(--space-2);
		margin-right: var(--space-1); /* a bit of breathing room between area tokens */
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

	.crew-chip {
		padding: var(--space-1) var(--space-2);
		margin-right: var(--space-1);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		font-size: var(--font-size-xs);
		cursor: pointer;
		background: var(--color-surface);
		color: var(--color-text);
	}

	.crew-chip.active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	/* Invoice toggle inside financial group - pill like the primary quick toggles */
	.job-page__quick-pill--invoice.active {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	/* Legacy support for global .job-page__btn (Reset, Sync etc) */
	.job-page__btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		min-height: 36px; /* touch */
	}
	.job-page__btn--primary {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
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
		flex-wrap: wrap;
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

	/* Mobile: search on own line (primary). Quick row (pills + reset + more-filters trigger) wraps as needed.
	   Touch targets respected (min 36-44px). More Filters content stacks cleanly. */
	@media (max-width: 768px) {
		.job-page {
			padding: var(--space-3) var(--space-2);
			width: 100%;
			box-sizing: border-box;
			flex: 1;
		}
		.job-page__search {
			padding: var(--space-2) var(--space-3); /* slightly tighter on mobile but still consistent */
			font-size: var(--font-size-sm);
		}
		.job-page__quick-row {
			gap: var(--space-1);
		}
		.job-page__segmented button,
		.job-page__quick-pill,
		.job-page__btn,
		.job-page__more-filters-trigger {
			font-size: 11px;
			padding: 4px 8px;
			min-height: 36px;
		}
		.job-page__filter-group--inline {
			flex-direction: column;
			align-items: flex-start;
		}
		.job-page__financial-inline {
			flex-direction: column;
			align-items: flex-start;
		}
		.job-page__date-range input,
		.job-page__amount input {
			padding: var(--space-1) var(--space-2);
			font-size: 12px;
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
		.job-page__meta {
			gap: var(--space-2);
		}
		.job-page__more-filters {
			gap: var(--space-2);
		}
		.job-page__filter-group-label {
			font-size: 10px;
		}
	}
</style>
