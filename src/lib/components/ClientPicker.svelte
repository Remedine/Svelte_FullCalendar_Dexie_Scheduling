<!-- src/lib/components/ClientPicker.svelte -->
<script lang="ts">
	import { db, type Client, createClient } from '$lib/db';

	type CreateOption = {
		id: '__create__';
		name: string;
	};

	type Option = Client | CreateOption;

	let {
		value = $bindable<string | null | undefined>(undefined),
		placeholder = 'Search or create client...',
		onSelect = (client: Client) => {},
		onCreate = async (name: string) => {},
		allowCreate = $bindable(true),
		clearable = $bindable(true),
		id = 'client-picker'
	} = $props();

	let clients = $state<Client[]>([]);
	let searchTerm = $state('');
	let isOpen = $state(false);
	let isCreating = $state(false);
	let activeIndex = $state(-1);
	let hasInitialized = $state(false);

	let inputEl = $state<HTMLInputElement>();
	let dropdownEl = $state<HTMLDivElement>();

	// One-time load using runes only (no onMount)
	$effect(() => {
		if (!hasInitialized) {
			hasInitialized = true;
			db.clients
				.orderBy('name')
				.toArray()
				.then((data) => {
					clients = data;
				});
		}
	});

	// Auto open when typing
	$effect(() => {
		if (searchTerm.trim() && !isOpen) {
			isOpen = true;
		}
	});

	// Reset when parent clears value
	$effect(() => {
		if (!value) searchTerm = '';
	});

	// Clamp active index
	$effect(() => {
		if (activeIndex >= options.length) {
			activeIndex = options.length > 0 ? options.length - 1 : -1;
		}
	});

	// Scroll active item into view
	$effect(() => {
		if (activeIndex >= 0 && isOpen) {
			document.getElementById(`option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
		}
	});

	const options = $derived.by<Option[]>(() => {
		const term = searchTerm.toLowerCase().trim();
		let result: Option[] = [...clients];

		if (term) {
			result = clients.filter(
				(c) =>
					c.name.toLowerCase().includes(term) ||
					(c.email && c.email.toLowerCase().includes(term)) ||
					(c.serviceAddressCity && c.serviceAddressCity.toLowerCase().includes(term))
			);
		}

		const showCreate =
			allowCreate && term && !clients.some((c) => c.name.trim().toLowerCase() === term);

		if (showCreate) {
			result = [{ id: '__create__', name: term }, ...result];
		}

		return result;
	});

	const selectedClient = $derived.by(() => {
		if (!value || clients.length === 0) return null;
		return clients.find((c) => c.id === value || c.pbId === value) || null;
	});

	const showCreateHint = $derived.by(() => {
		return options.length > 0 && isCreateOption(options[0]);
	});

	const displayValue = $derived.by(() => {
		if (isOpen) return searchTerm;
		return selectedClient?.name ?? '';
	});

	function isCreateOption(option: Option): option is CreateOption {
		return option.id === '__create__';
	}

	function setActiveIndex(index: number) {
		activeIndex = Math.max(-1, Math.min(index, options.length - 1));
	}

	function selectActiveOption() {
		if (activeIndex < 0 || activeIndex >= options.length) return;
		const option = options[activeIndex];
		if (isCreateOption(option)) {
			createAndSelectClient();
		} else {
			selectClient(option);
		}
	}

	async function createAndSelectClient() {
		if (!searchTerm.trim() || !allowCreate || isCreating) return;

		isCreating = true;
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
				clients = await db.clients.orderBy('name').toArray();
				value = newClient.id ?? null;
				searchTerm = newClient.name;
				isOpen = false;
				activeIndex = -1;
				onSelect(newClient);
				await onCreate(newClient.name);
			}
		} catch (err) {
			console.error(err);
			alert('Failed to create new client.');
		} finally {
			isCreating = false;
		}
	}

	function selectClient(client: Client) {
		value = client.id ?? null;
		searchTerm = client.name;
		isOpen = false;
		activeIndex = -1;
		onSelect(client);
	}

	function clearSelection() {
		if (!clearable) return;
		value = null;
		searchTerm = '';
		isOpen = false;
		activeIndex = -1;
	}

	function handleInputFocus() {
		if (!searchTerm && selectedClient) {
			searchTerm = selectedClient.name;
		}
		isOpen = true;
		activeIndex = options.length > 0 ? 0 : -1;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen) {
			if (e.key === 'ArrowDown' || e.key === 'Enter') {
				e.preventDefault();
				isOpen = true;
				activeIndex = 0;
			}
			return;
		}

		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				isOpen = false;
				activeIndex = -1;
				break;
			case 'ArrowDown':
				e.preventDefault();
				setActiveIndex(activeIndex + 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				setActiveIndex(activeIndex - 1);
				break;
			case 'Enter':
				e.preventDefault();
				selectActiveOption();
				break;
		}
	}

	function handleBlur(e: FocusEvent) {
		if (!dropdownEl?.contains(e.relatedTarget as Node)) {
			isOpen = false;
			activeIndex = -1;
		}
	}

	function handleClickOutside(e: PointerEvent) {
		const path = e.composedPath();
		if ((!inputEl || !path.includes(inputEl)) && (!dropdownEl || !path.includes(dropdownEl))) {
			isOpen = false;
			activeIndex = -1;
		}
	}

	$effect(() => {
		document.addEventListener('pointerdown', handleClickOutside);
		return () => document.removeEventListener('pointerdown', handleClickOutside);
	});
</script>

<div class="client-picker">
	<label for={id} class="sr-only">Client</label>

	<div class="client-picker__input-wrapper">
		<input
			bind:this={inputEl}
			{id}
			type="text"
			value={displayValue}
			oninput={(e) => (searchTerm = (e.currentTarget as HTMLInputElement).value)}
			onfocus={handleInputFocus}
			onkeydown={handleKeydown}
			onblur={handleBlur}
			{placeholder}
			class="client-picker__input input"
			role="combobox"
			aria-expanded={isOpen}
			aria-controls="client-listbox"
			aria-autocomplete="list"
			aria-activedescendant={activeIndex >= 0 ? `option-${activeIndex}` : undefined}
		/>

		{#if selectedClient && clearable}
			<button
				type="button"
				class="client-picker__clear"
				onclick={(e) => {
					e.stopPropagation();
					clearSelection();
				}}
				aria-label="Clear selection"
			>
				×
			</button>
		{/if}
	</div>

	{#if isOpen}
		<div bind:this={dropdownEl} class="client-picker__dropdown" id="client-listbox" role="listbox">
			{#each options as option, index (option.id)}
				{@const isCreate = isCreateOption(option)}
				{@const isActive = index === activeIndex}

				<div
					id={`option-${index}`}
					class="client-picker__option"
					class:client-picker__option--active={isActive}
					class:client-picker__option--create={isCreate}
					class:client-picker__option--loading={isCreate && isCreating}
					role="option"
					tabindex="0"
					aria-selected={!isCreate && option.id === value}
					onmouseenter={() => (activeIndex = index)}
					onmousedown={(e) => {
						e.stopPropagation();
						if (isCreate) {
							createAndSelectClient();
						} else {
							selectClient(option);
						}
					}}
				>
					{#if isCreate}
						<strong>+ Create new client: "{searchTerm}"</strong>
						{#if isCreating}
							<span class="client-picker__loading">Creating...</span>
						{/if}
						{#if showCreateHint && !isCreating}
							<small class="client-picker__hint">Press Enter to create</small>
						{/if}
					{:else}
						<strong>{option.name}</strong>
						{#if option.serviceAddressCity || option.email}
							<small>
								{option.serviceAddressCity || ''}{option.serviceAddressCity && option.email
									? ' • '
									: ''}
								{option.email || ''}
							</small>
						{/if}
					{/if}
				</div>
			{/each}

			{#if options.length === 0}
				<div class="client-picker__no-results">No clients found</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ClientPicker updated for design tokens and base primitives (Phase 2). */

	.client-picker {
		font-family: inherit;
		width: 100%;
		position: relative;
	}
	.client-picker__input-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}
	.client-picker__input {
		/* base .input + overrides for the clear button space */
		padding-right: 2.5rem;
	}
	.client-picker__input:focus {
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}
	.client-picker__clear {
		position: absolute;
		right: var(--space-3);
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-size: 1.2rem;
		cursor: pointer;
	}
	.client-picker__clear:hover {
		color: var(--color-danger);
	}
	.client-picker__dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		margin-top: 4px;
		max-height: 320px;
		overflow-y: auto;
		box-shadow: var(--shadow-md);
		z-index: var(--z-dropdown);
	}
	.client-picker__option {
		padding: var(--space-3) var(--space-4);
		cursor: pointer;
		border-bottom: 1px solid var(--color-border);
		font-size: var(--font-size-sm);
	}
	.client-picker__option:hover,
	.client-picker__option--active {
		background: var(--color-surface-alt);
	}
	.client-picker__option--create {
		background: var(--color-success-soft);
		border-bottom: 2px solid var(--color-success);
		font-weight: var(--font-weight-semibold);
	}
	.client-picker__option--create:hover,
	.client-picker__option--create.client-picker__option--active {
		background: var(--color-success-soft);
	}
	.client-picker__option--loading {
		opacity: 0.7;
		pointer-events: none;
	}
	.client-picker__hint {
		display: block;
		margin-top: 4px;
		font-size: var(--font-size-xs);
		color: var(--color-success);
	}
	.client-picker__loading {
		font-size: var(--font-size-sm);
		color: var(--color-success);
		margin-left: var(--space-2);
	}
	.client-picker__no-results {
		padding: var(--space-4);
		text-align: center;
		color: var(--color-text-muted);
	}
</style>
