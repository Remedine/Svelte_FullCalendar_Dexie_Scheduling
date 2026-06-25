<!-- src/routes/(app)/clients/+page.svelte -->
<script lang="ts">
	import {
		db,
		type Client,
		type Invoice,
		getPaginatedJobsForClient,
		type Job,
		getInvoiceForJob,
		isInvoiceOverdue,
		dedupJobs
	} from '$lib/db';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import ClientForm from '$lib/components/ClientForm.svelte';
	import { deleteClient as deleteClientFromDb } from '$lib/db';
	import { openJobDetailsModal } from '$lib/components/JobDetailsModal.svelte';
	import {
		pullJobsFromServer,
		pullClientsFromServer,
		pullInvoicesFromServer
	} from '$lib/db/pb';

	let showForm = $state(false);
	let editingClient = $state<Client | null>(null);

	let searchTerm = $state('');
	let sortMode = $state<'alpha' | 'recent' | 'upcoming'>('alpha');
	let selectedAreas = $state<string[]>([]);
	let jobsFilter = $state<'all' | 'upcoming'>('all');
	let unresolvedInvoiceOnly = $state(false);
	let activeLetter = $state<string | null>(null);

	type ClientInvoiceBadge = {
		label: string;
		status: Invoice['status'] | 'overdue';
		isOverdue: boolean;
	};

	type EnhancedClient = Client & {
		lastJobDate: Date | null;
		totalJobs: number;
		nextJobDate: Date | null;
		hasUnresolvedInvoice: boolean;
		invoiceBadge: ClientInvoiceBadge | null;
	};

	const ALPHABET_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

	let enhancedClients = $state<EnhancedClient[]>([]);

	function getNameBucket(name: string | undefined): string {
		const first = (name || '').trim().charAt(0).toUpperCase();
		if (!first) return '#';
		if (first >= 'A' && first <= 'Z') return first;
		return '#';
	}

	function findInvoiceForJob(job: Job, invoiceByJobId: Map<string, Invoice>): Invoice | undefined {
		if (job.id) {
			const byId = invoiceByJobId.get(job.id);
			if (byId) return byId;
		}
		if (job.pbId) {
			const byPb = invoiceByJobId.get(job.pbId);
			if (byPb) return byPb;
		}
		return undefined;
	}

	function isUnresolvedInvoice(invoice: Invoice): boolean {
		if (invoice.status === 'paid') return false;
		return true;
	}

	const INVOICE_STATUS_PRIORITY: Record<Invoice['status'], number> = {
		draft: 1,
		generated: 2,
		sent: 3,
		paid: 0
	};

	function getClientInvoiceBadge(
		clientJobs: Job[],
		invoiceByJobId: Map<string, Invoice>
	): ClientInvoiceBadge | null {
		let hasOverdue = false;
		let worstStatus: Invoice['status'] | null = null;

		for (const job of clientJobs) {
			const invoice = findInvoiceForJob(job, invoiceByJobId);
			if (!invoice || invoice.status === 'paid') continue;
			if (isInvoiceOverdue(invoice)) hasOverdue = true;
			if (
				!worstStatus ||
				INVOICE_STATUS_PRIORITY[invoice.status] > INVOICE_STATUS_PRIORITY[worstStatus]
			) {
				worstStatus = invoice.status;
			}
		}

		if (!worstStatus && !hasOverdue) return null;
		if (hasOverdue) {
			return { label: 'Overdue', status: 'overdue', isOverdue: true };
		}
		return {
			label: worstStatus!,
			status: worstStatus!,
			isOverdue: false
		};
	}

	// Dynamic areas from options store (already reactive)
	const areaOptions = $derived.by(() => {
		return optionsStore.data?.areasOfTown ?? [];
	});

	$effect(() => {
		console.log('🟢 areaOptions updated →', areaOptions.length, 'areas loaded');
	});

	const displayedClients = $derived.by(() => {
		let result = [...enhancedClients];

		const term = searchTerm.toLowerCase().trim();
		if (term) {
			result = result.filter(
				(c) =>
					c.name?.toLowerCase().includes(term) ||
					c.email?.toLowerCase().includes(term) ||
					c.serviceAddressCity?.toLowerCase().includes(term)
			);
		}

		if (selectedAreas.length > 0) {
			result = result.filter((c) => selectedAreas.includes(c.areaOfTown));
		}

		if (jobsFilter === 'upcoming') {
			result = result.filter((c) => c.nextJobDate != null);
		}

		if (unresolvedInvoiceOnly) {
			result = result.filter((c) => c.hasUnresolvedInvoice);
		}

		if (sortMode === 'recent') {
			result.sort(
				(a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
			);
		} else if (sortMode === 'upcoming') {
			// )=- Sort by soonest next job (nulls last), fallback to name
			result.sort((a, b) => {
				if (a.nextJobDate && b.nextJobDate)
					return a.nextJobDate.getTime() - b.nextJobDate.getTime();
				if (a.nextJobDate) return -1;
				if (b.nextJobDate) return 1;
				return a.name.localeCompare(b.name);
			});
		} else {
			result.sort((a, b) => a.name.localeCompare(b.name));
		}

		return result;
	});

	const showAlphabetRail = $derived(sortMode === 'alpha' && displayedClients.length > 0);

	const alphabetRail = $derived.by(() => {
		const present = new Set<string>();
		for (const client of displayedClients) {
			present.add(getNameBucket(client.name));
		}
		return ALPHABET_LETTERS.map((letter) => ({
			letter,
			hasClients: present.has(letter)
		}));
	});

	$effect(() => {
		if (!showAlphabetRail) {
			activeLetter = null;
			return;
		}

		void displayedClients.map((c) => c.id).join(',');

		let observer: IntersectionObserver | null = null;
		const timer = window.setTimeout(() => {
			const headers = document.querySelectorAll('[data-client-letter-anchor]');
			if (!headers.length) return;

			observer = new IntersectionObserver(
				(entries) => {
					const visible = entries
						.filter((e) => e.isIntersecting)
						.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
					const letter = (visible[0]?.target as HTMLElement | undefined)?.dataset.letter;
					if (letter) activeLetter = letter;
				},
				{ root: null, rootMargin: '-8% 0px -75% 0px', threshold: 0 }
			);

			headers.forEach((header) => observer!.observe(header));
		}, 0);

		return () => {
			window.clearTimeout(timer);
			observer?.disconnect();
		};
	});

	function jumpToLetter(letter: string) {
		const entry = alphabetRail.find((item) => item.letter === letter);
		if (!entry?.hasClients) return;

		const client = displayedClients.find((c) => getNameBucket(c.name) === letter);
		if (!client?.id) return;

		const header = document.getElementById(`client-header-${client.id}`);
		header?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		activeLetter = letter;
	}

	// )=- Replaced onMount with Svelte 5 $effect + flag (per agents.md rules)
	// )=- Added defensive auth/role check for consistency across all protected pages.
	let initialized = $state(false);

	$effect(() => {
		if (!auth.loading && (!auth.isAuthenticated || !auth.currentUser)) {
			goto('/login', { replaceState: true });
		}
	});

	$effect(() => {
		if (!initialized) {
			initialized = true;
			initPage();
		}
	});

	async function initPage() {
		console.log('🚀 Clients page mounting...');
		await optionsStore.load();
		if (navigator.onLine) {
			optionsStore.pullFromPB();
			await pullClientsFromServer();
			await pullJobsFromServer();
			await pullInvoicesFromServer();
		}
		await loadClientsWithLastJob();
	}

	async function loadClientsWithLastJob() {
		const [allClients, allJobs, allInvoices] = await Promise.all([
			db.clients.orderBy('name').toArray(),
			db.jobs.orderBy('start').reverse().toArray(),
			db.invoices.toArray()
		]);

		const invoiceByJobId = new Map<string, Invoice>();
		for (const invoice of allInvoices) {
			if (invoice.jobId) invoiceByJobId.set(invoice.jobId, invoice);
		}

		enhancedClients = allClients.map((client) => {
			// )=- Match jobs by local id OR pbId (handles post-sync state correctly)
			// Then dedup using shared helper to avoid 2x counts when Dexie has (local-uuid + pbId) duplicates for same logical job.
			// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
			const rawClientJobs = allJobs.filter(
				(j) => j.clientId === client.id || (client.pbId && j.clientId === client.pbId)
			);
			const clientJobs = dedupJobs(rawClientJobs);
			const lastJob = clientJobs[0] || null;

			// )=- Compute next upcoming job for 'upcoming' sort and display (future jobs only, soonest first)
			const futureJobs = clientJobs
				.filter((j) => new Date(j.start) > new Date())
				.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
			const nextJob = futureJobs[0] || null;

			const hasUnresolvedInvoice = clientJobs.some((job) => {
				const invoice = findInvoiceForJob(job, invoiceByJobId);
				return invoice ? isUnresolvedInvoice(invoice) : false;
			});
			const invoiceBadge = getClientInvoiceBadge(clientJobs, invoiceByJobId);

			return {
				...client,
				lastJobDate: lastJob ? new Date(lastJob.start) : null,
				totalJobs: clientJobs.length,
				nextJobDate: nextJob ? new Date(nextJob.start) : null,
				hasUnresolvedInvoice,
				invoiceBadge
			};
		});
	}

	function getFullAddress(client: Client): string {
		const parts = [
			client.serviceAddressStreet,
			client.serviceAddressCity,
			client.serviceAddressState,
			client.serviceAddressZip
		].filter(Boolean);
		return parts.join(', ');
	}

	function openInMaps(client: Client) {
		const address = encodeURIComponent(getFullAddress(client));
		window.open(`https://www.google.com/maps/search/?api=1&query=${address}`, '_blank');
	}

	function openNewClient() {
		editingClient = null;
		showForm = true;
	}

	function editClient(client: Client) {
		editingClient = { ...client };
		showForm = true;
	}

	async function handleClientSaved() {
		showForm = false;
		editingClient = null;
		await loadClientsWithLastJob();
	}

	async function deleteClient(id: string) {
		// )=- Prevent deletion if client has any jobs (protects data integrity)
		// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
		const clientWithJobs = enhancedClients.find((c) => c.id === id);
		if (clientWithJobs && (clientWithJobs.totalJobs ?? 0) > 0) {
			alert(
				'Cannot delete this client because they have existing job records.\n\nPlease cancel or delete the associated jobs first.'
			);
			return;
		}

		if (!confirm('Delete this client? This action cannot be undone.')) return;

		await deleteClientFromDb(id);
		await loadClientsWithLastJob();
	}

	function toggleArea(areaKey: string) {
		if (selectedAreas.includes(areaKey)) {
			selectedAreas = selectedAreas.filter((a) => a !== areaKey);
		} else {
			selectedAreas = [...selectedAreas, areaKey];
		}
	}

	function getAreaColor(areaId: string | undefined): string {
		if (!areaId) return 'var(--color-text-muted)'; // fallback token (will be used in style)
		const original = areaOptions.find((a: any) => a.id === areaId)?.color;
		return getDisplayAreaColor(original);
	}

	function getAreaLabel(areaId: string | undefined): string {
		if (!areaId) return 'Unknown Area';
		return areaOptions.find((a: any) => a.id === areaId)?.label || areaId;
	}

	// )=- Phase 6 related jobs state (per-client expanded data with pagination).
	// Uses our getPaginatedJobsForClient helper (limit 10).
	// Local enrichment type to carry invoice badges without polluting the base Job interface.
	// )=- Extended for Phase 7 overdue visuals on related jobs rows (red tint on badge or row when overdue).
	type EnrichedJob = Job & { _hasInvoice?: boolean; _invoiceStatus?: string; _isOverdue?: boolean };
	let expandedClients = $state<
		Record<string, { jobs: EnrichedJob[]; offset: number; loading: boolean }>
	>({});

	async function toggleRelatedJobs(client: any) {
		const id = client.id!;
		if (expandedClients[id]) {
			// collapse
			delete expandedClients[id];
			expandedClients = { ...expandedClients };
			return;
		}

		expandedClients[id] = { jobs: [], offset: 0, loading: true };
		expandedClients = { ...expandedClients };

		try {
			const loaded = await getPaginatedJobsForClient(id, {
				limit: 10,
				offset: 0,
				includeCancelled: true
			});
			// )=- Enrich each with invoice status + overdue for the badge in the related list (Phase 6 + Phase 7 overdue visuals).
			// Uses the shared isInvoiceOverdue + EnrichedJob local type. Overdue = not paid + past dueDate.
			// )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 (overdue visual treatment everywhere)
			const enriched: EnrichedJob[] = [];
			for (const j of loaded) {
				const inv = j.id ? await getInvoiceForJob(j.id) : null;
				enriched.push({
					...j,
					_hasInvoice: !!inv,
					_invoiceStatus: inv?.status,
					_isOverdue: isInvoiceOverdue(inv)
				});
			}
			expandedClients[id] = { jobs: enriched, offset: 10, loading: false };
			expandedClients = { ...expandedClients };
		} catch (e) {
			console.error('Failed to load related jobs', e);
			expandedClients[id] = { jobs: [], offset: 0, loading: false };
			expandedClients = { ...expandedClients };
		}
	}

	async function loadMoreRelated(clientId: string) {
		const current = expandedClients[clientId];
		if (!current) return;

		current.loading = true;
		expandedClients = { ...expandedClients };

		try {
			const moreRaw = await getPaginatedJobsForClient(clientId, {
				limit: 10,
				offset: current.offset,
				includeCancelled: true
			});
			// )=- Enrich the additional page too so invoice + overdue badges appear on "Load more".
			// Uses isInvoiceOverdue for consistent Phase 7 visuals.
			const moreEnriched: EnrichedJob[] = [];
			for (const j of moreRaw) {
				const inv = j.id ? await getInvoiceForJob(j.id) : null;
				moreEnriched.push({
					...j,
					_hasInvoice: !!inv,
					_invoiceStatus: inv?.status,
					_isOverdue: isInvoiceOverdue(inv)
				});
			}
			current.jobs = [...current.jobs, ...moreEnriched];
			current.offset += 10;
			current.loading = false;
			expandedClients = { ...expandedClients };
		} catch (e) {
			console.error('Failed to load more related jobs', e);
			current.loading = false;
			expandedClients = { ...expandedClients };
		}
	}

	function openJobFromClient(job: Job, client: any) {
		openJobDetailsModal(job, { fromClientId: client.id, fromClientName: client.name });
	}
</script>

<div class="clients-page">
	<header class="clients-page__header">
		<h1 class="clients-page__title">Client CRM</h1>
		<button onclick={openNewClient} class="clients-page__btn-add"> + New Client </button>
	</header>

	<div class="clients-page__filters">
		<input
			type="text"
			placeholder="Search by name, email, city, or phone..."
			bind:value={searchTerm}
			class="clients-page__search"
		/>

		<select bind:value={sortMode} class="clients-page__select">
			<option value="alpha">Alphabetical</option>
			<option value="recent">Most Recent Added</option>
			<option value="upcoming">Upcoming Jobs</option>
		</select>
	</div>

	<div class="area-filter">
		<div class="area-filter__chips">
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

	<div class="clients-page__facets">
		<div class="clients-page__facet-group" role="group" aria-label="Filter by jobs">
			<span class="clients-page__facet-label">Jobs</span>
			<button
				type="button"
				class="clients-page__facet-btn"
				class:clients-page__facet-btn--active={jobsFilter === 'all'}
				onclick={() => (jobsFilter = 'all')}
			>
				All
			</button>
			<button
				type="button"
				class="clients-page__facet-btn"
				class:clients-page__facet-btn--active={jobsFilter === 'upcoming'}
				onclick={() => (jobsFilter = 'upcoming')}
			>
				Has upcoming jobs
			</button>
		</div>

		<div class="clients-page__facet-group" role="group" aria-label="Filter by invoice status">
			<button
				type="button"
				class="clients-page__facet-btn clients-page__facet-btn--alert"
				class:clients-page__facet-btn--active={unresolvedInvoiceOnly}
				onclick={() => (unresolvedInvoiceOnly = !unresolvedInvoiceOnly)}
			>
				Unresolved invoices
			</button>
		</div>
	</div>

	<div class="clients-page__browse">
		{#if showAlphabetRail}
			<nav class="clients-page__alphabet" aria-label="Jump to clients by letter">
				{#each alphabetRail as item (item.letter)}
					<button
						type="button"
						class="clients-page__alphabet-letter"
						class:clients-page__alphabet-letter--active={activeLetter === item.letter}
						class:clients-page__alphabet-letter--empty={!item.hasClients}
						disabled={!item.hasClients}
						aria-label={item.hasClients
							? `Jump to clients starting with ${item.letter}`
							: `No clients starting with ${item.letter}`}
						onclick={() => jumpToLetter(item.letter)}
					>
						{item.letter}
					</button>
				{/each}
			</nav>
		{/if}

		<ul class="clients-page__list">
		{#each displayedClients as client (client.id)}
			<li class="client-card card" style="border-left: 6px solid {getAreaColor(client.areaOfTown)};">
				<div class="client-card__main">
					<div
						class="client-card__header"
						id="client-header-{client.id}"
						data-client-letter-anchor
						data-letter={getNameBucket(client.name)}
					>
						<h3 class="client-card__name">{client.name}</h3>
						<div class="client-card__badges">
							{#if client.invoiceBadge}
								<span
									class="client-card__invoice-badge"
									class:client-card__invoice-badge--overdue={client.invoiceBadge.isOverdue}
									class:client-card__invoice-badge--sent={client.invoiceBadge.status === 'sent'}
									class:client-card__invoice-badge--generated={client.invoiceBadge.status ===
										'generated'}
									class:client-card__invoice-badge--draft={client.invoiceBadge.status === 'draft'}
								>
									📄 {client.invoiceBadge.label}
								</span>
							{/if}
							<span
								class="area-badge"
								style="background-color: {getAreaColor(client.areaOfTown)}20; color: {getAreaColor(
									client.areaOfTown
								)};"
							>
								{getAreaLabel(client.areaOfTown)}
							</span>
						</div>
					</div>

					<div class="client-card__contact">
						{#if client.phone}
							<a href="tel:{client.phone}" class="contact-link">📞 {client.phone}</a>
						{/if}
						{#if client.email}
							<a href="mailto:{client.email}" class="contact-link">✉️ {client.email}</a>
						{/if}
					</div>

					{#if getFullAddress(client)}
						<div
							class="client-card__address"
							role="button"
							tabindex="0"
							onclick={() => openInMaps(client)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									openInMaps(client);
								}
							}}
						>
							📍 {getFullAddress(client)}
						</div>
					{/if}

					<div class="client-card__meta">
						{#if client.lastJobDate}
							Last: <strong
								>{client.lastJobDate.toLocaleDateString('en-US', {
									month: 'short',
									day: 'numeric',
									year: 'numeric'
								})}</strong
							>
						{:else}
							<span class="no-jobs">No jobs yet</span>
						{/if}
						{#if client.nextJobDate}
							<span>
								• Next: <strong
									>{client.nextJobDate.toLocaleDateString('en-US', {
										month: 'short',
										day: 'numeric'
									})}</strong
								></span
							>
						{/if}
						{#if client.totalJobs > 0}
							<span> • {client.totalJobs} job{client.totalJobs > 1 ? 's' : ''}</span>
						{/if}
					</div>

					<!-- )=- Phase 6: Expandable related jobs (paginated 10 + load more) inside client card.
					     Uses getPaginatedJobsForClient + opens the shared JobDetailsModal with client context.
					     Per spec: "The job list can be expandable on click inside the client card. Then the modal shared with the jobs page... Paginated jobs for now."
					     Reference: JOBS_AND_INVOICES_SPEC.md -->
					<div class="client-card__related">
						<button class="client-card__related-toggle" onclick={() => toggleRelatedJobs(client)}>
							{expandedClients[client.id!] ? '▼' : '▶'} Related Jobs ({client.totalJobs || 0})
						</button>

						{#if expandedClients[client.id!]}
							<div class="client-card__related-list">
								{#each expandedClients[client.id!].jobs as job (job.id)}
									<div
										class="client-card__related-job"
										role="button"
										tabindex="0"
										onclick={() => openJobFromClient(job, client)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												openJobFromClient(job, client);
											}
										}}
									>
										<span class="date">{new Date(job.start).toLocaleDateString()}</span>
										<span class="title">{job.title}</span>
										<div class="client-card__related-meta">
											<span class="status status--{job.status}">{job.status}</span>
											{#if job._hasInvoice}
												<span class="invoice-badge" class:overdue={job._isOverdue}>
													📄 {job._invoiceStatus || 'invoice'}
													{#if job._isOverdue}
														<span class="overdue-pill">OVERDUE</span>
													{/if}
												</span>
											{/if}
											<span class="amount">${(job.totalAmount || 0).toFixed(2)}</span>
										</div>
									</div>
								{:else}
									<div class="client-card__related-empty">
										No related jobs found for this client.
									</div>
								{/each}

								{#if expandedClients[client.id!].jobs.length > 0}
									<button
										class="client-card__related-more"
										onclick={() => loadMoreRelated(client.id!)}
										disabled={expandedClients[client.id!].loading}
									>
										{expandedClients[client.id!].loading ? 'Loading…' : 'Load more'}
									</button>
								{/if}
							</div>
						{/if}
					</div>
				</div>

				<div class="client-card__actions">
					<button
						onclick={() => editClient(client)}
						class="client-card__btn client-card__btn--edit"
					>
						Edit
					</button>
					<button
						onclick={() => deleteClient(client.id!)}
						class="client-card__btn client-card__btn--delete"
						class:client-card__btn--disabled={(client.totalJobs ?? 0) > 0}
						disabled={(client.totalJobs ?? 0) > 0}
						title={(client.totalJobs ?? 0) > 0
							? 'Cannot delete: client has existing jobs'
							: 'Delete client'}
					>
						Delete
					</button>
				</div>
			</li>
		{/each}

		{#if displayedClients.length === 0}
			<li class="clients-page__empty">No clients match your filters.</li>
		{/if}
		</ul>
	</div>
</div>

{#if showForm}
	<ClientForm bind:show={showForm} bind:client={editingClient} onSaved={handleClientSaved} />
{/if}

<!-- Note: JobDetailsModal is globally mounted in (app)/+layout.svelte -->

<style>
	/* BEM naming maintained throughout */
	.clients-page {
		padding: var(--space-6) var(--space-4);
		max-width: 1200px;
		margin: 0 auto;
	}

	.clients-page__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-6);
	}

	.clients-page__title {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-bold);
		margin: 0;
		color: var(--color-text);
	}

	.clients-page__btn-add {
		background: var(--color-primary);
		color: white;
		border: none;
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-md);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
		transition: background var(--transition-fast);
	}
	.clients-page__btn-add:hover {
		background: var(--color-primary-hover);
	}

	.clients-page__filters {
		display: flex;
		gap: var(--space-4);
		margin-bottom: var(--space-6);
		flex-wrap: wrap;
	}

	.clients-page__search {
		flex: 1;
		min-width: 160px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.clients-page__select {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		min-width: 100px;
		background: var(--color-surface);
		color: var(--color-text);
	}

	.area-filter__chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-bottom: var(--space-6);
	}

	.area-chip {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-full);
		font-size: var(--font-size-sm);
		cursor: pointer;
		transition: all var(--transition-fast);
		border: 1px solid;
	}

	.area-chip.active {
		font-weight: var(--font-weight-semibold);
		box-shadow: 0 0 0 3px currentColor;
	}

	.clients-page__facets {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		align-items: center;
	}

	.clients-page__facet-group {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.clients-page__facet-label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		margin-right: var(--space-1);
	}

	.clients-page__facet-btn {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-full);
		font-size: var(--font-size-sm);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text-muted);
		cursor: pointer;
		transition:
			background var(--transition-fast),
			color var(--transition-fast),
			border-color var(--transition-fast);
	}

	.clients-page__facet-btn--active {
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
		border-color: var(--color-primary);
		font-weight: var(--font-weight-semibold);
	}

	.clients-page__facet-btn--alert.clients-page__facet-btn--active {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border-color: var(--color-danger);
	}

	.clients-page__browse {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		position: relative;
	}

	.clients-page__alphabet {
		position: sticky;
		top: var(--space-4);
		align-self: flex-start;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: var(--space-1) 0;
		max-height: calc(100vh - var(--space-8));
		overflow: hidden;
		z-index: 5;
		user-select: none;
		touch-action: manipulation;
	}

	.clients-page__alphabet-letter {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.35rem;
		height: 1.1rem;
		padding: 0;
		border: none;
		background: transparent;
		font-size: 0.62rem;
		font-weight: var(--font-weight-semibold);
		line-height: 1;
		color: var(--color-primary-emphasis);
		cursor: pointer;
		border-radius: var(--radius-sm);
	}

	.clients-page__alphabet-letter--active {
		color: white;
		background: var(--color-primary);
	}

	.clients-page__alphabet-letter--empty {
		color: var(--color-text-subtle);
		opacity: 0.45;
		cursor: default;
	}

	.clients-page__list {
		list-style: none;
		padding: 0;
		margin: 0;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.client-card {
		/* base from global .card; list-specific */
		display: flex;
		justify-content: space-between;
		padding: var(--space-5);
		transition: transform 0.2s;
	}

	.client-card:hover {
		transform: translateX(4px);
	}

	.client-card__main {
		flex: 1;
	}
	.client-card__header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: var(--space-2);
		margin-bottom: 0.75rem;
		scroll-margin-top: var(--space-4);
	}
	.client-card__name {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}
	.client-card__badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		justify-content: flex-end;
		flex-shrink: 0;
	}
	.client-card__invoice-badge {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-sm);
		font-weight: var(--font-weight-semibold);
		text-transform: capitalize;
		white-space: nowrap;
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}
	.client-card__invoice-badge--draft,
	.client-card__invoice-badge--generated {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}
	.client-card__invoice-badge--sent {
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
	}
	.client-card__invoice-badge--overdue {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
	}

	.client-card__contact {
		margin-bottom: var(--space-2);
		line-height: var(--line-height-normal);
	}
	.contact-link {
		color: var(--color-primary);
		text-decoration: none;
	}
	.contact-link:hover {
		text-decoration: underline;
	}

	.client-card__address {
		color: var(--color-primary);
		cursor: pointer;
		margin-bottom: var(--space-3);
		text-decoration: underline dotted;
	}
	.client-card__address:hover {
		color: var(--color-primary-emphasis);
		text-decoration: underline;
	}

	.client-card__meta {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.no-jobs {
		color: var(--color-warning);
	}

	.client-card__actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-left: var(--space-4);
	}

	.client-card__btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-sm);
		border: none;
		cursor: pointer;
		font-size: var(--font-size-sm);
		white-space: nowrap;
	}

	.client-card__btn--edit {
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}
	.client-card__btn--delete {
		background: var(--color-danger-soft);
		color: var(--color-danger);
	}

	.client-card__btn--disabled {
		background: var(--color-surface-alt) !important;
		color: var(--color-text-subtle) !important;
		cursor: not-allowed;
		opacity: 0.6;
	}

	.clients-page__empty {
		text-align: center;
		padding: var(--space-8) var(--space-4);
		color: var(--color-text-muted);
		background: var(--color-surface);
		border-radius: var(--radius-lg);
	}

	/* Phase 6: Expandable related jobs styles (BEM) */
	.client-card__related {
		margin-top: var(--space-3);
		border-top: 1px dashed var(--color-border);
		padding-top: var(--space-2);
	}

	.client-card__related-toggle {
		font-size: var(--font-size-xs);
		color: var(--color-primary);
		background: none;
		border: none;
		padding: var(--space-1) 0;
		cursor: pointer;
		text-align: left;
	}

	.client-card__related-list {
		margin-top: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.client-card__related-job {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: var(--space-2);
		align-items: center;
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.client-card__related-meta {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		justify-content: flex-end;
	}
	.client-card__related-job:hover {
		background: var(--color-surface);
	}

	.client-card__related-job .date {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}
	.client-card__related-job .title {
		font-weight: var(--font-weight-medium);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.client-card__related-job .status {
		font-size: var(--font-size-xs);
		padding: 0.1rem 0.35rem;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}
	.client-card__related-job .status--scheduled {
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
	}
	.client-card__related-job .status--confirmed {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	.client-card__related-job .status--completed {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	.client-card__related-job .status--cancelled {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
	}
	.client-card__related-job .amount {
		font-weight: var(--font-weight-semibold);
		text-align: right;
	}
	.client-card__related-job .invoice-badge {
		font-size: var(--font-size-xs);
		background: var(--color-success-soft);
		color: var(--color-success);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	/* )=- Overdue visual (Phase 7) on clients related jobs rows. Red background + small pill when overdue.
	   Mirrors the treatment added to /jobs cards and the modal for consistency (BEM + shared isInvoiceOverdue). */
	.client-card__related-job .invoice-badge.overdue {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
	}
	.client-card__related-job .overdue-pill {
		font-size: var(--font-size-xs);
		background: var(--color-danger-emphasis);
		color: white;
		padding: 0 0.15rem;
		border-radius: var(--radius-sm);
		text-transform: uppercase;
	}

	.client-card__related-empty {
		font-size: var(--font-size-xs);
		color: var(--color-text-subtle);
	}

	.client-card__related-more {
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		align-self: flex-start;
		margin-top: var(--space-1);
		background: var(--color-primary-soft);
		color: var(--color-primary);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	@media (max-width: 768px) {
		.clients-page__browse {
			display: flex;
			gap: var(--space-1);
		}

		.clients-page__alphabet {
			position: fixed;
			left: max(2px, env(safe-area-inset-left, 0px));
			top: 50%;
			transform: translateY(-50%);
			padding: var(--space-1) 0;
			background: color-mix(in srgb, var(--color-surface) 88%, transparent);
			border-radius: var(--radius-md);
			backdrop-filter: blur(4px);
		}

		.clients-page__alphabet-letter {
			width: 1.75rem;
			height: 1.35rem;
			font-size: 0.68rem;
		}

		.clients-page__list {
			padding-left: 1.85rem;
		}

		.clients-page__facets {
			flex-direction: column;
			align-items: stretch;
		}

		.clients-page__facet-group {
			width: 100%;
		}
	}

	/* Mobile fixes for horizontal scroll: reduce min-widths, allow header wrap, contain grids. */
	@media (max-width: 480px) {
		.clients-page {
			padding: var(--space-4) var(--space-3);
		}

		.clients-page__search {
			min-width: 120px;
		}

		.clients-page__select {
			min-width: 80px;
		}

		.clients-page__filters {
			gap: var(--space-2);
		}

		.clients-page__header {
			flex-wrap: wrap;
			gap: var(--space-2);
		}

		.clients-page__title {
			font-size: var(--font-size-2xl);
			flex-basis: 100%;
		}
	}
</style>
