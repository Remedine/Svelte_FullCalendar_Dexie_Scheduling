<!-- src/lib/components/NewUserModal.svelte -->
<script lang="ts">
	// )=- Admin creates crew/admin users with firstName, lastName, email, role + temp password.
	// User logs in first time with email + temp password (verifies account), then sets their real password via /profile.
	// forcePhotoUpdate can still be toggled by admin later via Crew edit.
	// )=- No PIN anywhere (PIN login completely removed; only email/password auth).
	// Zod for the admin creation form. BEM + runes used.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	import { createUser, db } from '$lib/db';
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
			// Always store/pass emails in lowercase to PB (avoids validation/auth errors on capital letters).
			const localId = await createUser({
				firstName: data.firstName,
				lastName: data.lastName,
				email: data.email.trim().toLowerCase(),
				role: data.role,
				active: true,
				verified: false, // will be set true either via the welcome email link or via the welcome modal if the user logs in directly with the temp password
				forcePhotoUpdate: true, // admin retains ability to force photo update via edit toggle (PIN removed)
				password: tempPass, // temporary; the welcome email link sets the real password (and activates the account via hook)
				photo: undefined
			} as any);
			tempPasswordForUser = tempPass; // show to admin (user will normally use the welcome email link instead)

			// After the queue has processed (createUser awaits processSyncQueue), the local record has pbId.
			// Use the elevated mark-verified route (internal secret) to set verified:true on PB, since direct
			// update after create often 400s depending on collection rules (the admin token may not write verified).
			// This ensures PB shows verified after creation.
			try {
				const created = await db.users.get(localId);
				if (created) {
					await fetch('/api/auth/mark-verified', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ pbId: created.pbId, email: created.email })
					});
				}
			} catch (e) {
				console.warn('Failed to call mark-verified after creation (non-blocking):', e);
			}

			// Send a single welcome email with one action: set password + activate account.
			// (The email link path uses a server hook + internal request-password-reset.)
			// For the direct temp-password login path (shown temp pass), the WelcomeModal itself calls
			// /api/auth/mark-verified (internal secret) after the user sets their real password.
			const normalizedForWelcome = data.email.trim().toLowerCase();
			try {
				await fetch('/api/auth/send-welcome', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email: normalizedForWelcome })
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
					+ this password for their first login; the app will immediately prompt them to set a real password and photo):
				</p>
				<div class="temp-pass-box">{tempPasswordForUser}</div>
				<p class="note">
					They login with email/password first (this verifies the PB account). Then they can update
					their password and photo in Profile. Admin can later force photo reset via the edit
					toggle.
				</p>
				<button onclick={closeModal} class="modal__btn modal__btn--save button button--primary">Done</button>
			</div>
		{:else}
			<div class="modal__form">
				<!-- Admin only enters first/last/email/role. Password auto-generated for initial email verification (user sets real password after first login). -->
				<div class="modal__field">
					<label for="nu-first" class="modal__label label">First Name *</label>
					<input
						id="nu-first"
						type="text"
						bind:value={firstName}
						class="modal__input input"
						placeholder="John"
					/>
					{#if errors.firstName}<small class="error">{errors.firstName}</small>{/if}
				</div>

				<div class="modal__field">
					<label for="nu-last" class="modal__label label">Last Name *</label>
					<input
						id="nu-last"
						type="text"
						bind:value={lastName}
						class="modal__input input"
						placeholder="Doe"
					/>
					{#if errors.lastName}<small class="error">{errors.lastName}</small>{/if}
				</div>

				<div class="modal__field">
					<label for="nu-email" class="modal__label label">Email *</label>
					<input
						id="nu-email"
						type="email"
						bind:value={email}
						class="modal__input input"
						placeholder="john.doe@company.com"
					/>
					{#if errors.email}<small class="error">{errors.email}</small>{/if}
				</div>

				<div class="modal__field">
					<label for="nu-role" class="modal__label label">Role</label>
					<select id="nu-role" bind:value={role} class="modal__select input">
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
				<button onclick={closeModal} class="modal__btn modal__btn--cancel button button--ghost">Cancel</button>
				<button onclick={handleSubmit} class="modal__btn modal__btn--save button button--primary">Create User</button>
			</div>
		{/if}
	</div>
</div>

<style>
	/* Base .modal-overlay and .modal-content now come from globals.css (consolidated for cohesion).
	   Desktop center, mobile bottom-sheet handled globally. Only component BEM + specifics here. */
	.modal__title {
		margin: 0 0 var(--space-4) 0;
		padding: 0 var(--space-4);
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}
	.modal__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: 0 var(--space-4); /* add padding since global modal-content has none */
	}
	.modal__label {
		font-weight: var(--font-weight-semibold);
		margin-bottom: var(--space-1);
		display: block;
	}
	.modal__input,
	.modal__select {
		/* base .input */
		padding: var(--space-3);
	}
	.modal__placeholder {
		padding: var(--space-4);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		text-align: center;
	}
	.modal__actions {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		margin-top: var(--space-6);
	}
	.modal__btn {
		padding: var(--space-3) var(--space-6);
		border: none;
		border-radius: var(--radius-sm);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}
	.modal__btn--cancel {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}
	.modal__btn--save {
		background: var(--color-primary);
		color: white;
	}
	.temp-pass-box {
		background: var(--color-success-soft);
		border: 1px solid var(--color-success);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		font-family: monospace;
		font-size: var(--font-size-base);
		margin: var(--space-4) 0;
		word-break: break-all;
		color: var(--color-text);
	}
	.note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	/* Give the modal content breathing room (global .modal-content has no internal padding) */
	.modal__success {
		padding: 0 var(--space-4);
	}

	/* Component-specific mobile action stacking + padding (global handles shell) */
	@media (max-width: 768px) {
		.modal__form {
			padding: 0 var(--space-3);
		}
		.modal__title {
			padding: 0 var(--space-3);
		}
		.modal__success {
			padding: 0 var(--space-3);
		}
		.modal__actions {
			flex-direction: column;
			gap: var(--space-2);
			margin-top: var(--space-4);
		}
		.modal__btn {
			width: 100%;
			text-align: center;
		}
	}
</style>
