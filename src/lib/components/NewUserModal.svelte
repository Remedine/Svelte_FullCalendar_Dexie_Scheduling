<!-- src/lib/components/NewUserModal.svelte -->
<script lang="ts">
	// )=- Admin creates crew/admin users with firstName, lastName, email, role + temp password.
	// User logs in first time with email + temp password (verifies account), then sets their real password via /profile.
	// forcePhotoUpdate can still be toggled by admin later via Crew edit.
	// )=- No PIN anywhere (PIN login completely removed; only email/password auth).
	// Zod for the admin creation form. BEM + runes used.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	import { createUser } from '$lib/db';
	import { z } from 'zod';

	interface Props {
		onClose: (success?: boolean) => void;
	}

	const { onClose }: Props = $props();

	let firstName = $state('');
	let lastName = $state('');
	let email = $state('');
	let role = $state<'admin' | 'crew'>('crew');

	// )=- Zod schema for admin-only creation fields (no PIN - PIN login completely removed; password is for initial email verification only).
	const NewUserSchema = z.object({
		firstName: z.string().min(1, 'First name is required'),
		lastName: z.string().min(1, 'Last name is required'),
		email: z.string().email('Please enter a valid email'),
		role: z.enum(['admin', 'crew'])
	});

	let errors = $state<Record<string, string>>({});
	let tempPasswordForUser = $state(''); // displayed once after creation for admin to communicate to the new crew member

	async function handleSubmit() {
		errors = {};
		tempPasswordForUser = '';

		const result = NewUserSchema.safeParse({
			firstName: firstName.trim(),
			lastName: lastName.trim(),
			email: email.trim(),
			role
		});

		if (!result.success) {
			result.error.issues.forEach((issue) => {
				const field = issue.path[0] as string;
				errors[field] = issue.message;
			});
			return;
		}

		const data = result.data;
		const tempPass = crypto.randomUUID().slice(0, 12) + 'Aa1!'; // temporary fallback; the welcome email provides the main link to set password + activate account

		try {
			await createUser({
				firstName: data.firstName,
				lastName: data.lastName,
				email: data.email,
				role: data.role,
				active: true,
				forcePhotoUpdate: true, // admin retains ability to force photo update via edit toggle (PIN removed)
				password: tempPass, // temporary; the welcome email link sets the real password (and activates the account via hook)
				photo: undefined
			} as any);
			tempPasswordForUser = tempPass; // show to admin (user will normally use the welcome email link instead)

			// Send a single welcome email with one action: set password + activate account.
			// On successful password reset, a server hook in PocketBase also marks the user as verified.
			// This calls the welcome route which hits the PB internal password-reset endpoint then Brevo.
			try {
				await fetch('/api/auth/send-welcome', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: data.email })
				});
			} catch (e) {
				console.warn('Failed to send welcome email for new user (non-blocking):', e);
			}
		} catch (err) {
			console.error('Failed to create new user:', err);
			errors.general = 'Failed to create user. Check console / PB rules.';
		}
	}

	function closeModal() {
		const hadSuccess = !!tempPasswordForUser;
		tempPasswordForUser = '';
		onClose(hadSuccess);
	}

	function stopProp(e: Event) {
		e.stopPropagation();
	}
</script>

<div class="modal-overlay" role="presentation" onclick={onClose}>
	<div class="modal-content" role="dialog" aria-modal="true" tabindex="-1" onclick={stopProp}>
		<h2 class="modal__title">Add New User</h2>

		{#if tempPasswordForUser}
			<!-- Success view: show the auto-generated temp password once (admin shares with new crew member) -->
			<div class="modal__success">
				<h3>User created successfully!</h3>
				<p>
					Share this <strong>temporary password</strong> with the new crew member (they will use the email
					+ this password for their first login to verify and set their real password + photo):
				</p>
				<div class="temp-pass-box">{tempPasswordForUser}</div>
				<p class="note">
					They login with email/password first (this verifies the PB account). Then they can update
					their password and photo in Profile. Admin can later force photo reset via the edit
					toggle.
				</p>
				<button onclick={closeModal} class="modal__btn modal__btn--save">Done</button>
			</div>
		{:else}
			<div class="modal__form">
				<!-- Admin only enters first/last/email/role. Password auto-generated for initial email verification (user sets real password after first login). -->
				<div class="modal__field">
					<label for="nu-first" class="modal__label">First Name *</label>
					<input
						id="nu-first"
						type="text"
						bind:value={firstName}
						class="modal__input"
						placeholder="John"
					/>
					{#if errors.firstName}<small class="error">{errors.firstName}</small>{/if}
				</div>

				<div class="modal__field">
					<label for="nu-last" class="modal__label">Last Name *</label>
					<input
						id="nu-last"
						type="text"
						bind:value={lastName}
						class="modal__input"
						placeholder="Doe"
					/>
					{#if errors.lastName}<small class="error">{errors.lastName}</small>{/if}
				</div>

				<div class="modal__field">
					<label for="nu-email" class="modal__label">Email *</label>
					<input
						id="nu-email"
						type="email"
						bind:value={email}
						class="modal__input"
						placeholder="john.doe@company.com"
					/>
					{#if errors.email}<small class="error">{errors.email}</small>{/if}
				</div>

				<div class="modal__field">
					<label for="nu-role" class="modal__label">Role</label>
					<select id="nu-role" bind:value={role} class="modal__select">
						<option value="crew">Crew</option>
						<option value="admin">Admin</option>
					</select>
				</div>

				<div class="modal__placeholder">
					A temporary password will be generated automatically for the new user's initial
					email/password login (to verify their account and set their real password + photo).<br />
					📸 Photo upload coming soon (user self-service after verification)
				</div>

				{#if errors.general}<small class="error">{errors.general}</small>{/if}
			</div>

			<div class="modal__actions">
				<button onclick={closeModal} class="modal__btn modal__btn--cancel">Cancel</button>
				<button onclick={handleSubmit} class="modal__btn modal__btn--save">Create User</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* BEM - unchanged */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	.modal-content {
		background: white;
		border-radius: 8px;
		width: 90%;
		max-width: 420px;
		padding: 2rem;
	}
	.modal__title {
		margin: 0 0 1.5rem 0;
		font-size: 1.5rem;
	}
	.modal__form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.modal__label {
		font-weight: 600;
		margin-bottom: 0.25rem;
		display: block;
	}
	.modal__input,
	.modal__select {
		padding: 0.75rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		font-size: 1rem;
	}
	.modal__placeholder {
		padding: 1rem;
		background: #f9f9f9;
		border-radius: 6px;
		font-size: 0.9rem;
		color: #666;
		text-align: center;
	}
	.modal__actions {
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
		margin-top: 2rem;
	}
	.modal__btn {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
	}
	.modal__btn--cancel {
		background: #9e9e9e;
		color: white;
	}
	.modal__btn--save {
		background: #4caf50;
		color: white;
	}
</style>
