<!-- src/routes/(app)/clients/+page.svelte -->
<script lang="ts">
	import { db, type Client, getPaginatedJobsForClient, type Job, getInvoiceForJob, isInvoiceOverdue } from '$lib/db';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import ClientForm from '$lib/components/ClientForm.svelte';
	import { deleteClient as deleteClientFromDb } from '$lib/db';
	import { openJobDetailsModal } from '$lib/components/JobDetailsModal.svelte';
	import { pullJobsFromServer, pullClientsFromServer, pullInvoicesFromServer, pb } from '$lib/db/pb';

	let showForm = $state(false);
	let editingClient = $state<Client | null>(null);

	let searchTerm = $state('');
	let sortMode = $state<'alpha' | 'recent' | 'upcoming'>('alpha');
	let selectedAreas = $state<string[]>([]);

	let enhancedClients = $state<any[]>([]);

	// Dynamic areas from options store (already reactive)
	let areaOptions = $derived.by(() => {
		return optionsStore.data?.areasOfTown ?? [];
	});

	$effect(() => {
		console.log('🟢 areaOptions updated →', areaOptions.length, 'areas loaded');
	});

	let displayedClients = $derived.by(() => {
		let result = [...enhancedClients];

		const term = searchTerm.toLowerCase().trim();
		if (term) {
			result = result.filter(c =>
				c.name?.toLowerCase().includes(term) ||
				c.email?.toLowerCase().includes(term) ||
				c.serviceAddressCity?.toLowerCase().includes(term)
			);
		}

		if (selectedAreas.length > 0) {
			result = result.filter(c => selectedAreas.includes(c.areaOfTown));
		}

		if (sortMode === 'recent') {
			result.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
		} else if (sortMode === 'upcoming') {
			// )=- Sort by soonest next job (nulls last), fallback to name
			result.sort((a, b) => {
				if (a.nextJobDate && b.nextJobDate) return a.nextJobDate.getTime() - b.nextJobDate.getTime();
				if (a.nextJobDate) return -1;
				if (b.nextJobDate) return 1;
				return a.name.localeCompare(b.name);
			});
		} else {
			result.sort((a, b) => a.name.localeCompare(b.name));
		}

		return result;
	});

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
		const allClients = await db.clients.orderBy('name').toArray();
		const allJobs = await db.jobs.orderBy('start').reverse().toArray();

		enhancedClients = allClients.map(client => {
			// )=- Match jobs by local id OR pbId (handles post-sync state correctly)
			// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
			const clientJobs = allJobs.filter(j => 
				j.clientId === client.id || 
				(client.pbId && j.clientId === client.pbId)
			);
			const lastJob = clientJobs[0] || null;

			// )=- Compute next upcoming job for 'upcoming' sort and display (future jobs only, soonest first)
			const futureJobs = clientJobs
				.filter(j => new Date(j.start) > new Date())
				.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
			const nextJob = futureJobs[0] || null;

			return {
				...client,
				lastJobDate: lastJob ? new Date(lastJob.start) : null,
				totalJobs: clientJobs.length,
				nextJobDate: nextJob ? new Date(nextJob.start) : null
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
		const clientWithJobs = enhancedClients.find(c => c.id === id);
		if (clientWithJobs && (clientWithJobs.totalJobs ?? 0) > 0) {
			alert('Cannot delete this client because they have existing job records.\n\nPlease cancel or delete the associated jobs first.');
			return;
		}

		if (!confirm('Delete this client? This action cannot be undone.')) return;

		await deleteClientFromDb(id);
		await loadClientsWithLastJob();
	}

	function toggleArea(areaKey: string) {
		if (selectedAreas.includes(areaKey)) {
			selectedAreas = selectedAreas.filter(a => a !== areaKey);
		} else {
			selectedAreas = [...selectedAreas, areaKey];
		}
	}

	function getAreaColor(areaId: string | undefined): string {
		if (!areaId) return '#64748b';
		return areaOptions.find((a: any) => a.id === areaId)?.color || '#64748b';
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
	let expandedClients = $state<Record<string, { jobs: EnrichedJob[]; offset: number; loading: boolean }>>({});

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
			const loaded = await getPaginatedJobsForClient(id, { limit: 10, offset: 0, includeCancelled: true });
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
			const moreRaw = await getPaginatedJobsForClient(clientId, { limit: 10, offset: current.offset, includeCancelled: true });
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
		<button onclick={openNewClient} class="clients-page__btn-add">
			+ New Client
		</button>
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

	<ul class="clients-page__list">
		{#each displayedClients as client (client.id)}
			<li class="client-card" style="border-left: 6px solid {getAreaColor(client.areaOfTown)};">
				<div class="client-card__main">
					<div class="client-card__header">
						<h3 class="client-card__name">{client.name}</h3>
						<span class="area-badge"
							style="background-color: {getAreaColor(client.areaOfTown)}20; color: {getAreaColor(client.areaOfTown)};">
							{getAreaLabel(client.areaOfTown)}
						</span>
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
						<div class="client-card__address" onclick={() => openInMaps(client)}>
							📍 {getFullAddress(client)}
						</div>
					{/if}

					<div class="client-card__meta">
						{#if client.lastJobDate}
							Last: <strong>{client.lastJobDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
						{:else}
							<span class="no-jobs">No jobs yet</span>
						{/if}
						{#if client.nextJobDate}
							<span> • Next: <strong>{client.nextJobDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong></span>
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
						<button 
							class="client-card__related-toggle"
							onclick={() => toggleRelatedJobs(client)}
						>
							{expandedClients[client.id!] ? '▼' : '▶'} Related Jobs ({client.totalJobs || 0})
						</button>

						{#if expandedClients[client.id!]}
							<div class="client-card__related-list">
								{#each expandedClients[client.id!].jobs as job (job.id)}
									<div 
										class="client-card__related-job"
										onclick={() => openJobFromClient(job, client)}
									>
										<span class="date">{new Date(job.start).toLocaleDateString()}</span>
										<span class="title">{job.title}</span>
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
								{:else}
									<div class="client-card__related-empty">No related jobs found for this client.</div>
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
					<button onclick={() => editClient(client)} class="client-card__btn client-card__btn--edit">
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

{#if showForm}
	<ClientForm
		bind:show={showForm}
		bind:client={editingClient}
		onSaved={handleClientSaved}
	/>
{/if}

<!-- Note: JobDetailsModal is globally mounted in (app)/+layout.svelte -->

<style>
	/* BEM naming maintained throughout */
	.clients-page {
		padding: 1.5rem 1rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.clients-page__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.clients-page__title {
		font-size: 2rem;
		font-weight: 700;
		margin: 0;
	}

	.clients-page__btn-add {
		background: #3b82f6;
		color: white;
		border: none;
		padding: 0.85rem 1.75rem;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	.clients-page__filters {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.clients-page__search {
		flex: 1;
		min-width: 280px;
		padding: 0.85rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
	}

	.clients-page__select {
		padding: 0.85rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		min-width: 180px;
	}

	.area-filter__chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.area-chip {
		padding: 0.45rem 1rem;
		border-radius: 9999px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s;
		border: 1px solid;
	}

	.area-chip.active {
		font-weight: 600;
		box-shadow: 0 0 0 3px currentColor;
	}

	.clients-page__list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.client-card {
		display: flex;
		justify-content: space-between;
		background: white;
		padding: 1.35rem;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0,0,0,0.08);
		transition: transform 0.2s;
	}

	.client-card:hover {
		transform: translateX(4px);
	}

	.client-card__main { flex: 1; }
	.client-card__header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; }
	.client-card__name { margin: 0; font-size: 1.2rem; font-weight: 600; }

	.client-card__contact { margin-bottom: 0.5rem; line-height: 1.5; }
	.contact-link { color: #0369a1; text-decoration: none; }
	.contact-link:hover { text-decoration: underline; }

	.client-card__address {
		color: #1e40af;
		cursor: pointer;
		margin-bottom: 0.75rem;
		text-decoration: underline dotted;
	}
	.client-card__address:hover { color: #1e3a8a; text-decoration: underline; }

	.client-card__meta {
		font-size: 0.95rem;
		color: #475569;
	}

	.no-jobs { color: #f59e0b; }

	.client-card__actions {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-left: 1rem;
	}

	.client-card__btn {
		padding: 0.55rem 1.1rem;
		border-radius: 6px;
		border: none;
		cursor: pointer;
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.client-card__btn--edit { background: #e0f2fe; color: #0369a1; }
	.client-card__btn--delete { background: #fee2e2; color: #ef4444; }

	.client-card__btn--disabled {
		background: #f1f5f9 !important;
		color: #94a3b8 !important;
		cursor: not-allowed;
		opacity: 0.6;
	}

	.clients-page__empty {
		text-align: center;
		padding: 4rem 1rem;
		color: #64748b;
		background: white;
		border-radius: 12px;
	}

	/* Phase 6: Expandable related jobs styles (BEM) */
	.client-card__related {
		margin-top: 0.75rem;
		border-top: 1px dashed #e2e8f0;
		padding-top: 0.5rem;
	}

	.client-card__related-toggle {
		font-size: 0.8rem;
		color: #0369a1;
		background: none;
		border: none;
		padding: 0.2rem 0;
		cursor: pointer;
		text-align: left;
	}

	.client-card__related-list {
		margin-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.client-card__related-job {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.8rem;
		padding: 0.25rem 0.4rem;
		background: #f8fafc;
		border-radius: 4px;
		cursor: pointer;
	}
	.client-card__related-job:hover {
		background: #f1f5f9;
	}

	.client-card__related-job .date { color: #64748b; font-size: 0.75rem; }
	.client-card__related-job .title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.client-card__related-job .status { font-size: 0.65rem; padding: 0.1rem 0.35rem; border-radius: 3px; text-transform: uppercase; }
	.client-card__related-job .status--scheduled { background: #dbeafe; color: #1e40af; }
	.client-card__related-job .status--confirmed { background: #d1fae5; color: #166534; }
	.client-card__related-job .status--completed { background: #a7f3d0; color: #065f46; }
	.client-card__related-job .status--cancelled { background: #fee2e2; color: #991b1b; }
	.client-card__related-job .amount { font-weight: 600; text-align: right; }
	.client-card__related-job .invoice-badge { font-size: 0.65rem; background: #ecfdf5; color: #166534; padding: 0.1rem 0.4rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.2rem; }
	/* )=- Overdue visual (Phase 7) on clients related jobs rows. Red background + small pill when overdue.
	   Mirrors the treatment added to /jobs cards and the modal for consistency (BEM + shared isInvoiceOverdue). */
	.client-card__related-job .invoice-badge.overdue { background: #fee2e2; color: #991b1b; }
	.client-card__related-job .overdue-pill { font-size: 0.55rem; background: #991b1b; color: white; padding: 0 0.15rem; border-radius: 2px; text-transform: uppercase; }

	.client-card__related-empty {
		font-size: 0.75rem;
		color: #94a3b8;
	}

	.client-card__related-more {
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		align-self: flex-start;
		margin-top: 0.25rem;
		background: #e0f2fe;
		color: #0369a1;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}
</style>