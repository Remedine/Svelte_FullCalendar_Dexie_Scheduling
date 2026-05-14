<script lang="ts">
    import { onMount } from 'svelte';
    import { db, type Client } from '$lib/db';

    let {
        value = $bindable<number | null>(null),
        placeholder = 'Select client',
        onSelect = (client: Client) => {},
        id = 'client-picker'
    } = $props();

    let clients = $state<Client[]>([]);
    let filteredClients = $state<Client[]>([]);
    let searchTerm = $state('');
    let isOpen = $state(false);
    let selectedClient = $state<Client | null>(null);
    let inputEl= $state<HTMLInputElement>();
	let buttonEl = $state<HTMLButtonElement>();

    //load clients from Dexie
    onMount(async () => {
        clients = await db.clients.toArray();
        filteredClients = [...clients];

        // Set initial selected if value exists
        if (value) {
            selectedClient = clients.find(c => c.id === value) || null;
        }
    });

    //Filter as user types
    $effect(() => {
        const term = searchTerm.toLowerCase().trim();
        if (!term) {
            filteredClients = clients.filter(c =>
                c.name.toLocaleLowerCase().includes(term) ||
                (c.email && c.email.toLowerCase().includes(term)) ||
                (c.serviceAddressCity && c.serviceAddressCity.toLowerCase().includes(term))
            );
        }
    });
    
    //Select client
    function selectClient(client: client) {
        value = client.id ?? null;
        selectedClient = client;
        searchTerm = ''; //clear search
        isOpen = false;
        onSelect(client);
        inputEl?.focus();
    }

	function toggleDropdown() {
		isOpen = !isOpen;
		if (isOpen) {
			setTimeout(() => inputEl?.focus(), 10); // small delay so input is ready
		}
	}

	function handleInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			isOpen = false;
			searchTerm = '';
		}
		if (e.key === 'Enter' && filteredClients.length > 0) {
			e.preventDefault();
			selectClient(filteredClients[0]);
		}
	}

    // Click outside to close
    function handleClickOutside(e: MouseEvent) {
        if (inputEl && !inputEl.contains(e.target as Node)) {
            isOpen = false;
            //searchTerm = ''; 
        }
    }

    $effect(() => {
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    });

</script>

<div class="client-picker" style="position: relative; width: 100%;">
	<label for={id} class="sr-only">Select client</label>

	<!-- )=- CHANGED: <button> instead of <div> for proper a11y + click handler -->
	<!-- )=- REMOVED conflicting onkeydown from button -->
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
			{#if filteredClients.length === 0}
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
						<small>{client.serviceAddressCity}, {client.serviceAddressState} • {client.email}</small>
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