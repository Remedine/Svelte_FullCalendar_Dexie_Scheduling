<!-- src/routes/(app)/admin/options/+page.svelte -->
<script lang="ts">
	// )=- Complete Options Page - All sections active with dynamic data
	// )=- Cleaned up redundant role guards and legacy onMount (causing load-time errors and potential auth redirects on navigation).
	// Central layout guard in (app)/+layout.svelte now handles admin-only access consistently.
	import { optionsStore } from '$lib/stores/options.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		hour12To24,
		hour24To12,
		type Hour12Period
	} from '$lib/utils/dates';

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
	let crewAssignmentHour12 = $state(7);
	let crewAssignmentPeriod = $state<Hour12Period>('AM');

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
		const hour24 = Number(editingOptions.crewAssignmentHour);
		if (!Number.isNaN(hour24) && hour24 >= 0 && hour24 <= 23) {
			const { hour12, period } = hour24To12(hour24);
			crewAssignmentHour12 = hour12;
			crewAssignmentPeriod = period;
		}
	});

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
				crewAssignmentDaysBefore: 1,
				crewAssignmentHour: 7,
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

		const daysBefore = Number(editingOptions.crewAssignmentDaysBefore);
		const hour12 = Number(crewAssignmentHour12);
		if (Number.isNaN(daysBefore) || daysBefore < 0 || daysBefore > 365) {
			toast.error('Crew notification days-before must be between 0 and 365.');
			return;
		}
		if (Number.isNaN(hour12) || hour12 < 1 || hour12 > 12) {
			toast.error('Crew notification time must be between 1 and 12.');
			return;
		}
		if (crewAssignmentPeriod !== 'AM' && crewAssignmentPeriod !== 'PM') {
			toast.error('Select AM or PM for crew notification time.');
			return;
		}
		const hour = hour12To24(hour12, crewAssignmentPeriod);
		if (Number.isNaN(hour)) {
			toast.error('Invalid crew notification time.');
			return;
		}

		isSaving = true;

		try {
			const updated = {
				...editingOptions,
				crewAssignmentHour: hour,
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
					<label for="opt-duration" class="label">Default Job Duration (hours)</label>
					<input
						id="opt-duration"
						type="number"
						step="0.25"
						class="input"
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
									class="area-item__label-input input"
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

			<div class="form-section">
				<h3>Crew Assignment Notifications</h3>
				<p class="options-page__help">
					When crew are assigned to a job, an email is queued for each crew member (using their
					account email) and sent at the scheduled time — not immediately. This is independent of
					client billing preferences.
				</p>
				<div class="form-grid">
					<label for="opt-crew-days" class="label">Send days before job</label>
					<input
						id="opt-crew-days"
						type="number"
						min="0"
						max="365"
						class="input"
						bind:value={editingOptions.crewAssignmentDaysBefore}
					/>
					<label for="opt-crew-hour" class="label">Send at time (AM/PM, local)</label>
					<div class="options-page__time-row">
						<input
							id="opt-crew-hour"
							type="number"
							min="1"
							max="12"
							class="input options-page__time-hour"
							bind:value={crewAssignmentHour12}
						/>
						<select
							id="opt-crew-period"
							class="input options-page__time-period"
							bind:value={crewAssignmentPeriod}
						>
							<option value="AM">AM</option>
							<option value="PM">PM</option>
						</select>
					</div>
				</div>
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
									class="cancel-reason-item__input input"
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
					<label for="opt-tax" class="label">Tax Rate (%)</label>
					<input id="opt-tax" type="number" step="0.01" class="input" bind:value={editingOptions.taxRate} />
					<label for="opt-due" class="label">Invoice Due Days</label>
					<input id="opt-due" type="number" class="input" bind:value={editingOptions.invoiceDueDays} />
				</div>
				<p class="options-page__help">
					Invoices are generated for owner review first. Use <strong>Send to Client</strong> in the job
					invoice panel after tweaking the Word doc. Email send is only offered when the client's
					preferred billing method is <strong>email</strong>.
				</p>
			</div>

			<div class="form-section">
				<h3>Default Billable Items</h3>
				<p class="options-page__help">The first item is default for dropdown lists.</p>

				{#if editingOptions?.defaultBillableItems?.length}
					<div class="billable-list">
						{#each editingOptions.defaultBillableItems as item, index (index)}
							<div class="billable-item {isDefaultBillable(index) ? 'billable-item--default' : ''}">
								<input
									class="billable-item__input input"
									bind:value={item.title}
									placeholder="Service name"
								/>
								<div class="billable-item__type-toggle">
									<button
										type="button"
										class="billable-item__type-btn"
										class:active={item.hours === undefined}
										onclick={() => {
											if (item.hours !== undefined) {
												item.quantity = item.hours ?? 1;
												delete item.hours;
											}
										}}
									>
										Per Qty
									</button>
									<button
										type="button"
										class="billable-item__type-btn"
										class:active={item.hours !== undefined}
										onclick={() => {
											if (item.hours === undefined) {
												item.hours = item.quantity ?? 1;
												delete item.quantity;
											}
										}}
									>
										Per Hour
									</button>
								</div>
								<div class="billable-item__price">
									<span>{item.hours !== undefined ? '$' : '#'}</span>
									<input
										type="number"
										class="billable-item__input billable-item__input--price input"
										bind:value={item.price}
										onfocus={(e) => {
											if (item.price === 0) {
												e.currentTarget.select();
											}
										}}
									/>
								</div>

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
						editingOptions.defaultBillableItems.push({ title: '', price: 0, quantity: 1 });
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
		padding: var(--space-6) var(--space-4);
		max-width: 1100px;
		margin: 0 auto;
	}
	.options-page__header {
		margin-bottom: var(--space-8);
	}
	.options-page__title {
		font-size: var(--font-size-3xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-text);
	}
	.options-page__subtitle {
		color: var(--color-text-muted);
	}
	.options-page__tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 2px solid var(--color-border);
		margin-bottom: var(--space-8);
		flex-wrap: wrap;
	}
	.options-page__tab {
		padding: var(--space-3) var(--space-6);
		background: none;
		border: none;
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
		cursor: pointer;
		border-bottom: 3px solid transparent;
		transition: all var(--transition-fast);
	}
	.options-page__tab:hover {
		color: var(--color-text);
	}
	.options-page__tab--active {
		color: var(--color-primary);
		border-bottom: 3px solid var(--color-primary);
		font-weight: var(--font-weight-semibold);
	}
	.options-page__content {
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		padding: var(--space-6);
		box-shadow: var(--shadow-sm);
		min-height: 520px;
	}
	.form-grid {
		display: grid;
		grid-template-columns: minmax(8rem, 12rem) 1fr;
		gap: var(--space-4);
		align-items: center;
		max-width: 600px;
	}
	.options-page__time-row {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.options-page__time-hour {
		width: 5rem;
		flex-shrink: 0;
	}
	.options-page__time-period {
		width: auto;
		min-width: 5.5rem;
	}
	.form-section {
		margin-bottom: var(--space-8);
	}
	.options-page__help {
		color: var(--color-text-muted);
		margin-bottom: var(--space-6);
	}

	.options-page__checkbox-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	.options-page__checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.areas-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}
	.area-item {
		display: grid;
		grid-template-columns: 3fr 5rem 8rem;
		gap: var(--space-4);
		align-items: center;
		background: var(--color-surface-alt);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		position: relative;
	}
	.area-item--default::before {
		content: '★ Default';
		position: absolute;
		top: var(--space-2);
		left: var(--space-3);
		background: var(--color-success);
		color: white;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		padding: 1px 7px 2px;
		border-radius: var(--radius-full);
		line-height: 1;
		z-index: 2;
		box-shadow: var(--shadow-sm);
	}

	.area-item__label-input {
		/* inherits global .input */
	}
	.area-item__color {
		width: 5rem;
		height: var(--space-8);
		padding: 0;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		cursor: pointer;
		background: var(--color-surface);
	}

	.area-item__controls {
		display: flex;
		gap: var(--space-1);
	}
	.area-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-alt);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-lg);
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.area-item__move-btn:hover:not(:disabled) {
		background: var(--color-border);
	}
	.area-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.area-item__remove {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: none;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.billable-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}
	.billable-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--color-surface-alt);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		position: relative;
	}
	.billable-item--default::before {
		content: '★ Default';
		position: absolute;
		top: var(--space-2);
		left: var(--space-3);
		background: var(--color-success);
		color: white;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		padding: 1px 7px 2px;
		border-radius: var(--radius-full);
		line-height: 1;
		z-index: 2;
		box-shadow: var(--shadow-sm);
	}

	.billable-item__input {
		/* inherits global .input */
		flex: 1;
		min-width: 140px; /* prevent title from collapsing too small */
	}
	.billable-item__input--price {
		width: 90px;
	}
	.billable-item__price {
		flex-shrink: 0;
	}
	.billable-item__type-toggle {
		display: flex;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		overflow: hidden;
		flex-shrink: 0;
		font-size: var(--font-size-xs);
	}
	.billable-item__type-btn {
		padding: var(--space-1) var(--space-2);
		border: none;
		background: var(--color-surface);
		color: var(--color-text-muted);
		cursor: pointer;
		transition: background var(--transition-fast), color var(--transition-fast);
		white-space: nowrap;
	}
	.billable-item__type-btn + .billable-item__type-btn {
		border-left: 1px solid var(--color-border-strong);
	}
	.billable-item__type-btn.active {
		background: var(--color-primary);
		color: white;
	}
	.billable-item__type-btn:hover:not(.active) {
		background: var(--color-surface-alt);
	}
	.billable-item__controls {
		display: flex;
		gap: var(--space-1);
		flex-shrink: 0;
	}
	.billable-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-alt);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-lg);
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.billable-item__move-btn:hover:not(:disabled) {
		background: var(--color-border);
	}
	.billable-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.billable-item__remove {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: none;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	/* Cancellation Reasons */
	.cancel-reasons-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}

	.cancel-reason-item {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--color-surface-alt);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		position: relative;
	}
	.cancel-reason-item--default::before {
		content: '★ Default';
		position: absolute;
		top: var(--space-2);
		left: var(--space-3);
		background: var(--color-success);
		color: white;
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-bold);
		padding: 1px 7px 2px;
		border-radius: var(--radius-full);
		line-height: 1;
		z-index: 2;
		box-shadow: var(--shadow-sm);
	}

	.cancel-reason-item__input {
		/* inherits global .input */
		flex: 1;
	}

	.cancel-reason-item__controls {
		display: flex;
		gap: var(--space-1);
	}

	.cancel-reason-item__move-btn {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-surface-alt);
		border: none;
		border-radius: var(--radius-sm);
		font-size: var(--font-size-lg);
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.cancel-reason-item__move-btn:hover:not(:disabled) {
		background: var(--color-border);
	}

	.cancel-reason-item__move-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.cancel-reason-item__remove {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border: none;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	.options-page__btn {
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-md);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}
	.options-page__btn--save {
		background: var(--color-primary);
		color: white;
		border: none;
	}
	.options-page__btn--add {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		border: none;
		padding: var(--space-3) var(--space-6);
		font-weight: var(--font-weight-medium);
	}

	/* )=- Sticky bottom action bar modeled directly on the job/client modal footers.
	     position:sticky + bottom:0 + background/shadow/border so the Save button stays accessible
	     no matter how far down the user scrolls the options sections.
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	.options-page__footer {
		position: sticky;
		bottom: 0;
		background: var(--color-surface);
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--color-border);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
		z-index: 10;
		text-align: right;
		margin-top: var(--space-4);
	}

	/* ============================================
	   MOBILE RESPONSIVE (match crew/clients/jobs)
	   - Tighten padding
	   - Stack form grids (labels above fields)
	   - Collapse area / billable / cancel rows into mobile cards
	   - Full-width add + save actions where helpful
	   - BEM + tokens only. 768px matches layout bottom-nav breakpoint.
	   ============================================ */
	@media (max-width: 768px) {
		.options-page {
			padding: var(--space-3) var(--space-2);
		}

		.options-page__header {
			margin-bottom: var(--space-4);
		}

		.options-page__title {
			font-size: var(--font-size-2xl);
		}

		.options-page__tabs {
			margin-bottom: var(--space-4);
			gap: var(--space-1);
		}

		.options-page__tab {
			padding: var(--space-2) var(--space-4);
			font-size: var(--font-size-sm);
		}

		.options-page__content {
			padding: var(--space-4);
			min-height: auto;
		}

		.form-section {
			margin-bottom: var(--space-6);
		}

		.options-page__help {
			margin-bottom: var(--space-4);
			font-size: var(--font-size-sm);
		}

		/* Billing & tax: stack label + input vertically */
		.form-grid {
			grid-template-columns: 1fr;
			gap: var(--space-2);
			max-width: 100%;
		}

		/* Areas of Town - wrap to avoid squeezing color + controls */
		.areas-list {
			gap: var(--space-2);
			margin-bottom: var(--space-4);
		}
		.area-item {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-3);
		}
		.area-item__label-input {
			flex: 1 1 55%;
			min-width: 120px;
		}
		.area-item__color {
			width: 2.75rem;
			height: 2.25rem;
		}
		.area-item__controls {
			margin-left: auto;
			gap: var(--space-2);
		}
		.area-item__move-btn,
		.area-item__remove {
			width: 36px;
			height: 36px;
			font-size: var(--font-size-base);
		}

		/* Default Billable Items - title full width on own line, then type + price + controls share a row */
		.billable-list {
			gap: var(--space-2);
			margin-bottom: var(--space-4);
		}
		.billable-item {
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-3);
		}
		.billable-item__input {
			flex: 1 0 100%;
			width: 100%;
			min-width: 0;
			margin-bottom: var(--space-1);
		}
		.billable-item__type-toggle {
			flex-shrink: 0;
		}
		.billable-item__price {
			display: flex;
			align-items: center;
			gap: var(--space-1);
			flex-shrink: 0;
		}
		.billable-item__controls {
			display: flex;
			gap: var(--space-2);
			margin-left: auto;
			flex-shrink: 0;
		}
		.billable-item__move-btn,
		.billable-item__remove {
			width: 36px;
			height: 36px;
		}
		.billable-item__type-btn {
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-xs);
		}

		/* Cancellation Reasons - stack input, controls below */
		.cancel-reasons-list {
			gap: var(--space-2);
			margin-bottom: var(--space-4);
		}
		.cancel-reason-item {
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-3);
		}
		.cancel-reason-item__input {
			width: 100%;
			flex: 1 1 100%;
		}
		.cancel-reason-item__controls {
			width: 100%;
			justify-content: flex-end;
			gap: var(--space-2);
		}
		.cancel-reason-item__move-btn,
		.cancel-reason-item__remove {
			width: 36px;
			height: 36px;
		}

		/* Add buttons become prominent full-width taps on mobile */
		.options-page__btn--add {
			width: 100%;
			justify-content: center;
		}

		.options-page__footer {
			padding: var(--space-3) var(--space-4);
			text-align: center;
		}
		.options-page__btn--save {
			width: 100%;
		}
	}
</style>
