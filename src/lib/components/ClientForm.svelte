<!-- src/lib/components/ClientForm.svelte -->
<script lang="ts">
	import { db, type Client, createClient, updateClient } from '$lib/db';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { z } from 'zod';

	const ClientSchema = z.object({
		name: z.string().min(1, 'Full name is required'),
		email: z.string().email('Please enter a valid email').optional().or(z.literal('')),
		phone: z.string()
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

	let isEditing = $derived(!!client?.id);

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

	// Dynamic areas from options
	let areaOptions = $derived(optionsStore.data?.areasOfTown || []);

	function formatPhone(value: string): string {
		const digits = value.replace(/\D/g, '');
		if (digits.length === 0) return '';
		if (digits.length <= 3) return `(${digits}`;
		if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
		return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
	}

	$effect(() => {
		if (client) {
			formData = { ...client };
		} else {
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
		}
		errors = {};
	});

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		errors = {};

		const result = ClientSchema.safeParse(formData);
		if (!result.success) {
			result.error.issues.forEach(issue => {
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
	<div class="client-form-modal">
		<div class="client-form-modal__content">
			<h2 class="client-form-modal__title">
				{isEditing ? 'Edit Client' : 'New Client'}
			</h2>

			<form onsubmit={handleSubmit} class="client-form-modal__form">
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
						oninput={(e) => formData.phone = formatPhone((e.target as HTMLInputElement).value)}
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
						<input bind:value={formData.serviceAddressState} maxlength="2" class="client-form-modal__input" />
					</div>
					<div class="client-form-modal__field">
						<label class="client-form-modal__label">ZIP</label>
						<input bind:value={formData.serviceAddressZip} class="client-form-modal__input" />
					</div>
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Area of Town <span class="required">*</span></label>
					<select bind:value={formData.areaOfTown} class="client-form-modal__input">
						{#each areaOptions as area}
							<option value={area.id}>{area.label}</option>
						{/each}
					</select>
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
					<textarea bind:value={formData.notes} class="client-form-modal__input" rows="4"></textarea>
				</div>

				<div class="client-form-modal__actions">
					<button type="button" class="client-form-modal__btn client-form-modal__btn--cancel" onclick={closeForm}>
						Cancel
					</button>
					<button type="submit" class="client-form-modal__btn client-form-modal__btn--primary">
						{isEditing ? 'Save Changes' : 'Create Client'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	/* Your existing styles (unchanged) */
	.client-form-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1200;
	}

	.client-form-modal__content {
		background: white;
		width: 100%;
		max-width: 560px;
		border-radius: 16px 16px 0 0;
		max-height: 95vh;
		overflow-y: auto;
		padding: 1.5rem 1rem;
		container-type: inline-size;
		container-name: client-form;
	}

	.client-form-modal__title {
		margin: 0 0 1.5rem;
		font-size: 1.4rem;
		font-weight: 600;
		color: #1e2937;
	}

	.client-form-modal__form {
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
		box-sizing: box-sizing;
	}

	.error {
		color: #ef4444;
		font-size: 0.85rem;
		margin-top: 4px;
	}

	.client-form-modal__actions {
		display: flex;
		gap: 1rem;
		margin-top: 2rem;
	}

	.client-form-modal__btn {
		flex: 1;
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

	@container client-form (max-width: 520px) {
		.client-form-modal__address-row {
			grid-template-columns: 1fr;
		}
	}

	@container client-form (min-width: 521px) {
		.client-form-modal__content {
			border-radius: 16px;
			padding: 2rem;
		}
	}
</style>