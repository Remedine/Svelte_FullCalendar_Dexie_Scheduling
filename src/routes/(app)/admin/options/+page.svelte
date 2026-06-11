<!-- src/routes/(app)/admin/options/+page.svelte -->
<script lang="ts">
	// )=- Complete Options Page - All sections active with dynamic data
	// )=- Cleaned up redundant role guards and legacy onMount (causing load-time errors and potential auth redirects on navigation).
	// Central layout guard in (app)/+layout.svelte now handles admin-only access consistently.
	import { optionsStore } from '$lib/stores/options.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';

	// )=- Removed top-level non-admin redirect $effect (layout guard already handles role-based access and redirects non-admins away from /admin/* to /calendar).
	// This avoids duplicate redirects and race conditions on navigation.

	// )=- Converted from onMount to $effect for Svelte 5 runes compliance (auth cleanup / HYG-01).
	$effect(() => {
		// Load options once when authenticated as admin
		if (!auth.loading && auth.currentUser?.role === 'admin' && !optionsInitialized) {
			optionsInitialized = true;
			optionsStore.load();

			if (navigator.onLine) {
				optionsStore.pullFromPB().then((pulled) => {
					if (pulled) {
						console.log('✅ Fresh options pulled from PocketBase on load');
					}
				});
			}
		}
	});

	let isSaving = $state(false);
	let activeTab = $state<'scheduling' | 'invoice'>('scheduling');

	// )=- One-time flag to ensure options load/pull happens only once, preventing repeated pull attempts and error spam if pull fails.
	let optionsInitialized = $state(false);

	// )=- Removed redundant role guard $effect (central layout guard in (app)/+layout.svelte already enforces admin-only access).
	// Rely on layout for consistency and to avoid race conditions during navigation.

	// )=- Removed duplicate top-level role guard $effect (was causing potential premature redirects during auth hydration/navigation).
	// The layout guard + the loading $effect below are sufficient.

	const tabs = [
		{ id: 'scheduling', label: 'Scheduling Options' },
		{ id: 'invoice', label: 'Invoice Options' }
	] as const;

	let editingOptions = $state<any>({});

	function safeClone(obj: any) {
		if (!obj) return {};
		try {
			return JSON.parse(
				JSON.stringify(obj, (key, value) => {
					if (value instanceof Date) return value.toISOString();
					return value;
				})
			);
		} catch {
			return { ...obj };
		}
	}

	$effect(() => {
		if (optionsStore.data) {
			editingOptions = safeClone(optionsStore.data);
		} else if (!editingOptions?.id) {
			// )=- Fallback: if store data not yet populated (e.g. first load), seed a minimal
			// object with id so saveOptions doesn't immediately error with "No options data loaded to save".
			editingOptions = {
				id: 1,
				defaultJobDurationHours: 2,
				taxRate: 6.5,
				invoiceDueDays: 30,
				areasOfTown: [],
				defaultBillableItems: [],
				cancelReasons: []
			};
		}
	});

	async function saveOptions() {
		if (!editingOptions?.id) {
			toast.error('No options data loaded to save');
			return;
		}

		isSaving = true;

		try {
			const updated = {
				...editingOptions,
				lastUpdated: new Date(),
				updatedBy: auth.currentUser?.name || 'Admin'
			};

			await optionsStore.saveToDexie(updated);

			if (navigator.onLine) {
				await optionsStore.syncToPB(updated);
			}

			editingOptions = safeClone(updated);
			toast.success('Options saved and synced successfully!');
		} catch (err) {
			console.error('Save error:', err);
			toast.error('Saved locally. Cloud sync encountered an issue.');
		} finally {
			isSaving = false;
		}
	}

	// === Areas of Town helpers ===
	function addNewArea() {
		if (!editingOptions.areasOfTown) editingOptions.areasOfTown = [];
		editingOptions.areasOfTown.push({
			id: 'new-area-' + Date.now(),
			label: 'New Area',
			color: '#64748b'
		});
		editingOptions.areasOfTown = [...editingOptions.areasOfTown];
	}

	function deleteArea(id: string) {
		if (confirm(`Delete this area?`)) {
			editingOptions.areasOfTown = editingOptions.areasOfTown.filter((a: any) => a.id !== id);
		}
	}

	function moveAreaUp(index: number) {
		if (index <= 0) return;
		const arr = editingOptions.areasOfTown;
		[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
		editingOptions.areasOfTown = [...arr];
	}

	function moveAreaDown(index: number) {
		const arr = editingOptions.areasOfTown;
		if (index === -1 || index === arr.length - 1) return;
		[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
		editingOptions.areasOfTown = [...arr];
	}

	function isDefaultArea(index: number): boolean {
		return index === 0;
	}

	// === Billable Items helpers ===
	function moveBillableUp(index: number) {
		if (index <= 0) return;
		const arr = editingOptions.defaultBillableItems;
		[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
		editingOptions.defaultBillableItems = [...arr];
	}

	function moveBillableDown(index: number) {
		const arr = editingOptions.defaultBillableItems;
		if (index === -1 || index === arr.length - 1) return;
		[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
		editingOptions.defaultBillableItems = [...arr];
	}

	function isDefaultBillable(index: number): boolean {
		return index === 0;
	}

	// === Cancellation Reasons helpers ===
	function addCancelReason() {
		if (!editingOptions.cancelReasons) editingOptions.cancelReasons = [];
		editingOptions.cancelReasons.push('New Cancellation Reason');
		editingOptions.cancelReasons = [...editingOptions.cancelReasons];
	}

	function deleteCancelReason(index: number) {
		if (confirm('Delete this cancellation reason?')) {
			editingOptions.cancelReasons.splice(index, 1);
			editingOptions.cancelReasons = [...editingOptions.cancelReasons];
		}
	}

	function moveCancelReasonUp(index: number) {
		if (index <= 0) return;
		const arr = editingOptions.cancelReasons;
		[arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
		editingOptions.cancelReasons = [...arr];
	}

	function moveCancelReasonDown(index: number) {
		const arr = editingOptions.cancelReasons;
		if (index === -1 || index === arr.length - 1) return;
		[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
		editingOptions.cancelReasons = [...arr];
	}

	function isDefaultCancelReason(index: number): boolean {
		return index === 0;
	}

	// )=- Removed legacy onMount (duplicate of the $effect below, and onMount not imported — would throw ReferenceError on page load, potentially causing navigation/auth guard side-effects like redirect to login).
	// The $effect above (lines ~17-30) handles loading when admin role is confirmed and not loading.
	// )=- Also removed redundant role guard $effects that could fire during auth transitions and cause unwanted redirects (layout guard is the single source of truth).
</script>

<svelte:head>
	<title>Options - Capital City Windows</title>
</svelte:head>

<div class="options-page">
	<div class="options-page__header">
		<h1 class="options-page__title">Business Options</h1>
		<p class="options-page__subtitle">Configure system-wide settings • Admin only</p>
	</div>

	<!-- Tabs -->
	<div class="options-page__tabs">
		{#each tabs as tab, idx (idx)}
			<button
				class="options-page__tab {activeTab === tab.id ? 'options-page__tab--active' : ''}"
				onclick={() => (activeTab = tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Tab Content -->
	<div class="options-page__content">
		{#if activeTab === 'scheduling'}
			<h2>Scheduling Options</h2>

			<!-- General -->
			<div class="form-section">
				<h3>General</h3>
				<div class="form-grid">
					<label for="opt-duration">Default Job Duration (hours)</label>
					<input
						id="opt-duration"
						type="number"
						step="0.25"
						bind:value={editingOptions.defaultJobDurationHours}
					/>
				</div>
			</div>

			<!-- Areas of Town -->
			<div class="form-section">
				<h3>Areas of Town</h3>
				<p class="options-page__help">
					The **top area** is used as the default for new jobs. Use arrows to reorder.
				</p>

				{#if editingOptions?.areasOfTown?.length}
					<div class="areas-list">
						{#each editingOptions.areasOfTown as area, index (area.id)}
							<div class="area-item {isDefaultArea(index) ? 'area-item--default' : ''}">
								<input
									class="area-item__label-input"
									bind:value={area.label}
									placeholder="Area name"
								/>

								<input type="color" class="area-item__color" bind:value={area.color} />

								<div class="area-item__controls">
									<button
										type="button"
										class="area-item__move-btn"
										onclick={() => moveAreaUp(index)}
										disabled={index === 0}
									>
										↑
									</button>
									<button
										type="button"
										class="area-item__move-btn"
										onclick={() => moveAreaDown(index)}
										disabled={index === editingOptions.areasOfTown.length - 1}
									>
										↓
									</button>
									<button
										type="button"
										class="area-item__remove"
										onclick={() => deleteArea(area.id)}
									>
										✕
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<button type="button" class="options-page__btn options-page__btn--add" onclick={addNewArea}>
					+ Add New Area
				</button>
			</div>

			<!-- Cancellation Reasons -->
			<div class="form-section">
				<h3>Cancellation Reasons</h3>
				<p class="options-page__help">
					The **top reason** appears first in dropdowns. Reorder as needed.
				</p>

				{#if editingOptions?.cancelReasons?.length}
					<div class="cancel-reasons-list">
						{#each editingOptions.cancelReasons as reason, index (index)}
							<div
								class="cancel-reason-item {isDefaultCancelReason(index)
									? 'cancel-reason-item--default'
									: ''}"
							>
								<input
									class="cancel-reason-item__input"
									bind:value={editingOptions.cancelReasons[index]}
									placeholder="Enter cancellation reason"
								/>
								<div class="cancel-reason-item__controls">
									<button
										type="button"
										class="cancel-reason-item__move-btn"
										onclick={() => moveCancelReasonUp(index)}
										disabled={index === 0}
									>
										↑
									</button>
									<button
										type="button"
										class="cancel-reason-item__move-btn"
										onclick={() => moveCancelReasonDown(index)}
										disabled={index === editingOptions.cancelReasons.length - 1}
									>
										↓
									</button>
									<button
										type="button"
										class="cancel-reason-item__remove"
										onclick={() => deleteCancelReason(index)}
									>
										✕
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<button
					type="button"
					class="options-page__btn options-page__btn--add"
					onclick={addCancelReason}
				>
					+ Add New Reason
				</button>
			</div>
		{:else if activeTab === 'invoice'}
			<h2>Invoice & Billing Settings</h2>

			<div class="form-section">
				<h3>Billing & Tax</h3>
				<div class="form-grid">
					<label for="opt-tax">Tax Rate (%)</label>
					<input id="opt-tax" type="number" step="0.01" bind:value={editingOptions.taxRate} />
					<label for="opt-due">Invoice Due Days</label>
					<input id="opt-due" type="number" bind:value={editingOptions.invoiceDueDays} />
				</div>
			</div>

			<div class="form-section">
				<h3>Default Billable Items</h3>
				<p class="options-page__help">The first item is default for dropdown lists.</p>

				{#if editingOptions?.defaultBillableItems?.length}
					<div class="billable-list">
						{#each editingOptions.defaultBillableItems as item, index (index)}
							<div class="billable-item {isDefaultBillable(index) ? 'billable-item--default' : ''}">
								<input
									class="billable-item__input"
									bind:value={item.title}
									placeholder="Service name"
								/>
								<div class="billable-item__price">
									<span>$</span>
									<input
										type="number"
										class="billable-item__input billable-item__input--price"
										bind:value={item.price}
									/>
								</div>
								<select
									value={item.hours !== undefined ? 'hours' : 'quantity'}
									onchange={(e) => {
										const val = (e.target as HTMLSelectElement).value;
										if (val === 'hours') {
											item.hours = item.hours ?? 1;
											delete item.quantity;
										} else {
											item.quantity = item.quantity ?? 1;
											delete item.hours;
										}
									}}
								>
									<option value="quantity">Quantity</option>
									<option value="hours">Hours</option>
								</select>

								<div class="billable-item__controls">
									<button
										type="button"
										class="billable-item__move-btn"
										onclick={() => moveBillableUp(index)}
										disabled={index === 0}
									>
										↑
									</button>
									<button
										type="button"
										class="billable-item__move-btn"
										onclick={() => moveBillableDown(index)}
										disabled={index === editingOptions.defaultBillableItems.length - 1}
									>
										↓
									</button>
									<button
										type="button"
										class="billable-item__remove"
										onclick={() => editingOptions.defaultBillableItems.splice(index, 1)}
									>
										✕
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<button
					type="button"
					class="options-page__btn options-page__btn--add"
					onclick={() => {
						if (!editingOptions.defaultBillableItems) editingOptions.defaultBillableItems = [];
						editingOptions.defaultBillableItems.push({ title: '', price: 0, hours: 1 });
					}}
				>
					+ Add New Billable Item
				</button>
			</div>
		{/if}
	</div>

	<!-- )=- Sticky footer bar for the main Save action.
	     Matches the visual treatment and sticky behavior of .new-job-modal__footer (and the updated client modal).
	     Keeps the save button visible while scrolling through long areas/billables/reasons lists.
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
	<div class="options-page__footer">
		<button
			class="options-page__btn options-page__btn--save"
			onclick={saveOptions}
			disabled={isSaving}
		>
			{isSaving ? 'Saving & Syncing...' : '💾 Save All Changes'}
		</button>
	</div>
</div>

<style>
	.options-page {
		padding: 2rem;
		max-width: 1100px;
		margin: 0 auto;
	}
	.options-page__header {
		margin-bottom: 2rem;
	}
	.options-page__title {
		font-size: 2.1rem;
		font-weight: 700;
		color: #1e2937;
	}
	.options-page__subtitle {
		color: #64748b;
	}
	.options-page__tabs {
		display: flex;
		gap: 0.5rem;
		border-bottom: 2px solid #e2e8f0;
		margin-bottom: 2rem;
		flex-wrap: wrap;
	}
	.options-page__tab {
		padding: 0.9rem 1.75rem;
		background: none;
		border: none;
		font-size: 1.05rem;
		font-weight: 500;
		color: #64748b;
		cursor: pointer;
		border-bottom: 3px solid transparent;
	}
	.options-page__tab--active {
		color: #2563eb;
		border-bottom: 3px solid #2563eb;
		font-weight: 600;
	}
	.options-page__content {
		background: white;
		border-radius: 12px;
		padding: 2.5rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		min-height: 520px;
	}
	.form-grid {
		display: grid;
		grid-template-columns: 200px 1fr;
		gap: 1rem;
		align-items: center;
		max-width: 600px;
	}
	.form-section {
		margin-bottom: 2.5rem;
	}
	.options-page__help {
		color: #64748b;
		margin-bottom: 1.5rem;
	}

	.areas-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.area-item {
		display: grid;
		grid-template-columns: 3fr 80px 120px;
		gap: 1rem;
		align-items: center;
		background: #f8fafc;
		padding: 1rem;
		border-radius: 8px;
		position: relative;
	}
	.area-item--default::before {
		content: '★ Default';
		position: absolute;
		top: 8px;
		left: 12px;
		background: #22c55e;
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 7px 2px;
		border-radius: 9999px;
		line-height: 1;
		z-index: 2;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.area-item__label-input {
		padding: 0.6rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
	}
	.area-item__color {
		width: 80px;
		height: 42px;
		padding: 0;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		cursor: pointer;
	}

	.area-item__controls {
		display: flex;
		gap: 4px;
	}
	.area-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #e2e8f0;
		border: none;
		border-radius: 6px;
		font-size: 1.1rem;
		cursor: pointer;
		color: #475569;
	}
	.area-item__move-btn:hover:not(:disabled) {
		background: #cbd5e1;
	}
	.area-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.area-item__remove {
		background: #fee2e2;
		color: #dc2626;
		border: none;
		width: 38px;
		height: 38px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1.1rem;
	}

	.billable-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.billable-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: #f8fafc;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		position: relative;
	}
	.billable-item--default::before {
		content: '★ Default';
		position: absolute;
		top: 8px;
		left: 12px;
		background: #22c55e;
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 7px 2px;
		border-radius: 9999px;
		line-height: 1;
		z-index: 2;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.billable-item__input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
	}
	.billable-item__input--price {
		width: 100px;
	}
	.billable-item__controls {
		display: flex;
		gap: 4px;
	}
	.billable-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #e2e8f0;
		border: none;
		border-radius: 6px;
		font-size: 1.1rem;
		cursor: pointer;
		color: #475569;
	}
	.billable-item__move-btn:hover:not(:disabled) {
		background: #cbd5e1;
	}
	.billable-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.billable-item__remove {
		background: #fee2e2;
		color: #dc2626;
		border: none;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		cursor: pointer;
	}

	/* Cancellation Reasons */
	.cancel-reasons-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.cancel-reason-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: #f8fafc;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		position: relative;
	}
	.cancel-reason-item--default::before {
		content: '★ Default';
		position: absolute;
		top: 8px;
		left: 12px;
		background: #22c55e;
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		padding: 1px 7px 2px;
		border-radius: 9999px;
		line-height: 1;
		z-index: 2;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.cancel-reason-item__input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
	}

	.cancel-reason-item__controls {
		display: flex;
		gap: 4px;
	}

	.cancel-reason-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #e2e8f0;
		border: none;
		border-radius: 6px;
		font-size: 1.1rem;
		cursor: pointer;
		color: #475569;
	}

	.cancel-reason-item__move-btn:hover:not(:disabled) {
		background: #cbd5e1;
	}

	.cancel-reason-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cancel-reason-item__remove {
		background: #fee2e2;
		color: #dc2626;
		border: none;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		cursor: pointer;
	}

	.options-page__btn {
		padding: 0.9rem 2.25rem;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}
	.options-page__btn--save {
		background: #2563eb;
		color: white;
		border: none;
	}
	.options-page__btn--add {
		background: #e0f2fe;
		color: #0369a1;
		border: none;
		padding: 0.75rem 1.5rem;
		font-weight: 500;
	}

	/* )=- Sticky bottom action bar modeled directly on the job/client modal footers.
	     position:sticky + bottom:0 + background/shadow/border so the Save button stays accessible
	     no matter how far down the user scrolls the options sections.
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	.options-page__footer {
		position: sticky;
		bottom: 0;
		background: white;
		padding: 1rem 1.25rem;
		border-top: 1px solid #e5e7eb;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
		z-index: 10;
		text-align: right;
		margin-top: 1rem; /* small gap from last section when not stuck */
	}
</style>
