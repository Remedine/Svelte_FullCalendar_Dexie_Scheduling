<script lang="ts">
	// )=- Self-service profile page for the logged-in user (crew or admin self).
	// We deliberately do NOT reuse /admin/crew (admin multi-user management tool).
	// This is personal to auth.currentUser. Reuses updateUser for Dexie+PB sync (photo/name), direct pb (with realId resolution) for password + requestEmailChange for email.
	// )=- ID-badge style card with polished BEM styling (per user request + Agents.md).
	// - Edit buttons (pencils) right-aligned for Name and Email rows (avatar pencil stays overlaid).
	// - Added subtle field labels: "Name", "Email", "Role" inside the badge.
	// - Security actions stacked vertically with right-aligned pencils. Only "Update Password" remains (PIN login removed entirely).
	// - All buttons remain icon-only (pencils / check / x). Nice spacing, typography, and card polish using strict BEM.
	// - Email editing fully supported.
	// )=- PIN/forcePin completely removed from UI, state, and save paths. Only email/password auth now.
	// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
	import { auth } from '$lib/stores/auth.svelte';
	import { db, updateUser, getUserPhotoSrc } from '$lib/db';
	import { pb } from '$lib/db/pb';
	import {
		disableQuickUnlock,
		enableQuickUnlock,
		getDeviceAuthSettings,
		isPlatformAuthenticatorAvailable,
		isQuickUnlockEnabled,
		validatePinFormat
	} from '$lib/auth/deviceUnlock';
	import {
		canUsePasskeys,
		listPasskeys,
		registerPasskey,
		removePasskey
	} from '$lib/auth/passkeys';

	let loading = $state(false);
	let error = $state('');
	let success = $state('');

	// Photo input ref for camera (triggered directly by the pencil next to avatar)
	let photoInput: HTMLInputElement | null = $state(null);

	// Password form state (PB email auth change - requires oldPassword for security)
	let oldPassword = $state('');
	let newPassword = $state('');
	let confirmNewPassword = $state('');

	// Name edit state (synced from currentUser except while actively editing)
	let firstName = $state(auth.currentUser?.firstName || '');
	let lastName = $state(auth.currentUser?.lastName || '');

	// )=- Email edit state. Now fully wired (previously declared but had no saveEmail or UI row).
	let newEmail = $state(auth.currentUser?.email || '');

	// )=- editing controls which (if any) field is in edit mode. Photo uses direct trigger (no editing state needed).
	// Only 'name' and 'email' use inline replacement inside the badge rows.
	// 'password' opens the compact form below the badge.
	let editing = $state<'password' | 'name' | 'email' | null>(null);

	// )=- Track pending email change (from requestEmailChange) so we can show "pending confirmation" pill + resend in the badge.
	// Cleared on reload or when a new request overwrites it. Local email is already optimistically set to the pending value.
	let pendingEmailChange = $state<string | null>(null);

	let quickUnlockOn = $state(false);
	let passkeyItems = $state<Array<{ credentialId: string; deviceName: string }>>([]);
	let setupPin = $state('');
	let setupPinConfirm = $state('');
	let setupUseBiometric = $state(true);
	let biometricAvailable = $state(false);
	const passkeysSupported = $derived(canUsePasskeys());

	function startEditing(section: 'password' | 'name' | 'email') {
		editing = section;
		error = '';
		success = '';
		if (section === 'password') {
			oldPassword = '';
			newPassword = '';
			confirmNewPassword = '';
		} else if (section === 'email') {
			newEmail = auth.currentUser?.email || '';
		}
		// name uses live first/last from effect; no reset needed
	}

	function cancelEditing() {
		editing = null;
		error = '';
		success = '';
	}

	// )=- Keep form values in sync if auth.currentUser updates externally (sync, force flags, other tabs).
	// Skip overwriting the field the user is currently typing in.
	$effect(() => {
		if (auth.currentUser) {
			firstName = auth.currentUser.firstName || '';
			lastName = auth.currentUser.lastName || '';
			if (editing !== 'email') {
				newEmail = auth.currentUser.email || '';
			}
		}
	});

	async function refreshDeviceAuthUi() {
		quickUnlockOn = await isQuickUnlockEnabled();
		biometricAvailable = await isPlatformAuthenticatorAvailable();
		if (passkeysSupported && pb.authStore.isValid) {
			passkeyItems = await listPasskeys();
		}
	}

	$effect(() => {
		if (auth.currentUser) void refreshDeviceAuthUi();
	});

	async function saveQuickUnlock() {
		if (!auth.currentUser) return;
		error = '';
		success = '';
		const wantsPin = setupPin.length > 0;
		if (wantsPin) {
			const pinErr = validatePinFormat(setupPin);
			if (pinErr) {
				error = pinErr;
				return;
			}
			if (setupPin !== setupPinConfirm) {
				error = 'PINs do not match';
				return;
			}
		}
		if (!wantsPin && !(setupUseBiometric && biometricAvailable)) {
			error = 'Set a PIN and/or enable biometric unlock';
			return;
		}
		loading = true;
		try {
			await enableQuickUnlock({
				userId: String(auth.currentUser.id),
				email: (auth.currentUser.email || '').trim().toLowerCase(),
				displayName: auth.currentUser.name || auth.currentUser.email || 'User',
				pin: wantsPin ? setupPin : undefined,
				enableBiometric: setupUseBiometric && biometricAvailable
			});
			setupPin = '';
			setupPinConfirm = '';
			success = 'Quick unlock enabled for this device';
			await refreshDeviceAuthUi();
		} catch (e: any) {
			error = e?.message || 'Could not enable quick unlock';
		} finally {
			loading = false;
		}
	}

	async function turnOffQuickUnlock() {
		loading = true;
		try {
			await disableQuickUnlock();
			quickUnlockOn = false;
			success = 'Quick unlock disabled on this device';
		} catch (e: any) {
			error = e?.message || 'Could not disable quick unlock';
		} finally {
			loading = false;
		}
	}

	async function addPasskey() {
		loading = true;
		error = '';
		success = '';
		try {
			await registerPasskey();
			passkeyItems = await listPasskeys();
			success = 'Passkey added for this device';
		} catch (e: any) {
			error = e?.message || 'Could not add passkey';
		} finally {
			loading = false;
		}
	}

	async function deletePasskey(credentialId: string) {
		loading = true;
		error = '';
		try {
			await removePasskey(credentialId);
			passkeyItems = await listPasskeys();
			success = 'Passkey removed';
		} catch (e: any) {
			error = e?.message || 'Could not remove passkey';
		} finally {
			loading = false;
		}
	}

	// Handle camera photo upload (phone-friendly capture="user"). Triggered directly by pencil next to avatar.
	async function handlePhoto(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file || !auth.currentUser) return;

		loading = true;
		error = '';
		success = '';

		try {
			const reader = new FileReader();
			reader.onload = async (ev) => {
				const dataUrl = ev.target?.result as string;
				await updateUser(auth.currentUser!.id!, {
					photo: dataUrl,
					forcePhotoUpdate: false
				});
				// Update in-memory for immediate UI feedback (sync happens via updateUser queue + dataUrlToBlob in pb sync)
				auth.currentUser!.photo = dataUrl;
				auth.currentUser!.forcePhotoUpdate = false;
				success = 'Photo updated (syncs when online)';
				editing = null;
				loading = false;
			};
			reader.readAsDataURL(file);
		} catch (e: any) {
			error = e.message || 'Failed to process photo';
			loading = false;
		}
	}

	function triggerCamera() {
		photoInput?.click();
	}

	// Change password on PB side (for email/password login only). Requires oldPassword. Direct (not via queue) for security.
	// )=- Must resolve the real PocketBase record id (pbId) instead of the local Dexie id.
	// Hybrid users (admin-created crew) keep a local UUID as .id but store the PB id in .pbId after email login.
	// Using the wrong id here would target a non-existent record (or the wrong one), so the update would silently
	// not affect the actual auth record even if no exception was thrown in some cases.
	// This mirrors the realId resolution used in processSyncQueue for users updates.
	// Only email/password sessions have a valid PB token for password self-service (PIN login removed).
	async function changePassword() {
		if (
			!oldPassword ||
			!newPassword ||
			newPassword.length < 8 ||
			newPassword !== confirmNewPassword
		) {
			error = 'Old password required. New password min 8 chars and must match.';
			return;
		}
		if (!auth.currentUser) return;

		// Resolve the actual PocketBase auth record id
		const realId = auth.currentUser.pbId || auth.currentUser.id;
		if (!realId) {
			error = 'Unable to determine user record for password change.';
			return;
		}

		// Password self-service requires an active PB auth session (the one that can supply oldPassword).
		if (!pb.authStore.isValid) {
			error =
				'Password change requires you to be logged in with your email and current password. Please log in via email first, then return here to update your password.';
			return;
		}

		loading = true;
		error = '';
		success = '';

		try {
			await pb.collection('users').update(realId, {
				oldPassword,
				password: newPassword,
				passwordConfirm: newPassword
			});
			success = 'Password changed (may need re-login with the new password)';
			oldPassword = '';
			newPassword = '';
			confirmNewPassword = '';
			editing = null;
		} catch (e: any) {
			console.error('Password change to PB failed:', e?.response?.data || e);
			error =
				e?.response?.data?.oldPassword?.message ||
				e?.message ||
				'Failed to change password. Check your current (old) password.';
		} finally {
			loading = false;
		}
	}

	async function saveName() {
		if (!auth.currentUser) return;
		loading = true;
		error = '';
		success = '';
		try {
			await updateUser(auth.currentUser.id!, {
				firstName: firstName.trim(),
				lastName: lastName.trim()
			});
			auth.currentUser.firstName = firstName.trim();
			auth.currentUser.lastName = lastName.trim();
			auth.currentUser.name = `${firstName.trim()} ${lastName.trim()}`.trim();
			success = 'Name updated';
			editing = null;
		} catch (e: any) {
			error = e.message || 'Failed to update name';
		} finally {
			loading = false;
		}
	}

	// )=- saveEmail: Server-first validation for email changes.
	// We call requestEmailChange FIRST (the only safe way on PB auth collections with confirmation enabled).
	// This sends a real confirmation email (now that you have SMTP configured) to the new address.
	// Only on success do we update the local Dexie record (so local state only reflects accepted requests).
	// In local dev without mail we still have a fallback to direct update (with email + emailConfirm).
	// )=- Polish: Added pending confirmation indicator + resend button next to email in the ID badge.
	// Shows "pending confirmation" pill + resend when a change has been requested but not yet confirmed on server.
	async function saveEmail() {
		if (!auth.currentUser) return;
		const trimmed = (newEmail || '').trim();
		if (!trimmed || !trimmed.includes('@')) {
			error = 'Enter a valid email address';
			return;
		}

		const currentEmail = (auth.currentUser.email || '').trim().toLowerCase();
		if (trimmed.toLowerCase() === currentEmail) {
			error = 'New email must be different from your current email.';
			return;
		}

		// Best-effort client-side duplicate check (Dexie may be incomplete until pull).
		const existingWithEmail = await db.users.where('email').equalsIgnoreCase(trimmed).first();
		if (existingWithEmail && existingWithEmail.id !== auth.currentUser.id) {
			error = 'This email is already used by another account (local data). Choose a different one.';
			return;
		}

		loading = true;
		error = '';
		success = '';

		const hadValidSession = navigator.onLine && pb.authStore.isValid;
		const isLocalDev =
			import.meta.env.DEV ||
			(pb.baseUrl || '').includes('localhost') ||
			(pb.baseUrl || '').includes('127.0.0.1');

		try {
			if (hadValidSession) {
				let usedDevFallback = false;

				try {
					// Preferred path: call our SvelteKit route which gets the secure link from PB (via internal route)
					// and sends via Brevo HTTPS API (works on Railway Hobby, no SMTP).
					const currentEmailForChange = (auth.currentUser.email || '').trim().toLowerCase();
					await fetch('/api/auth/request-email-change', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email: currentEmailForChange, newEmail: trimmed })
					});
				} catch (reqErr: any) {
					if (isLocalDev) {
						// On local dev without mail server configured, PocketBase can't send the confirmation.
						// Fall back to direct update so you can still test the full profile/email UI flow, local Dexie state,
						// badge display, etc. This is dev-only.
						console.warn(
							'[DEV] requestEmailChange failed (no mail server). Attempting direct update...'
						);
						usedDevFallback = true;
						const realId = auth.currentUser.pbId || auth.currentUser.id;
						try {
							await pb.collection('users').update(realId, {
								email: trimmed,
								emailConfirm: trimmed
							});
						} catch (directErr: any) {
							console.warn(
								'[DEV] Direct email update also failed (this is expected if the users collection has "Confirm email change" enabled or email field updates are restricted for regular users):',
								directErr?.response?.data || directErr
							);
							// Still continue to update local Dexie below so the profile badge and app state work for testing.
						}
					} else {
						throw reqErr;
					}
				}

				// Server (or dev fallback) accepted → update local Dexie
				await db.users.update(auth.currentUser.id!, {
					email: trimmed,
					updatedAt: new Date()
				});
				auth.currentUser.email = trimmed;

				if (usedDevFallback) {
					success =
						'Email updated (local dev mode - direct update, no confirmation email was sent or required).';
					pendingEmailChange = null; // no confirmation pending for direct dev update
				} else {
					success =
						'Email change requested successfully. A confirmation link has been sent to the new address. The server-side record will update only after you confirm it.';
					pendingEmailChange = trimmed; // show pending pill + resend until user confirms via email link
				}
			} else if (navigator.onLine) {
				// No active PB email session. Update local only (user must have email/password login to do full server email change).
				await db.users.update(auth.currentUser.id!, {
					email: trimmed,
					updatedAt: new Date()
				});
				auth.currentUser.email = trimmed;
				success =
					'Email updated locally. Log in with your email + password (using the new address) to initiate the server change via confirmation.';
			} else {
				// Offline: local only
				await db.users.update(auth.currentUser.id!, {
					email: trimmed,
					updatedAt: new Date()
				});
				auth.currentUser.email = trimmed;
				success = 'Email updated locally (offline). Will sync when back online.';
			}

			editing = null;
		} catch (e: any) {
			console.error('saveEmail / requestEmailChange failed:', e);
			const data = e?.response?.data;
			// Force stringification so you (and we) can see the exact content instead of just "[Object]"
			const dataStr = data ? JSON.stringify(data, null, 2) : '{}';
			console.error('PocketBase response data:', dataStr);

			// Build the best possible message for the user
			const pbMessage =
				data?.email?.message ||
				data?.message ||
				e?.response?.message ||
				e?.message ||
				'Failed to request email change.';

			let msg = `Server rejected email change: ${pbMessage.replace(/\.$/, '')}.`;

			// Append the raw details so the real reason is visible in the red banner
			if (dataStr && dataStr !== '{}') {
				msg += ` PB raw response: ${dataStr}`;
			}

			// Helpful context (especially useful on local dev where you hit the fallback)
			msg +=
				' (This usually means the email field requires both `email` and `emailConfirm` to match for direct updates on auth collections, or the value conflicts with an existing record.)';

			error = msg;
		} finally {
			loading = false;
		}

		// Extra safety: if we somehow still have a stale newEmail after failure, the input will still show what the user typed
		// so they can easily correct it.
	}

	// )=- Resend the confirmation email for a pending email change (calls requestEmailChange again with the same target).
	// Useful if the user didn't receive the first email or the link expired. Only shown when pendingEmailChange is set.
	async function resendEmailConfirmation() {
		if (!pendingEmailChange || !auth.currentUser || !pb.authStore.isValid) return;

		loading = true;
		error = '';
		success = '';

		try {
			const currentEmailForResend = (auth.currentUser.email || '').trim().toLowerCase();
			await fetch('/api/auth/request-email-change', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: currentEmailForResend, newEmail: pendingEmailChange })
			});
			success = `Confirmation re-sent to ${pendingEmailChange}. Check the new inbox.`;
		} catch (e: any) {
			error = e.message || 'Failed to resend confirmation email.';
		} finally {
			loading = false;
		}
	}
</script>

<div class="profile-page">
	{#if auth.currentUser}
		<!-- )=- ID-badge card (BEM). Right-aligned pencils on Name/Email, labels present.
         Security now only has "Update Password" (PIN login option fully removed).
         Avatar pencil kept overlaid on photo. All buttons icon-only. -->
		<div class="profile__badge">
			<!-- Avatar / photo with pencil edit icon next to it (overlay style for badge look) -->
			<div class="profile__badge-photo">
				{#if auth.currentUser.photo}
					<!-- )=- Normalize here too for consistency (fixes potential 404 if photo is bare filename). -->
					<img
						src={getUserPhotoSrc(auth.currentUser.photo, auth.currentUser)}
						alt="User ID photo"
						class="profile__badge-img"
					/>
				{:else}
					<div class="profile__badge-placeholder">
						{(auth.currentUser.firstName || auth.currentUser.name || 'U').slice(0, 1).toUpperCase()}
					</div>
				{/if}
				<!-- Pencil edit icon directly for avatar/photo. Triggers camera input (no text, title only). -->
				<button
					class="profile__edit-btn profile__edit-btn--photo"
					onclick={triggerCamera}
					title="Edit photo"
					disabled={loading}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="13"
						height="13"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg
					>
				</button>
				<input
					bind:this={photoInput}
					type="file"
					accept="image/*"
					capture="user"
					style="display:none"
					onchange={handlePhoto}
				/>
			</div>

			<!-- Badge body with labeled fields (BEM). Name & Email rows have right-aligned edit buttons.
           Avatar pencil overlay remains in its original position on the photo. Role is labeled but static. -->
			<div class="profile__badge-body">
				<!-- Name field: label + value (or inputs in edit). Pencil right-aligned. -->
				<div class="profile__badge-field">
					{#if editing === 'name'}
						<div class="profile__field-main">
							<span class="profile__badge-label">Name</span>
							<div class="profile__inline-edit">
								<input
									type="text"
									bind:value={firstName}
									placeholder="First"
									class="profile__input"
								/>
								<input
									type="text"
									bind:value={lastName}
									placeholder="Last"
									class="profile__input"
								/>
							</div>
						</div>
						<div class="profile__field-actions">
							<button
								onclick={saveName}
								disabled={loading}
								class="profile__icon-btn"
								title="Save name"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg
								>
							</button>
							<button
								onclick={cancelEditing}
								class="profile__icon-btn profile__icon-btn--cancel"
								title="Cancel"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"
									><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
									></line></svg
								>
							</button>
						</div>
					{:else}
						<div class="profile__field-main">
							<span class="profile__badge-label">Name</span>
							<span class="profile__badge-value profile__badge-value--name">
								{auth.currentUser.firstName || ''}
								{auth.currentUser.lastName || ''}
							</span>
						</div>
						<button
							class="profile__edit-btn"
							onclick={() => startEditing('name')}
							title="Edit name"
							disabled={loading}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg
							>
						</button>
					{/if}
				</div>

				<!-- Email field: label + value. Right-aligned pencil (enables email self-update). -->
				<div class="profile__badge-field">
					{#if editing === 'email'}
						<div class="profile__field-main">
							<span class="profile__badge-label">Email</span>
							<div class="profile__inline-edit">
								<input
									type="email"
									bind:value={newEmail}
									placeholder="name@example.com"
									class="profile__input profile__input--email"
								/>
							</div>
						</div>
						<div class="profile__field-actions">
							<button
								onclick={saveEmail}
								disabled={loading}
								class="profile__icon-btn"
								title="Save email"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg
								>
							</button>
							<button
								onclick={cancelEditing}
								class="profile__icon-btn profile__icon-btn--cancel"
								title="Cancel"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"
									><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
									></line></svg
								>
							</button>
						</div>
					{:else}
						<div class="profile__field-main">
							<span class="profile__badge-label">Email</span>
							<span class="profile__badge-value profile__badge-value--email">
								{auth.currentUser.email || '—'}
							</span>
							{#if pendingEmailChange}
								<span class="profile__pending-pill">pending confirmation</span>
								<button
									class="profile__resend-btn"
									onclick={resendEmailConfirmation}
									disabled={loading}
									title="Resend confirmation to the new address"
								>
									resend
								</button>
							{/if}
						</div>
						<button
							class="profile__edit-btn"
							onclick={() => startEditing('email')}
							title="Edit email"
							disabled={loading}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="13"
								height="13"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg
							>
						</button>
					{/if}
				</div>

				<!-- Role (labeled, static, no edit button) -->
				<div class="profile__badge-field profile__badge-field--static">
					<div class="profile__field-main">
						<span class="profile__badge-label">Role</span>
						<span class="profile__badge-value profile__badge-value--role">
							{auth.currentUser.role}
						</span>
						{#if auth.currentUser.forcePhotoUpdate}<span class="profile__force">Photo required</span
							>{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- )=- Security section (BEM). Only password remains (PIN login removed entirely).
         Stacked vertically for consistency with name/email. Pencil icon-only.
         BEM: profile__security, profile__security-item, profile__security-label. -->
		<div class="profile__security">
			<div class="profile__security-item profile__security-item--stacked">
				<span class="profile__security-label">Quick unlock (this device)</span>
				<p class="profile__security-hint">
					Unlock this device after you've signed in — PIN or fingerprint when returning to the app.
					Does not replace your account password.
				</p>
				{#if quickUnlockOn}
					<p class="profile__security-status">Enabled on this device</p>
					<button
						type="button"
						class="profile__secondary-btn"
						onclick={turnOffQuickUnlock}
						disabled={loading}
					>
						Disable quick unlock
					</button>
				{:else}
					{#if biometricAvailable}
						<label class="profile__security-check">
							<input type="checkbox" bind:checked={setupUseBiometric} disabled={loading} />
							Use fingerprint / Face ID
						</label>
					{/if}
					<input
						class="profile__input profile__input--compact"
						type="password"
						inputmode="numeric"
						placeholder="Quick PIN (4–8 digits, optional)"
						bind:value={setupPin}
						disabled={loading}
					/>
					<input
						class="profile__input profile__input--compact"
						type="password"
						inputmode="numeric"
						placeholder="Confirm PIN"
						bind:value={setupPinConfirm}
						disabled={loading}
					/>
					<button
						type="button"
						class="profile__secondary-btn"
						onclick={saveQuickUnlock}
						disabled={loading}
					>
						Enable quick unlock
					</button>
				{/if}
			</div>

			{#if passkeysSupported}
				<div class="profile__security-item profile__security-item--stacked">
					<span class="profile__security-label">Passkeys (sign in)</span>
					<p class="profile__security-hint">
						Register this phone for passwordless sign-in with fingerprint or Face ID.
					</p>
					{#if passkeyItems.length > 0}
						<ul class="profile__passkey-list">
							{#each passkeyItems as pk (pk.credentialId)}
								<li class="profile__passkey-row">
									<span>{pk.deviceName}</span>
									<button
										type="button"
										class="profile__link-btn"
										onclick={() => deletePasskey(pk.credentialId)}
										disabled={loading}
									>
										Remove
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					<button
						type="button"
						class="profile__secondary-btn"
						onclick={addPasskey}
						disabled={loading || !pb.authStore.isValid}
					>
						Add passkey on this device
					</button>
				</div>
			{/if}

			<div class="profile__security-item">
				<span class="profile__security-label">Update Password</span>
				<button
					class="profile__edit-btn"
					onclick={() => startEditing('password')}
					title="Update Password"
					disabled={loading || (editing !== null && editing !== 'password')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.25"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg
					>
				</button>
			</div>
		</div>

		<!-- Compact password form (icon-only save/cancel). Appears when the Update Password pencil is clicked. -->
		{#if editing === 'password'}
			<div class="profile__inline-form profile__inline-form--password">
				<div class="profile__password-fields">
					<input
						type="password"
						bind:value={oldPassword}
						placeholder="Current"
						class="profile__input"
					/>
					<input
						type="password"
						bind:value={newPassword}
						placeholder="New (8+)"
						class="profile__input"
					/>
					<input
						type="password"
						bind:value={confirmNewPassword}
						placeholder="Confirm new"
						class="profile__input"
					/>
				</div>
				<div class="profile__field-actions">
					<button
						onclick={changePassword}
						disabled={loading}
						class="profile__icon-btn"
						title="Save password"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg
						>
					</button>
					<button
						onclick={cancelEditing}
						class="profile__icon-btn profile__icon-btn--cancel"
						title="Cancel"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="3"
							stroke-linecap="round"
							stroke-linejoin="round"
							><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"
							></line></svg
						>
					</button>
				</div>
			</div>
		{/if}

		{#if loading}<div class="profile__status">Saving...</div>{/if}
		{#if error}<div class="profile__status profile__status--error">{error}</div>{/if}
		{#if success}<div class="profile__status profile__status--success">{success}</div>{/if}
	{:else}
		<p>Please log in to manage your profile.</p>
	{/if}
</div>

<style>
	/* )=- Full BEM-polished styling for the profile ID badge page.
     - Right-aligned edit pencils on Name and Email field rows (via flex:1 main + trailing actions).
     - Avatar pencil stays overlaid on the photo (classic badge affordance).
     - Explicit labels for Name, Email, Role using .profile__badge-label.
     - Security section stacked vertically (.profile__security as column) with right-aligned pencil.
     - Only "Update Password" remains (PIN login completely removed; no PIN form or label).
     - Nice ID-card aesthetics: subtle gradient, soft border/shadow, clear typography hierarchy, field separators, refined icon buttons.
     - All buttons are icon-only. Consistent spacing and touch targets.
     )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling */

	.profile-page {
		padding: var(--space-4);
		max-width: 440px;
		margin: 0 auto;
	}

	/* === ID BADGE CARD === */
	.profile__badge {
		display: flex;
		gap: var(--space-3);
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		padding: var(--space-3);
		box-shadow: var(--shadow-sm);
		margin-bottom: var(--space-3);
	}

	.profile__badge-photo {
		position: relative;
		width: 72px;
		height: 72px;
		flex-shrink: 0;
	}

	.profile__badge-img,
	.profile__badge-placeholder {
		width: 100%;
		height: 100%;
		border-radius: var(--radius-md);
		object-fit: cover;
		border: 1px solid var(--color-border);
		background: var(--color-surface-alt);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--font-size-2xl);
		font-weight: var(--font-weight-bold);
		color: var(--color-text-muted);
	}

	/* Pencil stays overlaid bottom-right of the avatar (kept in place) */
	.profile__edit-btn--photo {
		position: absolute;
		bottom: -2px;
		right: -2px;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		box-shadow: var(--shadow-sm);
	}

	.profile__badge-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	/* Field row: main content (label + value or inputs) takes remaining space;
     edit button / actions are right-aligned by coming after the flex-1 element. */
	.profile__badge-field {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding-bottom: var(--space-1);
	}
	.profile__badge-field:not(.profile__badge-field--static) {
		border-bottom: 1px solid var(--color-border);
	}

	.profile__field-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.profile__badge-label {
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.75px;
		color: var(--color-text-muted);
		line-height: 1;
	}

	.profile__badge-value {
		font-size: var(--font-size-base);
		color: var(--color-text);
		line-height: 1.15;
		word-break: break-word;
	}
	.profile__badge-value--name {
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-base);
	}
	.profile__badge-value--email {
		font-size: var(--font-size-base);
		color: var(--color-text-muted);
	}
	.profile__badge-value--role {
		font-size: var(--font-size-base);
		text-transform: capitalize;
	}

	.profile__force {
		display: inline-block;
		margin-top: var(--space-1);
		font-size: var(--font-size-xs);
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		font-weight: var(--font-weight-semibold);
		letter-spacing: 0.3px;
	}

	/* Field actions container (holds save/cancel icon buttons when editing a field) */
	.profile__field-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	/* === EDIT BUTTONS (pure pencil icons, right-aligned for name/email) === */
	.profile__edit-btn {
		background: var(--color-surface-alt);
		border: none;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-full);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		color: var(--color-text-muted);
		flex-shrink: 0;
		padding: 0;
		line-height: 0;
		transition:
			background 0.1s ease,
			color 0.1s ease;
	}
	.profile__edit-btn:hover:not(:disabled) {
		background: var(--color-border);
		color: var(--color-text);
	}
	.profile__edit-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* === INLINE EDITING (inside badge fields) === */
	.profile__inline-edit {
		display: flex;
		gap: var(--space-1);
		margin-top: var(--space-1);
	}

	.profile__input {
		flex: 1;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-base);
		min-width: 0;
		background: var(--color-surface);
		color: var(--color-text);
	}
	.profile__input:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}
	.profile__input--email {
		font-size: var(--font-size-base);
	}

	/* === ICON ACTION BUTTONS (check / x — no text) === */
	.profile__icon-btn {
		background: var(--color-text);
		color: var(--color-surface);
		border: none;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-sm);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
		line-height: 0;
		transition: background var(--transition-fast);
	}
	.profile__icon-btn:hover:not(:disabled) {
		background: var(--color-text-strong);
	}
	.profile__icon-btn--cancel {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}
	.profile__icon-btn--cancel:hover:not(:disabled) {
		background: var(--color-border);
	}
	.profile__icon-btn:disabled {
		opacity: 0.5;
	}

	/* === SECURITY SECTION (stacked, right-aligned pencils) === */
	.profile__security {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-2);
	}

	.profile__security-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) 0;
	}

	.profile__security-label {
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
		letter-spacing: 0.2px;
	}

	.profile__security-item--stacked {
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
		padding: var(--space-2) 0;
		border-bottom: 1px solid var(--color-border);
	}

	.profile__security-hint {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.4;
	}

	.profile__security-status {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-primary);
	}

	.profile__security-check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}

	.profile__secondary-btn {
		align-self: flex-start;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--font-size-sm);
		cursor: pointer;
	}

	.profile__input--compact {
		max-width: 280px;
	}

	.profile__passkey-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.profile__passkey-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		padding: var(--space-1) 0;
	}

	.profile__link-btn {
		border: none;
		background: none;
		color: var(--color-danger);
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-decoration: underline;
	}

	/* === FORMS (compact, appear under security when a pencil is activated) === */
	.profile__inline-form {
		display: flex;
		gap: var(--space-1);
		align-items: center;
		margin-bottom: var(--space-2);
		padding: var(--space-2);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}
	.profile__inline-form--password {
		flex-direction: column;
	}
	.profile__password-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.profile__inline-form--password .profile__input {
		width: 100%;
	}

	/* === STATUS MESSAGES === */
	.profile__status {
		font-size: var(--font-size-xs);
		margin-top: var(--space-1);
		color: var(--color-text-muted);
	}
	.profile__status--error {
		color: var(--color-danger-emphasis);
	}
	.profile__status--success {
		color: var(--color-success);
	}

	/* )=- Pending confirmation pill + resend button shown next to email value in the ID badge
     when a requestEmailChange has been issued but not yet confirmed on the PB server.
     BEM: profile__pending-pill, profile__resend-btn */
	.profile__pending-pill {
		font-size: var(--font-size-xs);
		background: var(--color-warning-soft);
		color: var(--color-warning);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		margin-left: var(--space-1);
		vertical-align: middle;
		font-weight: var(--font-weight-medium);
	}

	.profile__resend-btn {
		font-size: var(--font-size-xs);
		background: none;
		border: 1px solid var(--color-border-strong);
		color: var(--color-text-muted);
		padding: 1px 5px;
		border-radius: var(--radius-sm);
		cursor: pointer;
		margin-left: var(--space-1);
		vertical-align: middle;
	}

	.profile__resend-btn:hover:not(:disabled) {
		background: var(--color-surface-alt);
		color: var(--color-text);
	}

	.profile__resend-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
