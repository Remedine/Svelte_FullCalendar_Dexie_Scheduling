<!-- src/lib/components/ClientPicker.svelte -->
<script lang="ts">
	import { db, type Client, createClient } from '$lib/db';

	let {
		value = $bindable(),  
		placeholder = 'Select or create client',
		onSelect = (client: Client) => {},
		onCreate = async (name: string) => {},
		allowCreate = $bindable(true),
		id = 'client-picker'
	} = $props();

	let clients = $state<Client[]>([]);
	let searchTerm = $state('');
	let isOpen = $state(false);
	let inputEl = $state<HTMLInputElement>();
	let buttonEl = $state<HTMLButtonElement>();

	// )=- Load clients + refresh function (called after creation)
	async function loadClients() {
		clients = await db.clients.orderBy('name').toArray();
		console.log(`📋 Loaded ${clients.length} clients from Dexie`);
	}

	// Initial load + reactive reload when needed
	$effect(() => {
		loadClients();
	});

	let selectedClient = $derived.by(() => {
		if (!value || clients.length === 0) return null;
		return clients.find(c => 
			c.id === value || c.pbId === value
		) || null;
	});

	let filteredClients = $derived.by(() => {
		const term = searchTerm.toLowerCase().trim();
		if (!term) return [...clients];

		return clients.filter(c =>
			c.name.toLowerCase().includes(term) ||
			(c.email && c.email.toLowerCase().includes(term)) ||
			(c.serviceAddressCity && c.serviceAddressCity.toLowerCase().includes(term))
		);
	});

	let showCreateOption = $derived.by(() => {
		if (!allowCreate || !searchTerm.trim()) return false;
		const term = searchTerm.trim();
		return !clients.some(c => c.name.toLowerCase() === term.toLowerCase());
	});

	async function createAndSelectClient() {
		if (!searchTerm.trim() || !allowCreate) return;

		const newName = searchTerm.trim();

		try {
			const newClientData = {
				name: newName,
				serviceAddressStreet: '',
				serviceAddressCity: '',
				serviceAddressState: 'WA',
				serviceAddressZip: '',
				areaOfTown: '',
				preferredBillingMethod: 'email' as const,
				phone: '',
				email: '',
				notes: ''
			};

			const newId = await createClient(newClientData);
			const newClient = await db.clients.get(newId);

			if (newClient) {
				// )=- Critical: Refresh the list so the new client appears
				await loadClients();

				// Set selection
				value = newClient.id ?? null;
				searchTerm = '';
				isOpen = false;

				onSelect(newClient);
				await onCreate(newClient.name);

				console.log(`✅ New client created and selected: ${newClient.name}`);
			}
		} catch (err) {
			console.error('Failed to create client inline:', err);
			alert('Failed to create new client. Please use the full Client form.');
		}
	}

	function selectClient(client: Client) {
		value = client.id ?? null;
		searchTerm = ''; 
		isOpen = false;
		onSelect(client);
		inputEl?.focus();
	}

	function toggleDropdown() {
		isOpen = !isOpen;
		if (isOpen) {
			setTimeout(() => inputEl?.focus(), 10);
		}
	}

	function handleInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			isOpen = false;
			searchTerm = '';
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (showCreateOption) {
				createAndSelectClient();
			} else if (filteredClients.length > 0) {
				selectClient(filteredClients[0]);
			}
		}
	}

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as Node;
		if (buttonEl && !buttonEl.contains(target)) {
			isOpen = false;
		}
	}

	$effect(() => {
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});
</script>

<div class="client-picker" style="position: relative; width: 100%;">
	<label for={id} class="sr-only">Select or create client</label>

	<button
		bind:this={buttonEl}
		type="button"
		{id}
		class="selected-display"
		onclick={toggleDropdown}
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		aria-controls="client-listbox"
	>
		<input
			bind:this={inputEl}
			type="text"
			bind:value={searchTerm}
			placeholder={selectedClient ? selectedClient.name : placeholder}
			onkeydown={handleInputKeydown}
			onfocus={() => isOpen = true}
			readonly={!isOpen}
			aria-autocomplete="list"
		/>
		<span class="arrow">▼</span>
	</button>

	{#if isOpen}
		<div class="dropdown" id="client-listbox" role="listbox">
			{#if showCreateOption}
				<div
					class="option create-option"
					role="option"
					onclick={createAndSelectClient}
					tabindex="0"
					onkeydown={(e) => e.key === 'Enter' && createAndSelectClient()}
				>
					<strong>+ Create new client: "{searchTerm}"</strong>
				</div>
			{/if}

			{#if filteredClients.length === 0 && !showCreateOption}
				<div class="no-results">No clients found</div>
			{:else}
				{#each filteredClients as client (client.id)}
					<div
						class="option"
						class:selected={client.id === value}
						role="option"
						aria-selected={client.id === value}
						onclick={() => selectClient(client)}
						tabindex="0"
						onkeydown={(e) => e.key === 'Enter' && selectClient(client)}
					>
						<strong>{client.name}</strong><br>
						<small>
							{client.serviceAddressCity}, {client.serviceAddressState} • 
							{client.email}
							{#if client.phone}
								<br>📞 {client.phone}
							{/if}
						</small>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.client-picker { 
		font-family: inherit;
		width: 100%;                    
	}

	.selected-display {
		display: flex;
		align-items: center;
		width: 100%;                   
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		padding: 0.75rem 1rem;
		cursor: pointer;
		text-align: left;
		font-size: 1rem;
	}

	.selected-display input {
		border: none;
		outline: none;
		background: transparent;
		flex: 1;
		cursor: pointer;
	}

	.arrow {
		margin-left: 0.5rem;
		font-size: 0.8rem;
		color: #64748b;
	}

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		margin-top: 4px;
		max-height: 320px;
		overflow-y: auto;
		box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
		z-index: 100;
	}

	.option {
		padding: 0.75rem 1rem;
		cursor: pointer;
		border-bottom: 1px solid #f1f5f9;
	}

	.option:hover,
	.option:focus {
		background: #f8fafc;
	}

	.option.create-option {
		background: #f0fdf4;
		border-bottom: 2px solid #86efac;
		font-weight: 600;
	}

	.option.create-option:hover {
		background: #dcfce7;
	}

	.option.selected {
		background: #eff6ff;
		font-weight: 500;               
	}

	.option small {
		display: block;
		margin-top: 2px;
		color: #64748b;
	}

	.no-results {
		padding: 1rem;
		text-align: center;
		color: #64748b;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		border: 0;
	}
</style>