<!-- src/routes/(app)/clients/+page.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { db, type Client } from '$lib/db';
	import ClientForm from '$lib/components/ClientForm.svelte';

	let clients = $state<Client[]>([]);
	let showForm = $state(false);
	let editingClient = $state<Client | null>(null);

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

	<ul class="clients-page__list">
		{#each clients as client (client.id)}
			<li class="clients-page__list-item">
				<div>
					<strong>{client.name}</strong><br>
					<small>{client.email || client.phone}</small>
				</div>
				<div>
					<button onclick={() => editClient(client)} class="clients-page__btn-edit">Edit</button>
					<button onclick={() => deleteClient(client.id!)} class="clients-page__btn-delete">Delete</button>
				</div>
			</li>
		{/each}

		{#if clients.length === 0}
			<li class="clients-page__empty">No clients yet. Click "+ New Client".</li>
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
	.clients-page {
		padding: 2rem;
		max-width: 900px;
		margin: 0 auto;
	}

	.clients-page__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
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

	.clients-page__list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.clients-page__list-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: white;
		border-radius: 8px;
		margin-bottom: 0.75rem;
		box-shadow: 0 1px 3px rgba(0,0,0,0.08);
	}

	.clients-page__btn-edit {
		background: #e0f2fe;
		color: #0369a1;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: none;
		margin-right: 0.5rem;
	}

	.clients-page__btn-delete {
		background: #fee2e2;
		color: #ef4444;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: none;
	}

	.clients-page__empty {
		text-align: center;
		padding: 3rem;
		color: #64748b;
		background: white;
		border-radius: 8px;
	}
</style>