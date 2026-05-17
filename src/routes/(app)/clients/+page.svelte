<!-- src/routes/(app)/clients/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { db, type Client } from '$lib/db';
	import ClientForm from '$lib/components/ClientForm.svelte';

	let clients = $state<Client[]>([]);
	let showForm = $state(false);
	let editingClient = $state<Client | null>(null);

	let searchTerm = $state('');
	let sortMode = $state<'alpha' | 'recent' | 'upcoming'>('alpha');
	let timeFilter = $state<'all' | 'nextWeek' | 'nextMonth'>('all');

	// )=- Helper to normalize phone for searching
	function normalizeForSearch(phone: string | undefined): string {
		if (!phone) return '';
		return phone.replace(/\D/g, ''); // remove all non-digits
	}

	let displayedClients = $derived.by(() => {
		let result = [...clients];

		const term = searchTerm.toLowerCase().trim();
		if (term) {
			result = result.filter(c => {
				const normalizedPhone = normalizeForSearch(c.phone);

				return (
					c.name.toLowerCase().includes(term) ||
					(c.email && c.email.toLowerCase().includes(term)) ||
					c.serviceAddressCity.toLowerCase().includes(term) ||
					(normalizedPhone && normalizedPhone.includes(term.replace(/\D/g, '')))
				);
			});
		}

		// Sorting
		if (sortMode === 'recent') {
			result.sort((a, b) => 
				new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
			);
		} else {
			result.sort((a, b) => a.name.localeCompare(b.name));
		}

		return result;
	});

	onMount(async () => {
		clients = await db.clients.orderBy('name').toArray();
	});

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
		clients = await db.clients.orderBy('name').toArray();
	}

	async function deleteClient(id: number) {
		if (!confirm('Delete this client?')) return;
		await db.clients.delete(id);
		clients = await db.clients.orderBy('name').toArray();
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

		<select bind:value={timeFilter} class="clients-page__select">
			<option value="all">All Clients</option>
			<option value="nextWeek">Jobs Next Week</option>
			<option value="nextMonth">Jobs Next Month</option>
		</select>
	</div>

	<ul class="clients-page__list">
		{#each displayedClients as client (client.id)}
			<li class="clients-page__list-item">
				<div class="clients-page__client-info">
					<strong>{client.name}</strong><br>
					<span>{client.email || '—'}</span><br>
					<span class="clients-page__phone">📞 {client.phone || 'No phone'}</span>
				</div>
				<div class="clients-page__actions">
					<button onclick={() => editClient(client)} class="clients-page__btn-edit">Edit</button>
					<button onclick={() => deleteClient(client.id!)} class="clients-page__btn-delete">Delete</button>
				</div>
			</li>
		{/each}

		{#if displayedClients.length === 0}
			<li class="clients-page__empty">No clients match your search.</li>
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

<style>
	.clients-page { padding: 1.5rem; max-width: 1100px; margin: 0 auto; }
	.clients-page__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
	.clients-page__title { font-size: 2rem; font-weight: 700; margin: 0; }
	.clients-page__btn-add { background: #3b82f6; color: white; border: none; padding: 0.85rem 1.75rem; border-radius: 8px; font-weight: 600; cursor: pointer; }

	.clients-page__filters { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
	.clients-page__search { flex: 1; min-width: 280px; padding: 0.85rem 1rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 1rem; }
	.clients-page__select { padding: 0.85rem 1rem; border: 1px solid #cbd5e1; border-radius: 8px; min-width: 180px; }

	.clients-page__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; }
	.clients-page__list-item { display: flex; justify-content: space-between; align-items: center; padding: 1.25rem; background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
	.clients-page__phone { color: #0369a1; font-weight: 500; }
	.clients-page__actions { display: flex; gap: 0.5rem; }
	.clients-page__btn-edit { background: #e0f2fe; color: #0369a1; padding: 0.5rem 1rem; border-radius: 6px; border: none; }
	.clients-page__btn-delete { background: #fee2e2; color: #ef4444; padding: 0.5rem 1rem; border-radius: 6px; border: none; }
	.clients-page__empty { text-align: center; padding: 4rem; color: #64748b; background: white; border-radius: 10px; }
</style>