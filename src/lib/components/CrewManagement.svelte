<!-- src/lib/components/CrewManagement.svelte -->
<script lang="ts">
	import {
		db,
		type User,
		updateUser,
		updateUserPhoto,
		deleteUser as deleteUserFromDb,
		getUserPhotoSrc,
		cleanupDuplicateUsers,
		getJobsForCrewMember
	} from '$lib/db';
	import { auth } from '$lib/stores/auth.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import NewUserModal from './NewUserModal.svelte';
	import UserJobsModal from './UserJobsModal.svelte';
	import { pullUsersFromServer, pb } from '$lib/db/pb';
	import { createBackdropDismiss } from '$lib/utils/modalBackdrop';
	import { compressImageToJpegDataUrl } from '$lib/utils/avatarImage';

	let allUsers = $state<User[]>([]);

	const activeUsers = $derived(allUsers.filter((u) => u.active));
	const deactivatedUsers = $derived(allUsers.filter((u) => !u.active));

	let showNewModal = $state(false);
	let showJobsModal = $state(false);
	let showEditModal = $state(false);

	let selectedUser = $state<User | null>(null);
	let editFirstName = $state('');
	let editLastName = $state('');
	let editRole = $state<'admin' | 'crew'>('crew');
	let editForcePhoto = $state(false);
	/** Admin-managed photo: crew cannot change avatar on profile (default off). */
	let editPhotoLocked = $state(false);
	let editEmail = $state('');
	let editActive = $state(true);
	let pendingDelete = $state(false);
	let editUserHasJobs = $state(false);
	let resendingWelcome = $state(false);
	/** New photo chosen in edit modal (JPEG data URL); saved via updateUserPhoto on Save. */
	let editPhotoPreview = $state<string | null>(null);
	let editPhotoInput: HTMLInputElement | null = $state(null);
	let editPhotoBusy = $state(false);
	let editSaving = $state(false);

	const editPhotoDisplaySrc = $derived.by(() => {
		if (editPhotoPreview) return editPhotoPreview;
		if (!selectedUser) return '';
		return getUserPhotoSrc(selectedUser.photo, selectedUser) || '';
	});

	const isAdmin = $derived(auth.currentUser?.role === 'admin');

	function canResendWelcome(user: User): boolean {
		return !!user.active && !!user.email?.trim()?.includes('@');
	}

	async function resendWelcomeEmail(user: User) {
		if (!isAdmin || !canResendWelcome(user)) return;

		const email = user.email!.trim().toLowerCase();
		const name =
			`${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || email;
		const ok = confirm(
			`Send a welcome email to ${name}?\n\n` +
				`To: ${email}\n\n` +
				`They will get a link to set their password and activate their account.`
		);
		if (!ok) return;

		const token = pb.authStore.token;
		if (!token) {
			toast.error('You need to be signed in as an admin to send welcome emails.');
			return;
		}
		if (!navigator.onLine) {
			toast.error('Go online to send the welcome email.');
			return;
		}

		resendingWelcome = true;
		try {
			const res = await fetch('/api/auth/send-welcome', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: token
				},
				body: JSON.stringify({ email })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				toast.error(
					(data?.error as string) ||
						'Could not send welcome email. Check the email address and try again.'
				);
				return;
			}
			toast.success(`Welcome email sent to ${email}`);
		} catch (err) {
			console.error('Resend welcome failed:', err);
			toast.error('Network error sending welcome email. Try again.');
		} finally {
			resendingWelcome = false;
		}
	}

	function closeEditModal() {
		pendingDelete = false;
		editUserHasJobs = false;
		editPhotoPreview = null;
		editPhotoBusy = false;
		editSaving = false;
		showEditModal = false;
		selectedUser = null;
	}

	function triggerEditPhoto() {
		editPhotoInput?.click();
	}

	async function onEditPhotoSelected(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		editPhotoBusy = true;
		try {
			editPhotoPreview = await compressImageToJpegDataUrl(file);
			// Admin just set a photo — no need to force the crew to re-upload.
			editForcePhoto = false;
		} catch (err: any) {
			console.error('Crew photo compress failed:', err);
			toast.error(err?.message || 'Could not read that photo. Try another image.');
			editPhotoPreview = null;
		} finally {
			editPhotoBusy = false;
			target.value = '';
		}
	}

	function clearEditPhotoPreview() {
		editPhotoPreview = null;
	}

	function onPhotoLockedChange(e: Event) {
		const checked = (e.currentTarget as HTMLInputElement).checked;
		editPhotoLocked = checked;
		// Forcing a self-upload while locked is contradictory.
		if (checked) editForcePhoto = false;
	}

	function onForcePhotoChange(e: Event) {
		const checked = (e.currentTarget as HTMLInputElement).checked;
		editForcePhoto = checked;
		if (checked) editPhotoLocked = false;
	}

	// Only close when pointerdown + click both hit the overlay (not text-select drag-outs)
	const editBackdrop = createBackdropDismiss(closeEditModal);

	// Guard so we only auto-load the roster once per page instance (prevents repeated server calls on reactivity).
	let hasAutoLoadedRoster = $state(false);

	async function loadUsers() {
		await cleanupDuplicateUsers();

		if (isAdmin && navigator.onLine) {
			// Force a fresh roster pull so that any emails (or first/last names) that were added/edited
			// directly in PocketBase (or via user profile updates) are brought down into Dexie.
			// Without force, the per-session guard can cause emails to appear "not syncing".
			await pullUsersFromServer(true);
		}

		const raw = await db.users.toArray();
		const seen = new Set();
		allUsers = raw.filter((u: any) => {
			const key = u.email || u.pbId || u.id;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	async function refreshRoster() {
		if (!isAdmin) return;
		hasAutoLoadedRoster = false;
		if (!navigator.onLine) {
			alert('Go online to refresh the roster from PocketBase.');
			return;
		}
		await pullUsersFromServer(true);
		await loadUsers();
	}

	function openNewUser() {
		showNewModal = true;
	}

	function openJobs(user: User) {
		selectedUser = user;
		showJobsModal = true;
	}

	async function openEdit(user: User) {
		selectedUser = user;
		editFirstName = user.firstName || (user.name ? user.name.split(' ')[0] : '');
		editLastName = user.lastName || (user.name ? user.name.split(' ').slice(1).join(' ') : '');
		editRole = user.role;
		editForcePhoto = user.forcePhotoUpdate ?? false;
		editPhotoLocked = user.photoLocked ?? false;
		editEmail = user.email || '';
		editActive = user.active;
		editPhotoPreview = null;
		pendingDelete = false;

		// Check if this user (by name) is still assigned to any jobs.
		// If so, hide the delete button (only allow deactivate).
		// Uses the safe helper (tries the *assignedCrew multiEntry index; falls back to scan on SchemaError).
		const userName = user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim();
		const assigned = await getJobsForCrewMember(userName);
		editUserHasJobs = assigned.length > 0;

		showEditModal = true;
	}

	async function saveEdit() {
		if (!selectedUser || (!editFirstName.trim() && !editLastName.trim()) || !isAdmin) return;
		if (editSaving || editPhotoBusy) return;

		if (pendingDelete) {
			// Actual delete (and any error checks) happens here on Save, giving the user time to Cancel the modal.
			await deleteUser(selectedUser.id!);
			closeEditModal();
			return;
		}

		const adminCount = allUsers.filter((u) => u.role === 'admin' && u.active).length;

		// Active status change checks (moved from immediate toggle).
		// Compute what the resulting active-admin count would be *after* this change.
		// Only block if we are *deactivating* an admin and it would leave zero active admins.
		// Reactivating must always be allowed (even if it is the "first" active admin).
		if (editActive !== selectedUser.active) {
			if (selectedUser.role === 'admin') {
				let resultingActiveAdmins = adminCount;
				if (selectedUser.active) {
					// currently counted as active; we are turning it off
					resultingActiveAdmins = adminCount - 1;
				} else {
					// currently not counted; we are turning it on
					resultingActiveAdmins = adminCount + 1;
				}
				if (!editActive && resultingActiveAdmins <= 0) {
					toast.error('Cannot deactivate the last active admin.');
					return;
				}
			}
		}

		if (selectedUser.role === 'admin' && editRole !== 'admin' && adminCount <= 1) {
			toast.error('Cannot remove the last active admin.');
			return;
		}

		editSaving = true;
		try {
			const first = editFirstName.trim();
			const last = editLastName.trim();
			const userId = selectedUser.id!;

			// Admin-set photo first so forcePhotoUpdate can stay false after a successful set.
			if (editPhotoPreview) {
				try {
					const { synced } = await updateUserPhoto(userId, editPhotoPreview, {
						bypassLock: true
					});
					if (!synced && navigator.onLine) {
						toast.error(
							'Photo saved on this device but could not reach the server. Refresh roster after they sign in, or try again online.'
						);
					} else if (synced) {
						toast.success('Crew photo updated');
					}
				} catch (err: any) {
					console.error('Admin crew photo save failed:', err);
					toast.error(err?.message || 'Failed to save crew photo');
					return;
				}
			}

			await updateUser(userId, {
				firstName: first,
				lastName: last,
				name: `${first} ${last}`.trim(),
				role: editRole,
				// If admin uploaded a photo this save, never leave force-on.
				forcePhotoUpdate: editPhotoPreview ? false : editForcePhoto,
				photoLocked: editPhotoLocked,
				email: editEmail.trim() || undefined,
				active: editActive,
				updatedAt: new Date()
			});

			closeEditModal();
			await loadUsers();
		} finally {
			editSaving = false;
		}
	}

	async function toggleActive(user: User) {
		if (!isAdmin) return;

		const adminCount = allUsers.filter((u) => u.role === 'admin' && u.active).length;

		// Compute resulting active admin count after the flip.
		// Only ever block *deactivation* of the last active admin.
		// Reactivation must be allowed.
		if (user.role === 'admin') {
			const intendedActive = !user.active;
			let resultingActiveAdmins = adminCount;
			if (user.active) {
				// currently active → flip will deactivate
				resultingActiveAdmins = adminCount - 1;
			} else {
				// currently inactive → flip will activate
				resultingActiveAdmins = adminCount + 1;
			}
			if (!intendedActive && resultingActiveAdmins <= 0) {
				toast.error('Cannot deactivate the last active admin.');
				return;
			}
		}

		// )=- Use updateUser for PB sync.
		await updateUser(user.id!, {
			active: !user.active,
			updatedAt: new Date()
		});
		await loadUsers();
	}

	async function deleteUser(id: string) {
		if (!isAdmin) return;

		const userToDelete = allUsers.find((u) => u.id === id);
		if (!userToDelete) return;

		// Prevent deletion if the user is still assigned to any jobs.
		// Only allow deactivation in that case. This check now only runs on Save.
		const userName =
			userToDelete.name || `${userToDelete.firstName || ''} ${userToDelete.lastName || ''}`.trim();
		// Safe helper (index or full scan fallback) so SchemaError on assignedCrew never crashes delete path.
		const assignedJobs = await getJobsForCrewMember(userName);
		if (assignedJobs.length > 0) {
			toast.error(
				'Cannot delete this user because they are still assigned to jobs. Please deactivate instead (they will no longer appear in new job assignments).'
			);
			return;
		}

		if (userToDelete?.role === 'admin') {
			const activeAdmins = allUsers.filter(
				(u) => u.role === 'admin' && u.active && u.id !== id
			).length;
			if (activeAdmins === 0) {
				toast.error('Cannot delete the last active admin.');
				return;
			}
		}

		await deleteUserFromDb(id);
		await loadUsers();
	}

	$effect(() => {
		if (isAdmin && !hasAutoLoadedRoster) {
			hasAutoLoadedRoster = true;
			loadUsers();
		}
	});
</script>

<div class="user-management">
	<header class="user-management__header">
		<h1 class="user-management__title">User Management</h1>
		<div class="user-management__header-actions">
			<button onclick={openNewUser} class="user-management__add-btn button button--primary"
				>+ Add New User</button
			>
			<button
				onclick={refreshRoster}
				class="user-management__add-btn button"
				title="Refresh roster from server">Refresh roster</button
			>
		</div>
	</header>

	<div class="user-management__scroll-container">
		{#snippet userRow(user: User)}
			<div class="user-management__row">
				<!-- Avatar -->
				<div class="user-management__avatar-col">
					<div class="user-management__avatar">
						{#if user.photo}
							<!-- )=- Use the centralized getUserPhotoSrc helper so bare PB filenames become full /api/files/... URLs instead of relative paths (which resolve to /admin/blob_... and 404). -->
							<img
								src={getUserPhotoSrc(user.photo, user)}
								alt={`${user.firstName} ${user.lastName || user.name || ''}`}
								class="user-management__avatar-img"
							/>
						{:else}
							<span class="user-management__avatar-placeholder"
								>{(user.firstName || user.name || 'U').slice(0, 1).toUpperCase()}</span
							>
						{/if}
					</div>
				</div>

				<!-- Name -->
				<div class="user-management__name-col">
					<span class="user-management__name"
						>{user.firstName} {user.lastName || user.name || ''}</span
					>
				</div>

				<!-- Email -->
				<div class="user-management__email-col">
					<span class="user-management__email">
						{user.email || '— no email —'}
					</span>
				</div>

				<!-- Role -->
				<div class="user-management__role-col">
					<span class="user-management__role-badge user-management__role-badge--{user.role}">
						{user.role}
					</span>
				</div>

				<!-- Status -->
				<div class="user-management__status-col">
					<span
						class="user-management__status-badge user-management__status-badge--{user.active
							? 'active'
							: 'inactive'}"
					>
						{user.active ? '✅ Active' : '⛔ Inactive'}
					</span>
				</div>

				<!-- Actions -->
				<div class="user-management__actions-col">
					<button
						onclick={() => openJobs(user)}
						class="user-management__btn user-management__btn--jobs">View Jobs</button
					>
					<button
						onclick={() => openEdit(user)}
						class="user-management__btn user-management__btn--edit">Edit</button
					>
				</div>
			</div>
		{/snippet}

		<div class="user-management__section">
			<h3 class="user-management__section-title">Active Crew ({activeUsers.length})</h3>
			<div class="user-management__grid">
				{#each activeUsers as user (user.id)}
					{@render userRow(user)}
				{/each}
			</div>
		</div>

		<div class="user-management__section user-management__section--deactivated">
			<h3 class="user-management__section-title">Deactivated Crew ({deactivatedUsers.length})</h3>
			<div class="user-management__grid">
				{#each deactivatedUsers as user (user.id)}
					{@render userRow(user)}
				{/each}
			</div>
		</div>
	</div>

	<!-- Modals -->
	{#if showNewModal}
		<NewUserModal
			onClose={(success) => {
				showNewModal = false;
				if (success) loadUsers();
			}}
		/>
	{/if}

	{#if showJobsModal && selectedUser}
		<UserJobsModal
			userId={selectedUser.name ||
				`${selectedUser.firstName} ${selectedUser.lastName || ''}`.trim()}
			userName={`${selectedUser.firstName} ${selectedUser.lastName || selectedUser.name || ''}`.trim()}
			onClose={() => (showJobsModal = false)}
		/>
	{/if}

	{#if showEditModal && selectedUser}
		<div
			class="modal-overlay"
			role="presentation"
			onpointerdown={editBackdrop.onpointerdown}
			onclick={editBackdrop.onclick}
		>
			<div
				class="modal-content"
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						e.stopPropagation();
						closeEditModal();
					}
				}}
			>
				<h2 class="modal__title">
					Edit {selectedUser.firstName || ''}
					{selectedUser.lastName || selectedUser.name || ''}
				</h2>

				<!-- Scrollable body so actions stay anchored at bottom regardless of form height -->
				<div class="modal__body">
					<div class="modal__form">
						<!-- Admin photo management: camera or gallery, then optional lock. -->
						<div class="modal__photo-block">
							<span class="modal__label label">Photo</span>
							<div class="modal__photo-row">
								<div class="modal__photo-preview" aria-hidden={editPhotoDisplaySrc ? 'false' : 'true'}>
									{#if editPhotoDisplaySrc}
										<img
											src={editPhotoDisplaySrc}
											alt=""
											class="modal__photo-img"
										/>
									{:else}
										<span class="modal__photo-placeholder">
											{(editFirstName || selectedUser.firstName || selectedUser.name || 'U')
												.slice(0, 1)
												.toUpperCase()}
										</span>
									{/if}
								</div>
								<div class="modal__photo-controls">
									<button
										type="button"
										class="modal__btn button button--primary modal__photo-upload-btn"
										onclick={triggerEditPhoto}
										disabled={editPhotoBusy || editSaving}
									>
										{editPhotoBusy
											? 'Processing…'
											: editPhotoPreview
												? 'Change photo'
												: 'Take photo or upload'}
									</button>
									<input
										bind:this={editPhotoInput}
										type="file"
										accept="image/*"
										capture="environment"
										class="modal__photo-file-input"
										onchange={onEditPhotoSelected}
									/>
									{#if editPhotoPreview}
										<button
											type="button"
											class="modal__text-action"
											onclick={clearEditPhotoPreview}
											disabled={editSaving}
										>
											Undo new photo
										</button>
									{/if}
									<p class="modal__photo-hint">
										Uses this device’s camera or photo library. Saved to the crew record when you
										press Save.
									</p>
								</div>
							</div>
						</div>

						<label class="modal__label label">
							First Name
							<input type="text" bind:value={editFirstName} class="modal__input input" />
						</label>

						<label class="modal__label label">
							Last Name
							<input type="text" bind:value={editLastName} class="modal__input input" />
						</label>

						<label class="modal__label label">
							Role
							<select bind:value={editRole} class="modal__select input">
								<option value="crew">Crew</option>
								<option value="admin">Admin</option>
							</select>
						</label>

						<label class="modal__label label">
							Email Address
							<input
								type="email"
								bind:value={editEmail}
								class="modal__input input"
								placeholder="user@capitalcitywindows.com"
							/>
						</label>

						<label class="modal__checkbox-label label">
							<input
								type="checkbox"
								checked={editForcePhoto}
								onchange={onForcePhotoChange}
								disabled={editPhotoLocked}
							/>
							Force new photo upload
						</label>

						<label class="modal__checkbox-label label">
							<input
								type="checkbox"
								checked={editPhotoLocked}
								onchange={onPhotoLockedChange}
							/>
							Lock photo (crew cannot change it)
						</label>
						<p class="modal__field-help">
							Off by default. When locked, only admins can update this person’s photo.
						</p>
					</div>

					{#if canResendWelcome(selectedUser)}
						<div class="modal__welcome-panel">
							<p class="modal__welcome-title">Welcome email</p>
							<p class="modal__welcome-copy">
								Sends a link to set their password and activate the account to
								<strong> {selectedUser.email}</strong>. Use this if they never got the first email
								or the link expired.
							</p>
							<button
								type="button"
								class="modal__btn button button--primary modal__welcome-btn"
								disabled={resendingWelcome}
								onclick={() => selectedUser && resendWelcomeEmail(selectedUser)}
							>
								{resendingWelcome ? 'Sending…' : 'Resend welcome email'}
							</button>
						</div>
					{:else if selectedUser && !selectedUser.email}
						<div class="modal__welcome-panel modal__welcome-panel--muted">
							<p class="modal__welcome-copy">
								Add an email address and save before you can send a welcome email.
							</p>
						</div>
					{/if}

					{#if pendingDelete}
						<div class="modal__delete-pending">
							This user will be <strong>permanently deleted</strong> when you save changes. Click Cancel
							to abort.
						</div>
					{/if}
				</div>

				<!-- Anchored actions: primary right-aligned first, then de-emphasized text actions below.
				     All right aligned. Deactivate/Delete as plain text (yellow/red) to de-emphasize. -->
				<div class="modal__actions">
					<div class="modal__primary-actions">
						<button
							onclick={() => {
								pendingDelete = false;
								editUserHasJobs = false;
								showEditModal = false;
								selectedUser = null;
							}}
							class="modal__btn modal__btn--cancel button button--ghost">Cancel</button
						>
						<button
							onclick={saveEdit}
							class="modal__btn modal__btn--save button button--primary"
							disabled={editSaving || editPhotoBusy}
						>
							{editSaving ? 'Saving…' : 'Save'}
						</button>
					</div>

					<div class="modal__secondary-actions">
						<button
							onclick={() => (editActive = !editActive)}
							class="modal__text-action modal__text-action--warning"
						>
							{editActive ? 'Deactivate User' : 'Activate User'}
						</button>
						{#if !editUserHasJobs}
							<button
								onclick={() => {
									pendingDelete = true;
								}}
								class="modal__text-action modal__text-action--danger">Delete User</button
							>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.user-management {
		max-width: 1350px;
		margin: 0 auto;
		padding: var(--space-6) var(--space-4);
	}

	.user-management__scroll-container {
		width: 100%;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}

	.user-management__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-6);
	}

	.user-management__header-actions {
		display: flex;
		gap: var(--space-2);
	}

	.user-management__title {
		font-size: var(--font-size-3xl);
		margin: 0;
		color: var(--color-text);
	}

	.user-management__add-btn {
		/* base button + specific */
		padding: var(--space-3) var(--space-6);
	}

	.user-management__grid {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* Section headers for Active / Deactivated split (BEM).
	   Deactivated section uses muted styling and lives below the active list.
	   Toggling active (in edit modal Save) + loadUsers() causes the $derived lists
	   to re-partition, moving the row between sections automatically. */
	.user-management__section {
		margin-bottom: var(--space-8);
	}
	.user-management__section:last-child {
		margin-bottom: 0;
	}
	.user-management__section-title {
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		margin: 0 0 var(--space-3) 0;
		color: var(--color-text);
		border-bottom: 1px solid var(--color-border);
		padding-bottom: var(--space-2);
	}
	.user-management__section--deactivated .user-management__section-title {
		color: var(--color-text-muted);
	}
	.user-management__section--deactivated .user-management__grid {
		opacity: 0.9;
	}

	.user-management__row {
		display: grid;
		grid-template-columns: 56px minmax(120px, 1.4fr) minmax(100px, 1.8fr) 78px 108px auto;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sm);
		border: 1px solid var(--color-border);
	}

	.modal__welcome-panel {
		margin-top: var(--space-4);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid color-mix(in srgb, var(--color-primary) 30%, var(--color-border));
		background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
	}
	.modal__welcome-panel--muted {
		border-color: var(--color-border);
		background: var(--color-surface);
	}
	.modal__welcome-title {
		margin: 0 0 var(--space-2) 0;
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}
	.modal__welcome-copy {
		margin: 0 0 var(--space-3) 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		line-height: 1.45;
	}
	.modal__welcome-btn {
		width: 100%;
	}

	.user-management__avatar-col {
		flex-shrink: 0;
	}
	.user-management__avatar {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--color-surface-alt);
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		border: 1px solid var(--color-border);
	}
	.user-management__avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.user-management__avatar-placeholder {
		font-size: 1.8rem;
		font-weight: bold;
		color: var(--color-text-muted);
	}

	.user-management__name-col {
		min-width: 0;
	}
	.user-management__email-col {
		min-width: 0;
	}
	.user-management__name {
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
	}
	.user-management__email {
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: block;
	}

	.user-management__role-col {
		min-width: 0;
	}
	.user-management__status-col {
		min-width: 0;
	}

	.user-management__role-badge,
	.user-management__status-badge {
		padding: 0.35rem 1rem;
		border-radius: 9999px;
		font-size: 0.85rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.user-management__role-badge--admin {
		background: #9c27b0;
		color: white;
	}
	.user-management__role-badge--crew {
		background: var(--color-primary);
		color: white;
	}
	.user-management__status-badge--active {
		background: var(--color-success);
		color: white;
	}
	.user-management__status-badge--inactive {
		background: var(--color-danger);
		color: white;
	}

	.user-management__actions-col {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.user-management__btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.user-management__btn--jobs {
		background: #673ab7;
		color: white;
	}
	.user-management__btn--edit {
		background: var(--color-primary);
		color: white;
	}
	.user-management__btn--email {
		background: var(--color-warning);
		color: white;
	}

	/* Modal shell base (.modal-overlay / .modal-content) now from globals.css for cohesion.
	   Only the .modal__* BEM extensions and specifics remain here. */

	.modal__title {
		margin: 0 0 var(--space-4) 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
		padding: 0 var(--space-4); /* consistent padding since global modal shell has none */
	}

	/* Scrollable body for anchored actions */
	.modal__body {
		flex: 1 1 auto;
		overflow-y: auto;
		min-height: 0;
		padding: 0 var(--space-4);
	}

	.modal__form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
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

	.modal__checkbox-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}

	.modal__field-help {
		margin: calc(var(--space-2) * -1) 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.35;
	}

	.modal__photo-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.modal__photo-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}

	.modal__photo-preview {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
		border: 2px solid var(--color-border);
		background: var(--color-surface-alt);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal__photo-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.modal__photo-placeholder {
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
	}

	.modal__photo-controls {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		min-width: 0;
		flex: 1;
	}

	.modal__photo-upload-btn {
		width: auto;
		padding: var(--space-2) var(--space-4);
		font-size: var(--font-size-sm);
	}

	.modal__photo-file-input {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.modal__photo-hint {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.35;
	}

	/* Anchored actions at bottom of modal (right aligned).
	   Primary (Cancel/Save) first, then de-emphasized text actions below. */
	.modal__actions {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-4);
		padding: 0 var(--space-4) var(--space-4);
		background: var(--color-surface); /* ensure visible over scroll */
		border-top: 1px solid var(--color-border);
	}

	.modal__primary-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.modal__secondary-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
		margin-top: var(--space-2);
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

	/* De-emphasized text actions (no button chrome) */
	.modal__text-action {
		background: none;
		border: none;
		padding: 0;
		font-size: var(--font-size-sm);
		cursor: pointer;
		text-decoration: underline;
		opacity: 0.9;
	}

	.modal__text-action--warning {
		color: var(--color-warning);
	}

	.modal__text-action--danger {
		color: var(--color-danger);
	}

	.modal__text-action:hover {
		opacity: 1;
	}

	/* Edit modal specific: override to anchor actions (body scrolls) */
	.modal-content {
		display: flex;
		flex-direction: column;
		overflow: hidden !important;
		max-height: 90vh;
	}

	/* Mobile tweaks for anchored edit actions */
	@media (max-width: 768px) {
		.modal__title {
			padding: 0 var(--space-3);
			font-size: var(--font-size-lg);
		}

		.modal__body {
			padding: 0 var(--space-3);
		}

		.modal__actions {
			align-items: stretch;
			padding: var(--space-3);
			gap: var(--space-3);
		}

		.modal__primary-actions {
			display: flex;
			flex-direction: row;
			width: 100%;
			gap: var(--space-2);
		}

		.modal__primary-actions .modal__btn {
			flex: 1;
			width: auto;
			min-width: 0;
			padding: var(--space-3) var(--space-2);
			text-align: center;
		}

		.modal__secondary-actions {
			width: 100%;
			flex-wrap: wrap;
			justify-content: center;
			gap: var(--space-3);
			margin-top: 0;
		}
	}

	.modal__delete-pending {
		margin-top: var(--space-4);
		padding: var(--space-3);
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
	}

	/* ============================================
	   MOBILE CREW PAGE (stacked cards instead of wide grid)
	   Fixes horizontal overflow / "too wide" on phones and small tablets.
	   Desktop keeps the compact tabular grid.
	   Matches card-list patterns used on jobs/clients pages.
	   BEM + tokens only.
	   ============================================ */
	@media (max-width: 768px) {
		.user-management {
			padding: var(--space-3) var(--space-2);
			max-width: 100%;
		}

		.user-management__header {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-2);
			margin-bottom: var(--space-4);
		}

		.user-management__title {
			font-size: var(--font-size-2xl);
		}

		.user-management__header-actions {
			width: 100%;
			flex-wrap: wrap;
		}

		.user-management__add-btn {
			flex: 1 1 auto;
			min-width: 0;
			font-size: var(--font-size-sm);
			padding: var(--space-2) var(--space-3);
		}

		.user-management__grid {
			gap: var(--space-2);
		}

		/* Turn each user row into a mobile-friendly stacked card.
		   Uses flex + order so avatar+name+badges share a line,
		   email drops below, actions become a button row underneath.
		   No markup changes required. */
		.user-management__row {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			padding: var(--space-3) var(--space-3);
		}

		.user-management__avatar-col {
			order: 1;
			flex-shrink: 0;
		}

		.user-management__name-col {
			order: 2;
			flex: 1 1 auto;
			min-width: 0;
			margin-right: var(--space-2);
		}

		.user-management__status-col {
			order: 3;
			flex-shrink: 0;
		}

		.user-management__role-col {
			order: 4;
			flex-shrink: 0;
		}

		.user-management__email-col {
			order: 5;
			width: 100%;
			flex-basis: 100%;
			margin-top: var(--space-1);
		}

		.user-management__actions-col {
			order: 6;
			width: 100%;
			flex-basis: 100%;
			margin-top: var(--space-2);
			justify-content: flex-start;
			gap: var(--space-2);
		}

		.user-management__name {
			font-size: var(--font-size-base);
		}

		.user-management__email {
			font-size: var(--font-size-sm);
		}

		.user-management__role-badge,
		.user-management__status-badge {
			padding: 0.15rem 0.55rem;
			font-size: var(--font-size-xs);
		}

		.user-management__btn {
			flex: 1;
			padding: var(--space-2) var(--space-3);
			font-size: var(--font-size-sm);
			text-align: center;
		}
	}
</style>
