<!-- src/lib/components/CrewManagement.svelte -->
<script lang="ts">
  import { db, type User, updateUser, deleteUser as deleteUserFromDb, getUserPhotoSrc } from '$lib/db';
  import { auth } from '$lib/stores/auth.svelte';
  import NewUserModal from './NewUserModal.svelte';
  import UserJobsModal from './UserJobsModal.svelte';
  import { loginWithEmail, pullUsersFromServer } from '$lib/db/pb';

  let allUsers = $state<User[]>([]);

  let showNewModal = $state(false);
  let showJobsModal = $state(false);
  let showEditModal = $state(false);
  let showEmailModal = $state(false);

  let selectedUser = $state<User | null>(null);
  let editFirstName = $state('');
  let editLastName = $state('');
  let editRole = $state<'admin' | 'crew'>('crew');
  let editForcePhoto = $state(false);
  let editEmail = $state('');

  let isAdmin = $derived(auth.currentUser?.role === 'admin');

  // Guard so we only auto-load the roster once per page instance (prevents repeated server calls on reactivity).
  let hasAutoLoadedRoster = $state(false);

  async function loadUsers() {
    const { cleanupDuplicateUsers } = await import('$lib/db');
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
    showEditModal = true;
  }

  function openEmailLink(user: User) {
    selectedUser = user;
    editEmail = user.email || '';
    showEmailModal = true;
  }

  async function saveEdit() {
    if (!selectedUser || (!editFirstName.trim() && !editLastName.trim()) || !isAdmin) return;

    const adminCount = allUsers.filter(u => u.role === 'admin' && u.active).length;
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
      updatedAt: new Date()
    });

    showEditModal = false;
    selectedUser = null;
    await loadUsers();
  }

  async function saveEmailLink() {
    if (!selectedUser || !editEmail.trim()) return;

    // )=- Use updateUser for PB sync consistency.
    await updateUser(selectedUser.id!, { 
      email: editEmail.trim(),
      updatedAt: new Date()
    });

    console.log(`✅ Email linked for ${selectedUser.name}`);
    showEmailModal = false;
    selectedUser = null;
    await loadUsers();
  }

  async function toggleActive(user: User) {
    if (!isAdmin) return;

    const adminCount = allUsers.filter(u => u.role === 'admin' && u.active).length;

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

    const userToDelete = allUsers.find(u => u.id === id);
    if (userToDelete?.role === 'admin') {
      const activeAdmins = allUsers.filter(u => u.role === 'admin' && u.active && u.id !== id).length;
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
    <div style="display: flex; gap: 0.5rem;">
      <button onclick={openNewUser} class="user-management__add-btn">+ Add New User</button>
      <button onclick={refreshRoster} class="user-management__add-btn" style="background: #2196f3;">Refresh roster from server</button>
    </div>
  </header>

  <div class="user-management__grid">
    {#each allUsers as user (user.id)}
      <div class="user-management__row">
        <!-- Avatar -->
        <div class="user-management__avatar-col">
          <div class="user-management__avatar">
            {#if user.photo}
              <!-- )=- Use the centralized getUserPhotoSrc helper so bare PB filenames become full /api/files/... URLs instead of relative paths (which resolve to /admin/blob_... and 404). -->
              <img src={getUserPhotoSrc(user.photo, user)} alt={`${user.firstName} ${user.lastName || user.name || ''}`} class="user-management__avatar-img" />
            {:else}
              <span class="user-management__avatar-placeholder">{(user.firstName || user.name || 'U').slice(0,1).toUpperCase()}</span>
            {/if}
          </div>
        </div>

        <!-- Name -->
        <div class="user-management__name-col">
          <span class="user-management__name">{user.firstName} {user.lastName || user.name || ''}</span>
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
          <span class="user-management__status-badge user-management__status-badge--{user.active ? 'active' : 'inactive'}">
            {user.active ? '✅ Active' : '⛔ Inactive'}
          </span>
        </div>

        <!-- Actions -->
        <div class="user-management__actions-col">
          <button onclick={() => openJobs(user)} class="user-management__btn user-management__btn--jobs">View Jobs</button>
          <button onclick={() => openEdit(user)} class="user-management__btn user-management__btn--edit">Edit</button>
          <button onclick={() => openEmailLink(user)} class="user-management__btn user-management__btn--email">
            {user.email ? 'Change Email' : 'Link Email'}
          </button>
        </div>
      </div>
    {/each}
  </div>

  <!-- Modals -->
  {#if showNewModal}
    <NewUserModal onClose={(success) => { showNewModal = false; if (success) loadUsers(); }} />
  {/if}

  {#if showJobsModal && selectedUser}
    <UserJobsModal userId={selectedUser.id!} userName={`${selectedUser.firstName} ${selectedUser.lastName || selectedUser.name || ''}`.trim()} onClose={() => showJobsModal = false} />
  {/if}

  {#if showEditModal && selectedUser}
    <div class="modal-overlay" onclick={() => { showEditModal = false; selectedUser = null; }}>
      <div class="modal-content" onclick={e => e.stopPropagation()}>
        <h2 class="modal__title">Edit {selectedUser.firstName || ''} {selectedUser.lastName || selectedUser.name || ''}</h2>
        <div class="modal__form">
          <label class="modal__label">First Name</label>
          <input type="text" bind:value={editFirstName} class="modal__input" />

          <label class="modal__label">Last Name</label>
          <input type="text" bind:value={editLastName} class="modal__input" />

          <label class="modal__label">Role</label>
          <select bind:value={editRole} class="modal__select">
            <option value="crew">Crew</option>
            <option value="admin">Admin</option>
          </select>

          <label class="modal__checkbox-label">
            <input type="checkbox" bind:checked={editForcePhoto} />
            Force new photo upload
          </label>
        </div>

        <div class="modal__actions">
          <button onclick={() => toggleActive(selectedUser!)} class="modal__btn modal__btn--toggle">
            {selectedUser.active ? 'Deactivate User' : 'Activate User'}
          </button>
          <button onclick={() => deleteUser(selectedUser!.id!)} class="modal__btn modal__btn--delete">Delete User</button>
          <button onclick={() => { showEditModal = false; selectedUser = null; }} class="modal__btn modal__btn--cancel">Cancel</button>
          <button onclick={saveEdit} class="modal__btn modal__btn--save">Save Changes</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showEmailModal && selectedUser}
    <div class="modal-overlay" onclick={() => { showEmailModal = false; selectedUser = null; }}>
      <div class="modal-content" onclick={e => e.stopPropagation()}>
        <h2 class="modal__title">Link Email for {selectedUser.firstName} {selectedUser.lastName || selectedUser.name || ''}</h2>
        <div class="modal__form">
          <label class="modal__label">Email Address</label>
          <input 
            type="email" 
            bind:value={editEmail} 
            class="modal__input" 
            placeholder="user@capitalcitywindows.com" 
          />
        </div>
        <div class="modal__actions">
          <button onclick={() => { showEmailModal = false; selectedUser = null; }} class="modal__btn modal__btn--cancel">Cancel</button>
          <button onclick={saveEmailLink} class="modal__btn modal__btn--save">Save & Link Email</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
 
  .user-management {
    max-width: 1350px;
    margin: 0 auto;
    padding: 2rem;
  }

  .user-management__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .user-management__title { font-size: 1.8rem; margin: 0; }

  .user-management__add-btn {
    background: #4caf50;
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .user-management__grid {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .user-management__row {
    display: grid;
    grid-template-columns: 64px 220px 180px 100px 160px auto;
    align-items: center;
    gap: 16px;
    padding: 1rem 1.5rem;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }

  .user-management__avatar-col { flex-shrink: 0; }
  .user-management__avatar {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #e0e0e0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .user-management__avatar-img { width: 100%; height: 100%; object-fit: cover; }
  .user-management__avatar-placeholder { font-size: 1.8rem; font-weight: bold; color: #555; }

  .user-management__name-col { width: 220px; flex-shrink: 0; }
  .user-management__email-col { width: 180px; flex-shrink: 0; }
  .user-management__name { font-size: 1.1rem; font-weight: 600; }
  .user-management__email { font-size: 0.95rem; color: #64748b; }

  .user-management__role-col { width: 100px; flex-shrink: 0; }
  .user-management__status-col { width: 160px; flex-shrink: 0; }

  .user-management__role-badge,
  .user-management__status-badge {
    padding: 0.35rem 1rem;
    border-radius: 9999px;
    font-size: 0.85rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .user-management__role-badge--admin { background: #9c27b0; color: white; }
  .user-management__role-badge--crew  { background: #2196f3; color: white; }
  .user-management__status-badge--active   { background: #4caf50; color: white; }
  .user-management__status-badge--inactive { background: #f44336; color: white; }

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

  .user-management__btn--jobs { background: #673ab7; color: white; }
  .user-management__btn--edit  { background: #2196f3; color: white; }
  .user-management__btn--email { background: #f59e0b; color: white; }

  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal-content { background: white; border-radius: 8px; width: 90%; max-width: 420px; padding: 2rem; }
  .modal__title { margin: 0 0 1.5rem 0; font-size: 1.5rem; }
  .modal__form { display: flex; flex-direction: column; gap: 1rem; }
  .modal__label { font-weight: 600; margin-bottom: 0.25rem; display: block; }
  .modal__input, .modal__select { padding: 0.75rem; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; }
  .modal__checkbox-label { display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; }
  .modal__actions { display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem; }
  .modal__btn { padding: 0.75rem 1.5rem; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; }
  .modal__btn--cancel { background: #9e9e9e; color: white; }
  .modal__btn--save { background: #4caf50; color: white; }
  .modal__btn--toggle { background: #ff9800; color: white; }
  .modal__btn--delete { background: #f44336; color: white; }
</style>