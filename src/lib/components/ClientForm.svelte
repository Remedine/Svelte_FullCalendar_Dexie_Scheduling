<!-- src/lib/components/ClientForm.svelte -->
<script lang="ts">
	import { db, type Client, createClient, updateClient } from '$lib/db';
	import { optionsStore } from '$lib/stores/options.svelte';
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
		areaOfTown: z.string().min(1, 'Area of Town is required'),
		preferredBillingMethod: z.enum(['email', 'check', 'invoice'] as const),
		notes: z.string().optional()
	});

	let {
		show = $bindable(false),
		client = $bindable<Client | null>(null),
		onSaved = () => {}
	} = $props();

	const isEditing = $derived(!!client?.id);

	let formData = $state<Partial<Client>>({
		name: '',
		serviceAddressStreet: '',
		serviceAddressCity: '',
		serviceAddressState: 'WA',
		serviceAddressZip: '',
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
	const selectedAreaColor = $derived.by(() => {
		if (!formData.areaOfTown || !areaOptions.length) return '#64748b';
		const area = areaOptions.find((a: any) => a.id === formData.areaOfTown);
		return area?.color || '#64748b';
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
			formData = { ...client };
			hasInitializedNewForm = false;
		} else if (!hasInitializedNewForm && areaOptions.length > 0) {
			// New client + options ready → set first area as default once
			formData = {
				name: '',
				serviceAddressStreet: '',
				serviceAddressCity: '',
				serviceAddressState: 'WA',
				serviceAddressZip: '',
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

		try {
			const clientPayload = {
				...result.data,
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
</script>

{#if show}
	<div class="client-form-modal" onclick={closeForm}>
		<div class="client-form-modal__content" onclick={(e) => e.stopPropagation()}>
			<h2 class="client-form-modal__title">
				{isEditing ? 'Edit Client' : 'New Client'}
			</h2>

			<!-- )=- Fields live in a scrollable form area. The sticky footer (below) sits outside it
			     so Save/Cancel stay visible exactly like the JobFormModal.
			     We use form="client-form" on the submit button so it can live in the sticky footer.
			     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
			<form id="client-form" onsubmit={handleSubmit} class="client-form-modal__form">
				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Full Name <span class="required">*</span></label>
					<input bind:value={formData.name} class="client-form-modal__input" />
					{#if errors.name}<small class="error">{errors.name}</small>{/if}
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Email</label>
					<input type="email" bind:value={formData.email} class="client-form-modal__input" />
					{#if errors.email}<small class="error">{errors.email}</small>{/if}
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Phone</label>
					<input
						type="tel"
						bind:value={formData.phone}
						oninput={(e) => (formData.phone = formatPhone((e.target as HTMLInputElement).value))}
						placeholder="(503) 555-1234"
						class="client-form-modal__input"
					/>
					{#if errors.phone}<small class="error">{errors.phone}</small>{/if}
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Street Address</label>
					<input bind:value={formData.serviceAddressStreet} class="client-form-modal__input" />
				</div>

				<div class="client-form-modal__address-row">
					<div class="client-form-modal__field">
						<label class="client-form-modal__label">City</label>
						<input bind:value={formData.serviceAddressCity} class="client-form-modal__input" />
					</div>
					<div class="client-form-modal__field">
						<label class="client-form-modal__label">State</label>
						<input
							bind:value={formData.serviceAddressState}
							maxlength="2"
							class="client-form-modal__input"
						/>
					</div>
					<div class="client-form-modal__field">
						<label class="client-form-modal__label">ZIP</label>
						<input bind:value={formData.serviceAddressZip} class="client-form-modal__input" />
					</div>
				</div>

				<!-- Area with Colored Left Border -->
				<div class="client-form-modal__field">
					<label class="client-form-modal__label"
						>Area of Town <span class="required">*</span></label
					>
					<div class="area-field-wrapper" style="border-left: 6px solid {selectedAreaColor};">
						<select bind:value={formData.areaOfTown} class="client-form-modal__input area-select">
							<option value="">Select area...</option>
							{#each areaOptions as area}
								<option value={area.id}>{area.label}</option>
							{/each}
						</select>
					</div>
					{#if errors.areaOfTown}<small class="error">{errors.areaOfTown}</small>{/if}
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Preferred Billing</label>
					<select bind:value={formData.preferredBillingMethod} class="client-form-modal__input">
						<option value="email">Email</option>
						<option value="check">Check</option>
						<option value="invoice">Invoice</option>
					</select>
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Notes</label>
					<textarea bind:value={formData.notes} class="client-form-modal__input" rows="4"
					></textarea>
				</div>
			</form>

			<!-- )=- Sticky footer bar (position: sticky + margin-top:auto inside flex column content).
			     Matches JobFormModal__footer exactly for visual + behavior consistency.
			     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
			<div class="client-form-modal__footer">
				<button
					type="button"
					class="client-form-modal__btn client-form-modal__btn--cancel"
					onclick={closeForm}
				>
					Cancel
				</button>
				<button
					type="submit"
					form="client-form"
					class="client-form-modal__btn client-form-modal__btn--primary"
				>
					{isEditing ? 'Save Changes' : 'Create Client'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.client-form-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1200;
	}

	/* )=- Content is now a flex column (like new-job-modal__content) so the form can be flex:1 + overflow auto
	     while the footer is sticky at the bottom inside the scroll container.
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	.client-form-modal__content {
		background: white;
		width: 100%;
		max-width: 560px;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
		max-height: 95vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		container-type: inline-size;
		container-name: client-form;
	}

	.client-form-modal__title {
		margin: 0 0 1.5rem 0;
		font-size: 1.4rem;
		font-weight: 600;
		color: #1e2937;
		padding: 1.5rem 1rem 0;
	}

	/* )=- Scrollable fields container. Matches new-job-modal__form behavior.
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	.client-form-modal__form {
		flex: 1;
		overflow-y: auto;
		padding: 0 1rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.client-form-modal__field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.client-form-modal__address-row {
		display: grid;
		grid-template-columns: 2fr 1fr 1fr;
		gap: 1rem;
	}

	.client-form-modal__label {
		font-weight: 500;
		color: #334155;
		font-size: 0.95rem;
	}

	.client-form-modal__input {
		padding: 0.75rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 1rem;
		width: 100%;
		box-sizing: border-box;
	}

	.error {
		color: #ef4444;
		font-size: 0.85rem;
		margin-top: 4px;
	}

	/* )=- Sticky footer exactly modeled on .new-job-modal__footer (position:sticky, bottom:0, shadow, border, margin-top:auto).
	     Buttons use the existing btn classes (now flex inside the footer).
	     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	.client-form-modal__footer {
		position: sticky;
		bottom: 0;
		background: white;
		padding: 1rem 1.25rem;
		border-top: 1px solid #e5e7eb;
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		align-items: center;
		z-index: 10;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
		margin-top: auto;
	}

	/* Equal width like the previous actions row, while still inside the sticky footer */
	.client-form-modal__footer .client-form-modal__btn {
		flex: 1;
	}

	.client-form-modal__btn {
		padding: 0.85rem 1.5rem;
		border-radius: 8px;
		font-weight: 500;
		border: none;
		cursor: pointer;
	}

	.client-form-modal__btn--cancel {
		background: #f1f5f9;
		color: #475569;
	}

	.client-form-modal__btn--primary {
		background: #3b82f6;
		color: white;
	}

	/* Colored Area Field */
	.area-field-wrapper {
		display: flex;
		align-items: center;
		padding: 0.75rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		background: white;
		min-height: 52px;
	}

	.area-select {
		flex: 1;
		border: none;
		background: transparent;
		padding: 0;
		font-size: 1rem;
		outline: none;
	}

	@container client-form (max-width: 520px) {
		.client-form-modal__address-row {
			grid-template-columns: 1fr;
		}
	}

	@container client-form (min-width: 521px) {
		.client-form-modal__content {
			border-radius: 16px;
			padding: 2rem 0 0; /* top padding now handled by title; footer has its own */
		}
	}
</style>
