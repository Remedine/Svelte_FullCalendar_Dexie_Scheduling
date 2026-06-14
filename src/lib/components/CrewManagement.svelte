<!-- src/lib/components/CrewManagement.svelte -->
<script lang="ts">
	import {
		db,
		type User,
		updateUser,
		deleteUser as deleteUserFromDb,
		getUserPhotoSrc,
		cleanupDuplicateUsers
	} from '$lib/db';
	import { auth } from '$lib/stores/auth.svelte';
	import NewUserModal from './NewUserModal.svelte';
	import UserJobsModal from './UserJobsModal.svelte';
	import { loginWithEmail, pullUsersFromServer } from '$lib/db/pb';

	let allUsers = $state<User[]>([]);

	let showNewModal = $state(false);
	let showJobsModal = $state(false);
	let showEditModal = $state(false);

	let selectedUser = $state<User | null>(null);
	let editFirstName = $state('');
	let editLastName = $state('');
	let editRole = $state<'admin' | 'crew'>('crew');
	let editForcePhoto = $state(false);
	let editEmail = $state('');
	let editActive = $state(true);

	const isAdmin = $derived(auth.currentUser?.role === 'admin');

	// Guard so we only auto-load the roster once per page instance (prevents repeated server calls on reactivity).
	let hasAutoLoadedRoster = $state(false);

	async function loadUsers() {
		await cleanupDuplicateUsers();

		if (isAdmin && navigator.onLine) {
			await pullUsersFromServer();
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

	function openEdit(user: User) {
		selectedUser = user;
		editFirstName = user.firstName || (user.name ? user.name.split(' ')[0] : '');
		editLastName = user.lastName || (user.name ? user.name.split(' ').slice(1).join(' ') : '');
		editRole = user.role;
		editForcePhoto = user.forcePhotoUpdate ?? false;
		editEmail = user.email || '';
		editActive = user.active;
		showEditModal = true;
	}



	async function saveEdit() {
		if (!selectedUser || (!editFirstName.trim() && !editLastName.trim()) || !isAdmin) return;

		const adminCount = allUsers.filter((u) => u.role === 'admin' && u.active).length;

		// Active status change checks (moved from immediate toggle)
		if (editActive !== selectedUser.active) {
			if (selectedUser.role === 'admin' && editActive && adminCount <= 1) {
				alert('Cannot deactivate the last active admin.');
				return;
			}
			if (selectedUser.role === 'admin' && !editActive && adminCount === 0) {
				alert('Must keep at least one active admin.');
				return;
			}
		}

		if (selectedUser.role === 'admin' && editRole !== 'admin' && adminCount <= 1) {
			alert('Cannot remove the last active admin.');
			return;
		}

		const first = editFirstName.trim();
		const last = editLastName.trim();
		await updateUser(selectedUser.id!, {
			firstName: first,
			lastName: last,
			name: `${first} ${last}`.trim(),
			role: editRole,
			forcePhotoUpdate: editForcePhoto,
			email: editEmail.trim() || undefined,
			active: editActive,
			updatedAt: new Date()
		});

		showEditModal = false;
		selectedUser = null;
		await loadUsers();
	}



	async function toggleActive(user: User) {
		if (!isAdmin) return;

		const adminCount = allUsers.filter((u) => u.role === 'admin' && u.active).length;

		if (user.role === 'admin' && !user.active && adminCount === 0) {
			alert('Must keep at least one active admin.');
			return;
		}

		if (user.role === 'admin' && user.active && adminCount <= 1) {
			alert('Cannot deactivate the last active admin.');
			return;
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
		if (userToDelete?.role === 'admin') {
			const activeAdmins = allUsers.filter(
				(u) => u.role === 'admin' && u.active && u.id !== id
			).length;
			if (activeAdmins === 0) {
				alert('Cannot delete the last active admin.');
				return;
			}
		}

		if (confirm('Delete this user permanently?')) {
			await deleteUserFromDb(id);
			await loadUsers();
		}
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
			<button onclick={openNewUser} class="user-management__add-btn button button--primary">+ Add New User</button>
			<button onclick={refreshRoster} class="user-management__add-btn button" title="Refresh roster from server">Refresh roster</button>
		</div>
	</header>

	<div class="user-management__scroll-container">
		<div class="user-management__grid">
			{#each allUsers as user (user.id)}
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
		{/each}
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
			userId={selectedUser.id!}
			userName={`${selectedUser.firstName} ${selectedUser.lastName || selectedUser.name || ''}`.trim()}
			onClose={() => (showJobsModal = false)}
		/>
	{/if}

	{#if showEditModal && selectedUser}
		<div
			class="modal-overlay"
			role="presentation"
			onclick={() => {
				showEditModal = false;
				selectedUser = null;
			}}
		>
			<div
				class="modal-content"
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => {
					if (e.key === 'Escape') {
						e.stopPropagation();
						showEditModal = false;
						selectedUser = null;
					}
				}}
			>
				<h2 class="modal__title">
					Edit {selectedUser.firstName || ''}
					{selectedUser.lastName || selectedUser.name || ''}
				</h2>
				<div class="modal__form">
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
						<input type="email" bind:value={editEmail} class="modal__input input" placeholder="user@capitalcitywindows.com" />
					</label>

					<label class="modal__checkbox-label label">
						<input type="checkbox" bind:checked={editForcePhoto} />
						Force new photo upload
					</label>
				</div>

				<div class="modal__actions">
					<div class="modal__actions-left">
						<button onclick={() => editActive = !editActive} class="modal__btn modal__btn--toggle button">
							{editActive ? 'Deactivate User' : 'Activate User'}
						</button>
						<button
							onclick={() => deleteUser(selectedUser!.id!)}
							class="modal__btn modal__btn--delete button">Delete User</button
						>
					</div>
					<div class="modal__actions-right">
						<button
							onclick={() => {
								showEditModal = false;
								selectedUser = null;
							}}
							class="modal__btn modal__btn--cancel button button--ghost">Cancel</button
						>
						<button onclick={saveEdit} class="modal__btn modal__btn--save button button--primary">Save Changes</button>
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

	/* Modal styles for edit and email modals (tokenized for cohesion with NewUserModal and other modals) */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal-backdrop);
	}
	.modal-content {
		background: var(--color-surface);
		border-radius: var(--radius-md);
		width: 90%;
		max-width: 420px;
		padding: var(--space-6);
	}
	.modal__title {
		margin: 0 0 var(--space-6) 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
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
	.modal__actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: var(--space-6);
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.modal__actions-left,
	.modal__actions-right {
		display: flex;
		gap: var(--space-2);
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
	.modal__btn--toggle {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}
	.modal__btn--delete {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
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
