<!-- src/lib/components/BillableItemRow.svelte -->
<script lang="ts">
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { computeLineNet } from '$lib/utils/invoiceTotals';
	import type { InvoiceDiscount } from '$lib/utils/invoiceTypes';

	let {
		item = $bindable({
			title: '',
			price: 0,
			quantity: 1,
			total: 0,
			unit: 'qty' as 'hour' | 'qty',
			lineDiscount: undefined as InvoiceDiscount | undefined
		}),
		onRemove = () => {},
		onPersist = () => {},
		autofocusPrice = false,
		showDiscount = false
	} = $props<{
		item?: any;
		onRemove?: (e?: any) => void;
		onPersist?: () => void;
		autofocusPrice?: boolean;
		showDiscount?: boolean;
	}>();

	let showLineDiscount = $state(false);

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
		if (showDiscount) {
			item.total = computeLineNet(item);
		} else {
			item.total = (item.price || 0) * (item.quantity || 1);
		}
	});

	const hasActiveLineDiscount = $derived(
		!!(
			item.lineDiscount &&
			(item.lineDiscount.value > 0 || item.lineDiscount.description?.trim())
		)
	);

	$effect(() => {
		if (hasActiveLineDiscount) showLineDiscount = true;
	});

	function addLineDiscount() {
		item.lineDiscount = { type: 'amount', value: 0, description: '' };
		showLineDiscount = true;
		onPersist();
	}

	function removeLineDiscount() {
		item.lineDiscount = undefined;
		showLineDiscount = false;
		onPersist();
	}

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

	<!-- Line 2: type → qty/hours × $rate = total (reads as "2 hrs × $150/hr = $300") -->
	<div class="billable-item-row__details-line">
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

		<div class="billable-item-row__calc">
			<label class="billable-item-row__field">
				<span class="billable-item-row__label">{unit === 'hour' ? 'Hours' : 'Qty'}</span>
				<input
					type="number"
					bind:value={item.quantity}
					min={unit === 'hour' ? 0.25 : 1}
					step={unit === 'hour' ? 0.25 : 1}
					class="billable-item-row__input billable-item-row__input--qty input"
					aria-label={unit === 'hour' ? 'Hours' : 'Quantity'}
				/>
			</label>

			<span class="billable-item-row__times" aria-hidden="true">×</span>

			<label class="billable-item-row__field billable-item-row__field--rate">
				<span class="billable-item-row__label">{unit === 'hour' ? 'Rate / hr' : 'Rate / ea'}</span>
				<span class="billable-item-row__price-input">
					<span class="billable-item-row__currency">$</span>
					<input
						type="number"
						bind:value={item.price}
						placeholder="0.00"
						class="billable-item-row__input billable-item-row__input--price input"
						bind:this={priceInputEl}
						step="0.01"
						min="0"
						aria-label={unit === 'hour' ? 'Rate per hour' : 'Rate each'}
					/>
				</span>
			</label>

			<span class="billable-item-row__equals" aria-hidden="true">=</span>

			<div class="billable-item-row__total">
				<span class="billable-item-row__label">Total</span>
				<strong class="billable-item-row__total-value">${(item.total || 0).toFixed(2)}</strong>
			</div>
		</div>

		{#if showDiscount && showLineDiscount && item.lineDiscount}
			<div class="billable-item-row__discount-block">
				<label class="billable-item-row__field billable-item-row__field--discount">
					<span class="billable-item-row__label">Discount</span>
					<div class="billable-item-row__discount-controls">
						<select
							class="billable-item-row__input input"
							bind:value={item.lineDiscount.type}
							onchange={() => onPersist()}
						>
							<option value="amount">$</option>
							<option value="percent">%</option>
						</select>
						<input
							type="number"
							class="billable-item-row__input input"
							min="0"
							step="0.01"
							bind:value={item.lineDiscount.value}
							onchange={() => onPersist()}
						/>
					</div>
				</label>
				<label class="billable-item-row__field billable-item-row__field--discount-desc">
					<span class="billable-item-row__label">Discount note</span>
					<input
						type="text"
						class="billable-item-row__input input"
						placeholder="e.g. Senior discount"
						bind:value={item.lineDiscount.description}
						onchange={() => onPersist()}
					/>
				</label>
				<button
					type="button"
					class="billable-item-row__text-btn billable-item-row__text-btn--danger"
					onclick={removeLineDiscount}
				>
					Remove discount
				</button>
			</div>
		{:else if showDiscount}
			<button type="button" class="billable-item-row__text-btn" onclick={addLineDiscount}>
				+ Add discount
			</button>
		{/if}
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

	/* Details: billing type, then "qty × rate = total" */
	.billable-item-row__details-line {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
	}

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

	.billable-item-row__calc {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-2);
		min-width: 0;
	}

	.billable-item-row__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.billable-item-row__field--rate {
		min-width: 7rem;
	}

	.billable-item-row__label {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
		line-height: 1.2;
	}

	.billable-item-row__price-input {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.billable-item-row__currency {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		flex-shrink: 0;
	}

	.billable-item-row__times,
	.billable-item-row__equals {
		color: var(--color-text-muted);
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-medium);
		padding-bottom: var(--space-2);
		flex-shrink: 0;
	}

	.billable-item-row__total {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-left: auto;
		align-items: flex-end;
		flex-shrink: 0;
	}

	.billable-item-row__total-value {
		font-size: var(--font-size-xl);
		color: var(--color-text);
		white-space: nowrap;
	}

	.billable-item-row__input {
		background: var(--color-surface);
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
	}

	.billable-item-row__input--price,
	.billable-item-row__input--qty {
		width: 5.5rem;
		max-width: 100%;
		text-align: right;
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

	.billable-item-row__discount-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: 100%;
		margin-top: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px dashed var(--color-border);
	}

	.billable-item-row__discount-controls {
		display: flex;
		gap: var(--space-1);
		align-items: center;
	}

	.billable-item-row__field--discount-desc {
		width: 100%;
	}

	.billable-item-row__text-btn {
		border: none;
		background: none;
		color: var(--color-primary);
		font-size: var(--font-size-xs);
		cursor: pointer;
		padding: 0;
		text-decoration: underline;
		align-self: flex-start;
	}

	.billable-item-row__text-btn--danger {
		color: var(--color-danger-emphasis, var(--color-danger));
	}

	.billable-item-row__field--discount select {
		width: 3.5rem;
	}

	.billable-item-row__field--discount input {
		width: 4.5rem;
	}

	/* Mobile: stack calc row */
	@container billable-row (max-width: 520px) {
		.billable-item-row__details-line {
			flex-direction: column;
			align-items: stretch;
		}

		.billable-item-row__calc {
			width: 100%;
		}

		.billable-item-row__total {
			margin-left: 0;
			align-items: flex-start;
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
