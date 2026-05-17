<!-- src/lib/components/ClientForm.svelte -->
<script lang="ts">
	import { db, type Client } from '$lib/db';
	import { BUSINESS_CONFIG } from '$lib/config';

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
		areaOfTown: 'thane',
		preferredBillingMethod: 'email',
		phone: '',
		email: '',
		notes: ''
	});

	// )=- Reset / load form data when client changes
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
				areaOfTown: 'thane',
				preferredBillingMethod: 'email',
				phone: '',
				email: '',
				notes: ''
			};
		}
	});

	// )=- Form submit handler
	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();

		if (!formData.name?.trim()) {
			alert('Client name is required');
			return;
		}
		if (!formData.phone?.trim() && !formData.email?.trim()) {
			alert('At least one contact method (Phone or Email) is required');
			return;
		}

		try {
			const clientPayload = {
				...formData,
				createdAt: client?.createdAt || new Date(),
				updatedAt: new Date()
			} as Client;

			if (isEditing && client?.id) {
				await db.clients.update(client.id, clientPayload);
				console.log(`✅ Client ${client.id} updated`);
			} else {
				await db.clients.add(clientPayload);
				console.log('✅ New client created');
			}

			onSaved();
		} catch (err) {
			console.error('Failed to save client', err);
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
					<input bind:value={formData.name} class="client-form-modal__input" placeholder="John Smith" required />
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Email</label>
					<input type="email" bind:value={formData.email} class="client-form-modal__input" placeholder="john@example.com" />
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Phone</label>
					<input type="tel" bind:value={formData.phone} class="client-form-modal__input" placeholder="(360) 555-1234" />
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Street Address</label>
					<input bind:value={formData.serviceAddressStreet} class="client-form-modal__input" />
				</div>

				<div class="client-form-modal__field-group">
					<div class="client-form-modal__field">
						<label class="client-form-modal__label">City</label>
						<input bind:value={formData.serviceAddressCity} class="client-form-modal__input" />
					</div>
					<div class="client-form-modal__field">
						<label class="client-form-modal__label">State</label>
						<input bind:value={formData.serviceAddressState} class="client-form-modal__input" maxlength="2" />
					</div>
					<div class="client-form-modal__field">
						<label class="client-form-modal__label">ZIP</label>
						<input bind:value={formData.serviceAddressZip} class="client-form-modal__input" />
					</div>
				</div>

				<div class="client-form-modal__field">
					<label class="client-form-modal__label">Area of Town</label>
					<select bind:value={formData.areaOfTown} class="client-form-modal__input">
						{#each Object.entries(BUSINESS_CONFIG.areasOfTown) as [key, area]}
							<option value={key}>{area.label}</option>
						{/each}
					</select>
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
					<button 
						type="button"
						class="client-form-modal__btn client-form-modal__btn--cancel" 
						onclick={closeForm}
					>
						Cancel
					</button>
					<button 
						type="submit"
						class="client-form-modal__btn client-form-modal__btn--primary"
					>
						{isEditing ? 'Save Changes' : 'Create Client'}
					</button>
				</div>
			</form>
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

	.client-form-modal__field-group {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}

	.client-form-modal__label {
		font-weight: 500;
		color: #334155;
		font-size: 0.95rem;
	}

	.required {
		color: #ef4444;
		font-size: 0.9rem;
	}

	.client-form-modal__input {
		padding: 0.75rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 1rem;
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

	@container client-form (min-width: 520px) {
		.client-form-modal__content {
			border-radius: 16px;
			padding: 2rem;
		}
		.client-form-modal__field-group {
			grid-template-columns: 1fr 1fr 1fr;
		}
	}
</style>