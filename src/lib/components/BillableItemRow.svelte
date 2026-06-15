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

	// Inherit unit (hour/qty) from the matching defaultBillableItem in options when title is selected or set.
	// Options store 'hours' key for Per Hour, 'quantity' for Per Qty (no .unit field yet).
	$effect(() => {
		if (item.title && optionsStore.data?.defaultBillableItems?.length) {
			const match = (optionsStore.data.defaultBillableItems as any[]).find(
				(t: any) => t.title === item.title
			);
			if (match) {
				if (match.hours !== undefined) {
					unit = 'hour';
					if (item.quantity === undefined || item.quantity === 1) { // normalize if needed
						item.quantity = match.hours;
					}
				} else if (match.quantity !== undefined) {
					unit = 'qty';
					if (item.quantity === undefined || item.quantity === 1) {
						item.quantity = match.quantity;
					}
				}
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
		// Normalize from options shape: hours for Per Hour, quantity for Per Qty
		if (template.hours !== undefined) {
			unit = 'hour';
			item.quantity = template.hours;
		} else {
			unit = 'qty';
			item.quantity = template.quantity ?? 1;
		}
		item.unit = unit;
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
	<!-- Line 1: Billable Item title + X remove (same layout as before) -->
	<div class="billable-item-row__title-line">
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

		<button
			type="button"
			class="billable-item-row__remove"
			onclick={onRemove}
			aria-label="Remove this item"
		>
			✕
		</button>
	</div>

	<!-- Line 2: amount input | Per Qty/Per Hour toggle | symbol | price input | total (styled similar to options page) -->
	<div class="billable-item-row__details-line">
		<div class="billable-item-row__amount">
			<input
				type="number"
				bind:value={item.quantity}
				min="1"
				class="billable-item-row__input billable-item-row__input--qty input"
			/>
		</div>

		<div class="billable-item-row__type-toggle">
			<button
				type="button"
				class:active={unit === 'qty'}
				onclick={() => (unit = 'qty')}
			>
				Per Qty
			</button>
			<button
				type="button"
				class:active={unit === 'hour'}
				onclick={() => (unit = 'hour')}
			>
				Per Hour
			</button>
		</div>

		<div class="billable-item-row__price">
			<span class="billable-item-row__currency">{unit === 'hour' ? '$' : '#'}</span>
			<input
				type="number"
				bind:value={item.price}
				placeholder="0.00"
				class="billable-item-row__input billable-item-row__input--price input"
				bind:this={priceInputEl}
				step="0.01"
			/>
		</div>

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

	/* Title line: full width input + X on right (like options title full, controls) */
	.billable-item-row__title-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
	}

	.billable-item-row__title {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.billable-item-row__remove {
		background: none;
		border: none;
		color: var(--color-danger);
		font-size: var(--font-size-2xl);
		cursor: pointer;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: var(--radius-md);
		flex-shrink: 0;
	}

	.billable-item-row__remove:hover {
		background: var(--color-danger-soft);
	}

	/* Details line: amount | toggle | symbol | price | total  (flex, similar to options type + price row) */
	.billable-item-row__details-line {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.billable-item-row__amount {
		flex-shrink: 0;
	}

	.billable-item-row__amount input {
		width: 60px;
		text-align: right;
	}

	/* Per Qty / Per Hour toggle styled similar to options .billable-item__type-toggle */
	.billable-item-row__type-toggle {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		flex-shrink: 0;
	}

	.billable-item-row__type-toggle button {
		padding: var(--space-1) var(--space-2);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		border: none;
		cursor: pointer;
		color: var(--color-text);
		white-space: nowrap;
	}

	.billable-item-row__type-toggle button.active {
		background: var(--color-primary);
		color: white;
	}

	.billable-item-row__price {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.billable-item-row__total {
		margin-left: auto;
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		font-size: var(--font-size-xl);
		white-space: nowrap;
		flex-shrink: 0;
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

	/* (currency now inline in .billable-item-row__price; no absolute positioning needed) */

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

	/* (unit/type toggle styles now under .billable-item-row__type-toggle above, matching options) */
</style>
