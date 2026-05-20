<!-- src/lib/components/CrewManagement.svelte -->
<script lang="ts">
  // )=- Clean column layout + modals (Svelte 5 only)
  import { onMount } from 'svelte';
  import { db, type User } from '$lib/db';
  import { auth } from '$lib/stores/auth.svelte';
  import NewUserModal from './NewUserModal.svelte';
  import UserJobsModal from './UserJobsModal.svelte';

  let allUsers = $state<User[]>([]);

  let showNewModal = $state(false);
  let showJobsModal = $state(false);
  let showEditModal = $state(false);

  let selectedUser = $state<User | null>(null);
  let editName = $state('');
  let editRole = $state<'admin' | 'crew'>('crew');
  let editForcePin = $state(false);
  let editForcePhoto = $state(false);

  let isAdmin = $derived(auth.currentUser?.role === 'admin');

  async function loadUsers() {
    allUsers = await db.users.toArray();
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
    editName = user.name;
    editRole = user.role;
    editForcePin = user.forcePinUpdate ?? false;
    editForcePhoto = user.forcePhotoUpdate ?? false;
    showEditModal = true;
  }

  async function saveEdit() {
    if (!selectedUser || !editName.trim() || !isAdmin) return;

    const adminCount = allUsers.filter(u => u.role === 'admin' && u.active).length;
    if (selectedUser.role === 'admin' && editRole !== 'admin' && adminCount <= 1) {
      alert('Cannot remove the last active admin.');
      return;
    }

    await db.users.update(selectedUser.id!, {
      name: editName.trim(),
      role: editRole,
      forcePinUpdate: editForcePin,
      forcePhotoUpdate: editForcePhoto,
      updatedAt: new Date()
    });

    showEditModal = false;
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

    await db.users.update(user.id!, {
      active: !user.active,
      updatedAt: new Date()
    });
    await loadUsers();
  }

  async function deleteUser(id: number) {
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
      await db.users.delete(id);
      await loadUsers();
    }
  }

  export async function setInitialPin(userId: number, newPin: string) {
    const bcrypt = await import('bcryptjs');
    const hashed = await bcrypt.hash(newPin, 10);
    await db.users.update(userId, {
      pinHash: hashed,
      forcePinUpdate: false,
      updatedAt: new Date()
    });
  }

  onMount(() => {
    if (isAdmin) loadUsers();
  });
</script>

<div class="user-management">
  <header class="user-management__header">
    <h1 class="user-management__title">User Management</h1>
    <button onclick={openNewUser} class="user-management__add-btn">+ Add New User</button>
  </header>

  <div class="user-management__grid">
    {#each allUsers as user (user.id)}
      <div class="user-management__row">
        <!-- Avatar Column -->
        <div class="user-management__avatar-col">
          <div class="user-management__avatar">
            {#if user.photo}
              <img src={user.photo} alt={user.name} class="user-management__avatar-img" />
            {:else}
              <span class="user-management__avatar-placeholder">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            {/if}
          </div>
        </div>

        <!-- Info Column -->
        <div class="user-management__info-col">
          <span class="user-management__name">{user.name}</span>
          <span class="user-management__role user-management__role--{user.role}">
            {user.role}
          </span>
          <span class="user-management__status user-management__status--{user.active ? 'active' : 'inactive'}">
            {user.active ? '✅ Active' : '⛔ Inactive'}
          </span>
        </div>

        <!-- Actions Column -->
        <div class="user-management__actions-col">
          <button onclick={() => openJobs(user)} class="user-management__btn user-management__btn--jobs">View Jobs</button>
          <button onclick={() => openEdit(user)} class="user-management__btn user-management__btn--edit">Edit</button>
          <button onclick={() => toggleActive(user)} class="user-management__btn user-management__btn--toggle">
            {user.active ? 'Deactivate' : 'Activate'}
          </button>
          <button onclick={() => deleteUser(user.id!)} class="user-management__btn user-management__btn--delete">Delete</button>
        </div>
      </div>
    {/each}
  </div>

  <!-- Modals -->
  {#if showNewModal}
    <NewUserModal onClose={(success) => { showNewModal = false; if (success) loadUsers(); }} />
  {/if}

  {#if showJobsModal && selectedUser}
    <UserJobsModal 
      userId={selectedUser.id!} 
      userName={selectedUser.name} 
      onClose={() => showJobsModal = false} 
    />
  {/if}

  {#if showEditModal && selectedUser}
    <div class="modal-overlay" onclick={() => { showEditModal = false; selectedUser = null; }}>
      <div class="modal-content" onclick={e => e.stopPropagation()}>
        <h2 class="modal__title">Edit User</h2>

        <div class="modal__form">
          <label class="modal__label">Name</label>
          <input type="text" bind:value={editName} class="modal__input" />

          <label class="modal__label">Role</label>
          <select bind:value={editRole} class="modal__select">
            <option value="crew">Crew</option>
            <option value="admin">Admin</option>
          </select>

          <label class="modal__checkbox-label">
            <input type="checkbox" bind:checked={editForcePin} />
            Force PIN change on next login
          </label>

          <label class="modal__checkbox-label">
            <input type="checkbox" bind:checked={editForcePhoto} />
            Force new photo upload
          </label>
        </div>

        <div class="modal__actions">
          <button onclick={() => { showEditModal = false; selectedUser = null; }} class="modal__btn modal__btn--cancel">Cancel</button>
          <button onclick={saveEdit} class="modal__btn modal__btn--save">Save Changes</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* BEM - Clean fixed columns */
  .user-management {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  .user-management__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
  }

  .user-management__title {
    font-size: 1.8rem;
    margin: 0;
  }

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
    grid-template-columns: 70px 1fr auto;
    align-items: center;
    gap: 1.5rem;
    padding: 1.25rem;
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
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
  .user-management__avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .user-management__avatar-placeholder {
    font-size: 1.8rem;
    font-weight: bold;
    color: #555;
  }

  .user-management__info-col {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .user-management__name {
    font-size: 1.25rem;
    font-weight: 600;
  }

  .user-management__role,
  .user-management__status {
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.85rem;
    font-weight: 500;
    display: inline-block;
  }

  .user-management__role--admin { background: #9c27b0; color: white; }
  .user-management__role--crew { background: #2196f3; color: white; }
  .user-management__status--active { background: #4caf50; color: white; }
  .user-management__status--inactive { background: #f44336; color: white; }

  .user-management__actions-col {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .user-management__btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
  }

  .user-management__btn--jobs { background: #673ab7; color: white; }
  .user-management__btn--edit { background: #2196f3; color: white; }
  .user-management__btn--toggle { background: #ff9800; color: white; }
  .user-management__btn--delete { background: #f44336; color: white; }

  /* Modal styles (shared) */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
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
  .modal__title { margin: 0 0 1.5rem 0; font-size: 1.5rem; }
  .modal__form { display: flex; flex-direction: column; gap: 1rem; }
  .modal__label { font-weight: 600; margin-bottom: 0.25rem; display: block; }
  .modal__input,
  .modal__select {
    padding: 0.75rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 1rem;
  }
  .modal__checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
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
  .modal__btn--cancel { background: #9e9e9e; color: white; }
  .modal__btn--save { background: #4caf50; color: white; }
</style>