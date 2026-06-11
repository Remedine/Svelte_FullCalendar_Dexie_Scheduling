<!-- src/lib/components/BillableItemRow.svelte -->
<script lang="ts">
	import { optionsStore } from '$lib/stores/options.svelte';

	let {
		item = $bindable({
			title: '',
			price: 0,
			quantity: 1,
			total: 0
		}),
		onRemove = () => {},
		autofocusPrice = false
	} = $props<{ item?: any; onRemove?: (e?: any) => void; autofocusPrice?: boolean }>();

	const templates = $derived(optionsStore.data?.defaultBillableItems || []);

	let showSuggestions = $state(false);

	const filteredTemplates = $derived.by(() => {
		if (!item.title) return templates;
		const term = item.title.toLowerCase().trim();
		return templates.filter((t: any) => t.title.toLowerCase().includes(term));
	});

	let priceInputEl: HTMLInputElement | undefined;

	$effect(() => {
		if (autofocusPrice && item.price === 0 && priceInputEl) {
			// Small timeout to let the DOM settle when the row is freshly added
			setTimeout(() => {
				priceInputEl?.focus();
				priceInputEl?.select();
			}, 30);
		}
	});

	$effect(() => {
		item.total = (item.price || 0) * (item.quantity || 1);
	});

	function selectTemplate(template: any) {
		item.title = template.title;
		item.price = template.price || 0;
		item.quantity = template.quantity || 1;
		showSuggestions = false;
	}

	function handleFocus() {
		if (!item.title) showSuggestions = true;
	}

	function handleBlur() {
		setTimeout(() => (showSuggestions = false), 180);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && filteredTemplates.length > 0) {
			e.preventDefault();
			selectTemplate(filteredTemplates[0]);
		}
	}
</script>

<div class="billable-item-row">
	<div class="billable-item-row__grid">
		<!-- Column 1, Row 1: Description -->
		<div class="billable-item-row__title">
			<input
				type="text"
				bind:value={item.title}
				onfocus={handleFocus}
				onblur={handleBlur}
				onkeydown={handleKeydown}
				placeholder="Billable item description"
				class="billable-item-row__input"
			/>

			{#if showSuggestions && filteredTemplates.length > 0}
				<div class="billable-item-row__suggestions">
					{#each filteredTemplates as template, index (index)}
						<button
							type="button"
							class="billable-item-row__suggestion"
							onclick={() => selectTemplate(template)}
							onkeydown={(e) => e.key === 'Enter' && selectTemplate(template)}
						>
							{template.title}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Column 2, Row 1: Delete Button -->
		<button
			type="button"
			class="billable-item-row__remove"
			onclick={onRemove}
			aria-label="Remove this item"
		>
			✕
		</button>

		<!-- Column 1, Row 2: Price + Qty -->
		<div class="billable-item-row__price-qty">
			<div class="billable-item-row__price">
				<span class="billable-item-row__currency">$</span>
				<input
					type="number"
					bind:value={item.price}
					placeholder="0.00"
					class="billable-item-row__input billable-item-row__input--price"
					bind:this={priceInputEl}
					step="0.01"
				/>
			</div>

			<div class="billable-item-row__quantity">
				<span class="billable-item-row__qty-label">qty</span>
				<input
					type="number"
					bind:value={item.quantity}
					min="1"
					class="billable-item-row__input billable-item-row__input--qty"
				/>
			</div>
		</div>

		<!-- Column 2, Row 2: Total -->
		<div class="billable-item-row__total">
			<strong>${(item.total || 0).toFixed(2)}</strong>
		</div>
	</div>
</div>

<style>
	.billable-item-row {
		padding: 1.25rem;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		margin-bottom: 1.25rem;
		container-type: inline-size;
		container-name: billable-row;
	}

	.billable-item-row__grid {
		display: grid;
		grid-template-columns: 70% 30%;
		grid-template-rows: auto auto;
		gap: 0.75rem 1.25rem;
		align-items: start;
	}

	.billable-item-row__title {
		position: relative;
		grid-column: 1;
		grid-row: 1;
		min-width: 0;
	}

	.billable-item-row__remove {
		grid-column: 2;
		grid-row: 1;
		justify-self: end;
		align-self: start;
		background: none;
		border: none;
		color: #ef4444;
		font-size: 1.6rem;
		cursor: pointer;
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 8px;
	}

	.billable-item-row__remove:hover {
		background: #fee2e2;
	}

	.billable-item-row__price-qty {
		grid-column: 1;
		grid-row: 2;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.billable-item-row__total {
		grid-column: 2;
		grid-row: 2;
		text-align: right;
		font-weight: 600;
		color: #1e2937;
		font-size: 1.25rem;
		align-self: end;
	}

	.billable-item-row__input {
		padding: 0.65rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 0.95rem;
		width: 100%;
		box-sizing: border-box;
	}

	.billable-item-row__input--price,
	.billable-item-row__input--qty {
		max-width: 96px;
		text-align: right;
	}

	.billable-item-row__currency,
	.billable-item-row__qty-label {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: #64748b;
		font-weight: 500;
		pointer-events: none;
	}

	.billable-item-row__price,
	.billable-item-row__quantity {
		position: relative;
	}

	.billable-item-row__suggestions {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		background: white;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		margin-top: 4px;
		max-height: 200px;
		overflow-y: auto;
		z-index: 20;
		box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
	}

	.billable-item-row__suggestion {
		padding: 0.65rem 0.9rem;
		cursor: pointer;
		font-size: 0.95rem;
	}

	.billable-item-row__suggestion:hover {
		background: #f8fafc;
	}

	/* Mobile */
	@container billable-row (max-width: 520px) {
		.billable-item-row__grid {
			grid-template-columns: 1fr;
		}

		.billable-item-row__remove {
			justify-self: end;
		}

		.billable-item-row__total {
			text-align: right;
		}
	}

	.billable-item-row__suggestion {
		padding: 0.65rem 0.9rem;
		cursor: pointer;
		font-size: 0.95rem;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-bottom: 1px solid #f1f5f9;
	}

	.billable-item-row__suggestion:last-child {
		border-bottom: none;
	}

	.billable-item-row__suggestion:hover,
	.billable-item-row__suggestion:focus {
		background: #f8fafc;
	}
</style>
