<!-- src/lib/components/BillableItemRow.svelte -->
<script lang="ts">
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';

	let {
		item = $bindable({
			title: '',
			price: 0,
			quantity: 1,
			total: 0,
			unit: 'qty' as 'hour' | 'qty'
		}),
		onRemove = () => {},
		autofocusPrice = false
	} = $props<{ item?: any; onRemove?: (e?: any) => void; autofocusPrice?: boolean }>();

	const templates = $derived(optionsStore.data?.defaultBillableItems || []);

	let showSuggestions = $state(false);

	let unit = $state<'hour' | 'qty'>(item.unit || 'qty');

	$effect(() => {
		item.unit = unit;
	});

	// Inherit default unit (hour/qty) from the matching defaultBillableItem in options when title is selected
	$effect(() => {
		if (item.title && optionsStore.data?.defaultBillableItems?.length) {
			const match = (optionsStore.data.defaultBillableItems as any[]).find(
				(t: any) => t.title === item.title
			);
			if (match?.unit && (match.unit === 'hour' || match.unit === 'qty')) {
				unit = match.unit;
			}
		}
	});

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
		if (template.unit === 'hour' || template.unit === 'qty') {
			unit = template.unit;
			item.unit = unit;
		}
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
				class="billable-item-row__input input"
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
					class="billable-item-row__input billable-item-row__input--price input"
					bind:this={priceInputEl}
					step="0.01"
				/>
			</div>

			<div class="billable-item-row__quantity">
				<!-- Toggle for hour/qty, defaults inherited from options for the selected billable -->
				<div class="billable-item-row__unit-toggle">
					<button
						type="button"
						class:active={unit === 'hour'}
						onclick={() => (unit = 'hour')}
						aria-label="Hours"
					>hr</button>
					<button
						type="button"
						class:active={unit === 'qty'}
						onclick={() => (unit = 'qty')}
						aria-label="Quantity"
					>qty</button>
				</div>
				<input
					type="number"
					bind:value={item.quantity}
					min="1"
					class="billable-item-row__input billable-item-row__input--qty input"
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
	/* BillableItemRow updated for design system cohesion (tokens + BEM). */

	.billable-item-row {
		padding: var(--space-5);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		margin-bottom: var(--space-5);
		container-type: inline-size;
		container-name: billable-row;
		transition: box-shadow var(--transition-fast), border-color var(--transition-fast);
	}

	.billable-item-row:hover {
		border-color: var(--color-border-strong);
		box-shadow: var(--shadow-sm);
	}

	.billable-item-row__grid {
		display: grid;
		grid-template-columns: 70% 30%;
		grid-template-rows: auto auto;
		gap: var(--space-3) var(--space-5);
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
		color: var(--color-danger);
		font-size: var(--font-size-2xl);
		cursor: pointer;
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
	}

	.billable-item-row__remove:hover {
		background: var(--color-danger-soft);
	}

	.billable-item-row__price-qty {
		grid-column: 1;
		grid-row: 2;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	.billable-item-row__total {
		grid-column: 2;
		grid-row: 2;
		text-align: right;
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		font-size: var(--font-size-xl);
		align-self: end;
	}

	.billable-item-row__input {
		background: var(--color-surface);
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
	}

	.billable-item-row__input--price,
	.billable-item-row__input--qty {
		max-width: 96px;
		text-align: right;
	}

	.billable-item-row__currency,
	.billable-item-row__qty-label {
		position: absolute;
		left: var(--space-3);
		top: 50%;
		transform: translateY(-50%);
		color: var(--color-text-muted);
		font-weight: var(--font-weight-medium);
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
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		margin-top: var(--space-1);
		max-height: 200px;
		overflow-y: auto;
		z-index: var(--z-dropdown);
		box-shadow: var(--shadow-md);
	}

	.billable-item-row__suggestion {
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text); /* light text in dark mode */
	}

	.billable-item-row__suggestion:hover {
		background: var(--color-surface-alt);
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
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		font-size: var(--font-size-sm);
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-border);
	}

	.billable-item-row__suggestion:last-child {
		border-bottom: none;
	}

	.billable-item-row__suggestion:hover,
	.billable-item-row__suggestion:focus {
		background: var(--color-surface-alt);
	}

	/* Unit toggle for hour/qty next to quantity input */
	.billable-item-row__unit-toggle {
		display: flex;
		font-size: 9px;
		line-height: 1;
		border: 1px solid var(--color-border);
		border-radius: 3px;
		overflow: hidden;
		margin-right: 4px;
	}
	.billable-item-row__unit-toggle button {
		padding: 1px 4px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-text-muted);
		font-weight: 600;
	}
	.billable-item-row__unit-toggle button.active {
		background: var(--color-primary);
		color: white;
	}
</style>
