<!-- src/lib/components/ClientForm.svelte -->
<script lang="ts">
	import { type Client, createClient, updateClient, deleteClient } from '$lib/db';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { z } from 'zod';

	const ClientSchema = z.object({
		name: z.string().min(1, 'Full name is required'),
		email: z.string().email('Please enter a valid email').optional().or(z.literal('')),
		phone: z
			.string()
			.regex(/^[\d\s\-\(\)\.]*$/, 'Phone can only contain numbers and formatting characters')
			.optional()
			.or(z.literal('')),
		serviceAddressStreet: z.string().optional(),
		serviceAddressCity: z.string().optional(),
		serviceAddressState: z.string().length(2, 'State must be 2 letters').optional(),
		serviceAddressZip: z.string().optional(),
		useBillingAddress: z.boolean().optional(),
		billingAddressStreet: z.string().optional(),
		billingAddressCity: z.string().optional(),
		billingAddressState: z.string().length(2, 'State must be 2 letters').optional().or(z.literal('')),
		billingAddressZip: z.string().optional(),
		areaOfTown: z.string().min(1, 'Area of Town is required'),
		preferredBillingMethod: z.enum(['email', 'check', 'invoice'] as const),
		notes: z.string().optional()
	});

	let {
		show = $bindable(false),
		client = $bindable<Client | null>(null),
		canDelete = false,
		onSaved = () => {},
		onDeleted = () => {}
	} = $props();

	const isEditing = $derived(!!client?.id);

	let formData = $state<Partial<Client>>({
		name: '',
		serviceAddressStreet: '',
		serviceAddressCity: '',
		serviceAddressState: 'AK',
		serviceAddressZip: '',
		useBillingAddress: false,
		billingAddressStreet: '',
		billingAddressCity: '',
		billingAddressState: 'AK',
		billingAddressZip: '',
		areaOfTown: '',
		preferredBillingMethod: 'email',
		phone: '',
		email: '',
		notes: ''
	});

	let errors = $state<Record<string, string>>({});

	// )=- Robust derived value supporting both array and Record shapes from optionsStore
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	const areaOptions = $derived.by(() => {
		const raw = optionsStore.data?.areasOfTown;
		if (!raw) return [];
		if (Array.isArray(raw)) return raw;
		return Object.entries(raw).map(([id, val]: [string, any]) => ({ id, ...val }));
	});

	// )=- Explicit derived color so the left border updates instantly when user changes the dropdown
	// Uses getDisplayAreaColor for automatic dark mode adaptation.
	const selectedAreaColor = $derived.by(() => {
		if (!formData.areaOfTown || !areaOptions.length) return '#64748b';
		const area = areaOptions.find((a: any) => a.id === formData.areaOfTown);
		return getDisplayAreaColor(area?.color);
	});

	// Safe trigger to ensure options are loaded when the form opens
	$effect(() => {
		if (show && !optionsStore.data && !optionsStore.isLoading) {
			optionsStore.load();
		}
	});

	// )=- One-time initialization using a flag (prevents effect_update_depth_exceeded)
	let hasInitializedNewForm = $state(false);

	$effect(() => {
		if (!show) {
			hasInitializedNewForm = false;
			return;
		}

		if (client?.id) {
			// Editing existing client
			formData = {
				...client,
				useBillingAddress: !!client.useBillingAddress
			};
			hasInitializedNewForm = false;
		} else if (!hasInitializedNewForm && areaOptions.length > 0) {
			// New client + options ready → set first area as default once
			formData = {
				name: '',
				serviceAddressStreet: '',
				serviceAddressCity: '',
				serviceAddressState: 'AK',
				serviceAddressZip: '',
				useBillingAddress: false,
				billingAddressStreet: '',
				billingAddressCity: '',
				billingAddressState: 'AK',
				billingAddressZip: '',
				areaOfTown: areaOptions[0]?.id || '',
				preferredBillingMethod: 'email',
				phone: '',
				email: '',
				notes: ''
			};
			hasInitializedNewForm = true;
		}

		errors = {};
	});

	function formatPhone(value: string): string {
		const digits = value.replace(/\D/g, '');
		if (digits.length === 0) return '';
		if (digits.length <= 3) return `(${digits}`;
		if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
		return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errors = {};

		const result = ClientSchema.safeParse(formData);
		if (!result.success) {
			result.error.issues.forEach((issue) => {
				const field = issue.path[0] as string;
				errors[field] = issue.message;
			});
			return;
		}

		if (formData.useBillingAddress) {
			if (!formData.billingAddressStreet?.trim()) errors.billingAddressStreet = 'Street is required';
			if (!formData.billingAddressCity?.trim()) errors.billingAddressCity = 'City is required';
			if (!formData.billingAddressState?.trim() || formData.billingAddressState.length !== 2) {
				errors.billingAddressState = 'State must be 2 letters';
			}
			if (!formData.billingAddressZip?.trim()) errors.billingAddressZip = 'ZIP is required';
			if (Object.keys(errors).length) return;
		}

		try {
			const useBilling = !!formData.useBillingAddress;
			const clientPayload = {
				...result.data,
				useBillingAddress: useBilling,
				billingAddressStreet: useBilling ? formData.billingAddressStreet?.trim() || '' : '',
				billingAddressCity: useBilling ? formData.billingAddressCity?.trim() || '' : '',
				billingAddressState: useBilling ? formData.billingAddressState?.trim() || '' : '',
				billingAddressZip: useBilling ? formData.billingAddressZip?.trim() || '' : '',
				createdAt: client?.createdAt || new Date(),
				updatedAt: new Date()
			} as Client;

			if (isEditing && client?.id) {
				await updateClient(client.id, clientPayload);
			} else {
				await createClient(clientPayload);
			}

			onSaved();
		} catch (err) {
			console.error(err);
			alert('❌ Error saving client');
		}
	}

	function closeForm() {
		show = false;
	}

	async function handleDelete() {
		if (!isEditing || !client?.id || !canDelete) return;
		if (!confirm('Delete this client? This action cannot be undone.')) return;

		try {
			await deleteClient(client.id);
			onDeleted();
			show = false;
		} catch (err) {
			console.error(err);
			alert('❌ Error deleting client');
		}
	}
</script>

{#if show}
	<div class="modal-overlay client-form-modal" role="presentation" onclick={closeForm}>
		<div class="modal-content client-form-modal__content" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
			<h2 class="client-form-modal__title">
				{isEditing ? 'Edit Client' : 'New Client'}
			</h2>

			<!-- )=- Fields live in a scrollable form area. The sticky footer (below) sits outside it
			     so Save/Cancel stay visible exactly like the JobFormModal.
			     We use form="client-form" on the submit button so it can live in the sticky footer.
			     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
			<form id="client-form" onsubmit={handleSubmit} class="client-form-modal__form">
				<div class="client-form-modal__field">
					<label class="client-form-modal__label label">
						Full Name <span class="required">*</span>
						<input bind:value={formData.name} class="client-form-modal__input input" />
					</label>
					{#if errors.name}<small class="error">{errors.name}</small>{/if}
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label label">
						Email
						<input type="email" bind:value={formData.email} class="client-form-modal__input input" />
					</label>
					{#if errors.email}<small class="error">{errors.email}</small>{/if}
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label label">
						Phone
						<input
							type="tel"
							bind:value={formData.phone}
							oninput={(e) => (formData.phone = formatPhone((e.target as HTMLInputElement).value))}
							placeholder="(503) 555-1234"
							class="client-form-modal__input input"
						/>
					</label>
					{#if errors.phone}<small class="error">{errors.phone}</small>{/if}
				</div>

				<div class="client-form-modal__section-title">Service Address</div>
				<p class="client-form-modal__help">Where work is performed. Used as Bill To on invoices unless billing address is set.</p>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label label">
						Street Address
						<input bind:value={formData.serviceAddressStreet} class="client-form-modal__input input" />
					</label>
				</div>

				<div class="client-form-modal__address-row">
					<div class="client-form-modal__field">
						<label class="client-form-modal__label label">
							City
							<input bind:value={formData.serviceAddressCity} class="client-form-modal__input input" />
						</label>
					</div>
					<div class="client-form-modal__field">
						<label class="client-form-modal__label label">
							State
							<input
								bind:value={formData.serviceAddressState}
								maxlength="2"
								class="client-form-modal__input input"
							/>
						</label>
					</div>
					<div class="client-form-modal__field">
						<label class="client-form-modal__label label">
							ZIP
							<input bind:value={formData.serviceAddressZip} class="client-form-modal__input input" />
						</label>
					</div>
				</div>

				<div class="client-form-modal__field client-form-modal__checkbox-field">
					<label class="client-form-modal__checkbox-label">
						<input type="checkbox" bind:checked={formData.useBillingAddress} />
						Billing Address (separate from service address)
					</label>
				</div>

				{#if formData.useBillingAddress}
					<div class="client-form-modal__billing-block">
						<div class="client-form-modal__field">
							<label class="client-form-modal__label label">
								Billing Street
								<input
									bind:value={formData.billingAddressStreet}
									class="client-form-modal__input input"
								/>
							</label>
							{#if errors.billingAddressStreet}<small class="error">{errors.billingAddressStreet}</small>{/if}
						</div>

						<div class="client-form-modal__address-row">
							<div class="client-form-modal__field">
								<label class="client-form-modal__label label">
									City
									<input
										bind:value={formData.billingAddressCity}
										class="client-form-modal__input input"
									/>
								</label>
								{#if errors.billingAddressCity}<small class="error">{errors.billingAddressCity}</small>{/if}
							</div>
							<div class="client-form-modal__field">
								<label class="client-form-modal__label label">
									State
									<input
										bind:value={formData.billingAddressState}
										maxlength="2"
										class="client-form-modal__input input"
									/>
								</label>
								{#if errors.billingAddressState}<small class="error">{errors.billingAddressState}</small>{/if}
							</div>
							<div class="client-form-modal__field">
								<label class="client-form-modal__label label">
									ZIP
									<input
										bind:value={formData.billingAddressZip}
										class="client-form-modal__input input"
									/>
								</label>
								{#if errors.billingAddressZip}<small class="error">{errors.billingAddressZip}</small>{/if}
							</div>
						</div>
					</div>
				{/if}

				<!-- Area with Colored Left Border -->
				<div class="client-form-modal__field">
					<label for="area-of-town" class="client-form-modal__label label"
						>Area of Town <span class="required">*</span></label
					>
					<div class="area-field-wrapper" style="border-left: 6px solid {selectedAreaColor};">
						<select id="area-of-town" bind:value={formData.areaOfTown} class="area-select input">
							<option value="">Select area...</option>
							{#each areaOptions as area}
								<option 
									value={area.id}
									style="color: {getDisplayAreaColor(area.color)};"
								>■ {area.label}</option>
							{/each}
						</select>
					</div>
					{#if errors.areaOfTown}<small class="error">{errors.areaOfTown}</small>{/if}
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label label">
						Preferred Billing
						<select bind:value={formData.preferredBillingMethod} class="client-form-modal__input input">
							<option value="email">Email</option>
							<option value="check">Check</option>
							<option value="invoice">Invoice</option>
						</select>
					</label>
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label label">
						Notes
						<textarea bind:value={formData.notes} class="client-form-modal__input input" rows="4"
						></textarea>
					</label>
				</div>
			</form>

			<!-- )=- Sticky footer bar (position: sticky + margin-top:auto inside flex column content).
			     Matches JobFormModal__footer exactly for visual + behavior consistency.
			     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
			<div class="client-form-modal__footer sticky-footer">
				<div class="client-form-modal__footer-primary">
					<button
						type="button"
						class="client-form-modal__btn client-form-modal__btn--cancel button button--ghost"
						onclick={closeForm}
					>
						Cancel
					</button>
					<button
						type="submit"
						form="client-form"
						class="client-form-modal__btn client-form-modal__btn--primary button button--primary"
					>
						{isEditing ? 'Save Changes' : 'Create Client'}
					</button>
				</div>
				{#if isEditing && canDelete}
					<div class="client-form-modal__footer-secondary">
						<button
							type="button"
							class="client-form-modal__text-action client-form-modal__text-action--danger"
							onclick={handleDelete}
						>
							Delete Client
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ClientForm standardized to tokens + base primitives for full cohesion (Phase 2 of overhaul).
	   Follows same pattern as JobFormModal / JobDetailsModal. */

	/* Base client-form-modal shell now uses global .modal-overlay + .modal-content.
	   Container query and other BEM kept for specifics. */

	.client-form-modal__title {
		margin: 0 0 var(--space-6) 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		padding: var(--space-6) var(--space-4) 0;
	}

	.client-form-modal__form {
		flex: 1;
		overflow-y: auto;
		padding: 0 var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.client-form-modal__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.client-form-modal__section-title {
		margin: 0;
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.client-form-modal__help {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.4;
	}

	.client-form-modal__address-row {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr;
		gap: var(--space-4);
	}

	.client-form-modal__checkbox-field {
		margin-top: var(--space-1);
	}

	.client-form-modal__checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
	}

	.client-form-modal__billing-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface-alt);
	}

	.client-form-modal__label {
		/* inherits from .label in globals */
	}

	.client-form-modal__input {
		/* inherits from .input in globals */
	}

	.error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin-top: var(--space-1);
	}

	.client-form-modal__footer {
		/* base from .sticky-footer global */
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
	}

	.client-form-modal__footer-primary {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		align-items: center;
		width: 100%;
	}

	.client-form-modal__footer-primary .client-form-modal__btn {
		flex: 1;
	}

	.client-form-modal__footer-secondary {
		display: flex;
		justify-content: flex-end;
		width: 100%;
	}

	.client-form-modal__text-action {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-decoration: underline;
		opacity: 0.9;
	}

	.client-form-modal__text-action--danger {
		color: var(--color-danger);
	}

	.client-form-modal__text-action:hover {
		opacity: 1;
	}

	.client-form-modal__btn {
		padding: var(--space-3) var(--space-6);
		border-radius: var(--radius-md);
		font-weight: var(--font-weight-medium);
		border: none;
		cursor: pointer;
	}

	.client-form-modal__btn--cancel {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}

	.client-form-modal__btn--primary {
		background: var(--color-primary);
		color: white;
	}

	/* Colored Area Field - uses display-adapted color in dark. Styled consistently with job form version. */
	.area-field-wrapper {
		display: flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		min-height: 44px;
		transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
	}

	.area-field-wrapper:focus-within {
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}

	.area-select {
		flex: 1;
		border: none;
		background: transparent;
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-base);
		color: var(--color-text);
		outline: none;
		cursor: pointer;
		width: 100%;
		appearance: none;
	}

	.area-select option {
		background: var(--color-surface);
	}

	@container client-form (max-width: 520px) {
		.client-form-modal__address-row {
			grid-template-columns: 1fr;
		}
	}

	@container client-form (min-width: 521px) {
		.client-form-modal__content {
			border-radius: var(--radius-xl);
			padding: var(--space-8) 0 0;
		}
	}
</style>
