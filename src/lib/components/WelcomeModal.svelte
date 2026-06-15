<!-- src/lib/components/WelcomeModal.svelte -->
<!-- Welcome / onboarding modal for new crew members logging in with their temporary password.
     - Forces setting a real password (replacing the temp one generated on creation) via PB oldPassword flow.
     - On success:
       - Sets verified:true locally in Dexie (the app's "onboarding complete" marker for the first-login gate).
       - Calls /api/auth/mark-verified (internal secret pattern) so the actual PocketBase user record gets verified:true.
       - Leaves forcePhotoUpdate (if set at creation) so the login page onClose can chain to ForcePhotoUpdate.
     - The dedicated ForcePhotoUpdate component can be used independently (admin re-forces photo later without password step).
     - BEM + design tokens. Shown from login page when local Dexie record has verified===false.
     Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
<script lang="ts">
	import { pb } from '$lib/db/pb';
	import { updateUser } from '$lib/db';
	import type { User } from '$lib/db';

	interface Props {
		user: User;
		onClose: () => void;
	}

	const { user, onClose }: Props = $props();

	let tempPassword = $state('');
	let newPassword = $state('');
	let confirmNewPassword = $state('');
	let isLoading = $state(false);
	let error = $state('');
	let success = $state(false);

	async function handleSetPassword() {
		if (!tempPassword || !newPassword || newPassword !== confirmNewPassword) {
			error = 'Please enter the temporary password and a matching new password.';
			return;
		}
		if (newPassword.length < 8) {
			error = 'New password must be at least 8 characters.';
			return;
		}

		isLoading = true;
		error = '';

		try {
			// Prefer the live authStore model.id — this is the authoritative PB record ID right after
			// the successful authWithPassword (temp password) in the login flow. This avoids stale/wrong
			// pbId or local-UUID from the passed Dexie `user` object (common source of 404s on later updates).
			const authModel = pb.authStore.model;
			const realId = authModel?.id || user.pbId || user.id;
			if (!realId) throw new Error('Unable to determine user record.');

			// Use PocketBase's authenticated update with oldPassword to change it securely.
			// IMPORTANT: Only password fields here. verified/forcePhotoUpdate/custom flags are not allowed (or ignored)
			// in self-service password updates on auth collections and produce 400. We set verified in Dexie only.
			// forcePhotoUpdate is intentionally left untouched here so a separate ForcePhotoUpdate component can handle
			// photo gating (usable independently of password reset, e.g. admin re-force on already-verified crew).
			await pb.collection('users').update(realId, {
				oldPassword: tempPassword,
				password: newPassword,
				passwordConfirm: newPassword
			});

			// Keep local Dexie in sync. Only mark verified here; leave forcePhotoUpdate for the dedicated photo step
			// (the onClose handler in the login page will re-check Dexie and chain to ForcePhotoUpdate if needed).
			await updateUser(user.id!, {
				verified: true,
				updatedAt: new Date()
			});

			// Use the internal/elevated server route (same pattern as send-welcome) so that the PB record
			// itself gets verified:true even when the current (newly onboarded) user session may not have
			// direct rights to write the verified field. This ensures "going through the set new password modal"
			// results in verified=true on the PocketBase side (in addition to the local Dexie marker).
			// Prefer email for resolution in the server route (more reliable if pbId is stale).
			try {
				await fetch('/api/auth/mark-verified', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ 
						pbId: realId, 
						email: user.email || authModel?.email 
					})
				});
			} catch (e) {
				// Non-blocking — local marker + app gating still work.
				console.warn('mark-verified server call failed (non-blocking):', e);
			}

			success = true;
		} catch (err: any) {
			console.error('Welcome password set failed:', err);
			const msg =
				err?.response?.data?.oldPassword?.message ||
				err?.response?.data?.password?.message ||
				err?.message ||
				'Failed to set password. Double-check the temporary password you received.';
			error = msg;
		} finally {
			isLoading = false;
		}
	}

	function finish() {
		onClose();
	}
</script>

<div
	class="modal-overlay"
	role="presentation"
	onclick={success ? finish : undefined}
>
	<div
		class="modal-content"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Escape' && success) {
				e.stopPropagation();
				finish();
			}
		}}
	>
		<h2 class="modal__title">Welcome to Capital City Windows!</h2>

		{#if success}
			<div class="modal__success">
				<p>
					Your password has been set and your account is now verified.
				</p>
				<p>
					If a current photo is required by your administrator you will be prompted next.
				</p>
				<button onclick={finish} class="modal__btn modal__btn--save">
					Continue
				</button>
			</div>
		{:else}
			<p class="modal__intro">
				You've been added as a crew member. To activate your account, enter the
				<strong>temporary password</strong> you were given and choose a new secure password.
			</p>

			<div class="modal__form">
				<div class="modal__field">
					<label for="welcome-temp" class="modal__label">Temporary Password</label>
					<input
						id="welcome-temp"
						type="password"
						bind:value={tempPassword}
						placeholder="The temp password from your admin"
						class="modal__input"
						required
					/>
				</div>

				<div class="modal__field">
					<label for="welcome-new" class="modal__label">New Password (min 8 characters)</label>
					<input
						id="welcome-new"
						type="password"
						bind:value={newPassword}
						placeholder="Choose a strong password"
						class="modal__input"
						required
					/>
				</div>

				<div class="modal__field">
					<label for="welcome-confirm" class="modal__label">Confirm New Password</label>
					<input
						id="welcome-confirm"
						type="password"
						bind:value={confirmNewPassword}
						placeholder="Re-enter your new password"
						class="modal__input"
						required
					/>
				</div>

				{#if error}
					<p class="modal__error">{error}</p>
				{/if}
			</div>

			<div class="modal__actions">
				<button onclick={finish} class="modal__btn modal__btn--cancel">
					Cancel (you can try again later)
				</button>
				<button
					onclick={handleSetPassword}
					disabled={isLoading}
					class="modal__btn modal__btn--save"
				>
					{isLoading ? 'Setting password...' : 'Set Password & Verify Account'}
				</button>
			</div>

			<p class="modal__note">
				This verifies your account. Photo (if required) is handled in the next step. You can change your password later from Profile.
			</p>
		{/if}
	</div>
</div>

<style>
	/* Base .modal-overlay and .modal-content now come from globals.css (consolidated primitive).
	   Global handles desktop center vs mobile bottom-sheet. Only Welcome BEM here. */
	.modal__title {
		margin: 0 0 var(--space-4) 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.modal__intro {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-bottom: var(--space-4);
	}

	.modal__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	.modal__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.modal__label {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
	}

	.modal__input {
		padding: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		font-size: var(--font-size-base);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.modal__input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}

	.modal__error {
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		margin: var(--space-2) 0;
	}

	.modal__actions {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		margin-top: var(--space-4);
	}

	.modal__btn {
		padding: var(--space-3) var(--space-5);
		border-radius: var(--radius-sm);
		border: none;
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		font-size: var(--font-size-sm);
	}

	.modal__btn--cancel {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}

	.modal__btn--save {
		background: var(--color-primary);
		color: white;
	}

	.modal__note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin-top: var(--space-4);
		text-align: center;
	}

	.modal__success {
		text-align: center;
	}

	.modal__success p {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		margin-bottom: var(--space-3);
	}

	/* Welcome-specific mobile tweaks for actions (global owns the overlay/content switch) */
	@media (max-width: 768px) {
		.modal__actions {
			flex-direction: column;
			gap: var(--space-2);
		}
		.modal__btn {
			width: 100%;
		}
	}
</style>
