<script lang="ts">
    import { onMount } from 'svelte';
    import { db, type User } from '$lib/db';
    import { auth } from '$lib/stores/auth.svelte';

    let allUsers = $state<User[]>([]);
    let newUserName = $state('');
    let newUserRole = $state<'admin' | 'crew'>('crew');
    let editingUser = $state<User | null>(null);
    let editName = $state('');
    let editRole = $state<'admin' | 'crew'>('crew');
    let selectedUserJobs = $state<any[] | null>(null);
    let expandedUserId = $state<number | null>(null);
    let editForcePin = $state(false);
    let editForcePhoto = $state(false);

    let isAdmin = $derived(auth.currentUser?.role === 'admin');
    
    async function loadUsers() {
        allUsers = await db.users.toArray();
    }

    async function loadUserJobs(userId: number) {
        if (expandedUserId === userId) {
            expandedUserId = null;
            selectedUserJobs = [];
            return;
        }
        expandedUserId = userId;
        selectedUserJobs = await db.jobs
            .where('assignedCrew')
            .equals(userId.toString()) // TODO: update to IDs later
            .toArray();
    }

    async function addUser() {
        if (!newUserName.trim() || !isAdmin) return;

        const newUser: Omit<User, 'id'> = {
            name: newUserName.trim(),
            pinHash: '', // Will be set on first login
            role: newUserRole,
            active: true,
            forcePhotoUpdate: false,
            forcePinUpdate: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await db.users.add(newUser);
        newUserName = '';
        await loadUsers();
    }

    function startEdit(user: User) {
        editingUser = user;
        editName = user.name;
        editRole = user.role;
        editForcePin = user.forcePinUpdate ?? false;
        editForcePhoto = user.forcePhotoUpdate ?? false;
    }

    async function saveEdit() {
        if (!editingUser || !editName.trim() || !isAdmin) return;
        
        //prevent deleting the last admin
        const adminCount = allUsers.filter(u => u.role === 'admin' && u.active).length;
        if (editingUser.role === 'admin' && editRole !== 'admin' && adminCount <= 1) {
            alert('Cannot remove the last active admin.');
            return;
        }

        await db.users.update(editingUser.id!, { 
            name: editName.trim(),
            role: editRole,
            forcePinUpdate: editForcePin,
            forcePhotoUpdate: editForcePhoto,
            updatedAt: new Date()
        });
    editingUser = null;
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

    // Set initial PIN helper (called from login later)
    export async function setInitialPin(userId: number, newPin: string) {
        const hashed = await import('bcryptjs').then(b => b.hash(newPin, 10));
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
<div class="crew-management">
  {#if !isAdmin}
    <p class="crew-management__error">Access denied. Admin only.</p>
  {:else}
    <header class="crew-management__header">
      <h1 class="crew-management__title">User Management</h1>
      <div class="crew-management__add-form">
        <input type="text" bind:value={newUserName} placeholder="New user name" class="crew-management__input" />
        <select bind:value={newUserRole} class="crew-management__select">
          <option value="crew">Crew</option>
          <option value="admin">Admin</option>
        </select>
        <button on:click={addUser} class="crew-management__btn crew-management__btn--add">Add User</button>
      </div>
    </header>

    <ul class="crew-management__list">
      {#each allUsers as user (user.id)}
        <li class="crew-management__item">
          <div class="crew-management__info">
            <!-- Avatar -->
            <div class="crew-management__avatar">
              {#if user.photo}
                <img src={user.photo} alt={user.name} class="crew-management__avatar-img" />
              {:else}
                <div class="crew-management__avatar-placeholder">
                  {user.name.slice(0,1).toUpperCase()}
                </div>
              {/if}
            </div>

            <div>
              <span class="crew-management__name">{user.name}</span>
              <span class="crew-management__role crew-management__role--{user.role}">{user.role}</span>
              <span class="crew-management__status crew-management__status--{user.active ? 'active' : 'inactive'}">
                {user.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          <div class="crew-management__actions">
            <button on:click={() => loadUserJobs(user.id!)} class="crew-management__btn crew-management__btn--jobs">
              {expandedUserId === user.id ? 'Hide Jobs' : 'View Jobs'}
            </button>
            <button on:click={() => startEdit(user)} class="crew-management__btn crew-management__btn--edit">Edit</button>
            <button on:click={() => toggleActive(user)} class="crew-management__btn crew-management__btn--toggle">
              {user.active ? 'Deactivate' : 'Activate'}
            </button>
            <button on:click={() => deleteUser(user.id!)} class="crew-management__btn crew-management__btn--delete">Delete</button>
          </div>

          {#if expandedUserId === user.id}
            <div class="crew-management__jobs">
              {#each selectedUserJobs as job}
                <div class="crew-management__job-item">
                  {job.title} — {new Date(job.start).toLocaleDateString()}
                </div>
              {:else}
                <p>No jobs assigned yet.</p>
              {/each}
            </div>
          {/if}
        </li>

        {#if editingUser?.id === user.id}
          <li class="crew-management__edit-row">
            <input type="text" bind:value={editName} class="crew-management__input" placeholder="Name" />
            <select bind:value={editRole} class="crew-management__select">
              <option value="crew">Crew</option>
              <option value="admin">Admin</option>
            </select>
            <label class="crew-management__checkbox-label">
              <input type="checkbox" bind:checked={editForcePin} />
              Force PIN change on next login
            </label>
            <label class="crew-management__checkbox-label">
              <input type="checkbox" bind:checked={editForcePhoto} />
              Force new photo upload
            </label>
            <button on:click={saveEdit} class="crew-management__btn crew-management__btn--save">Save</button>
            <button on:click={() => { editingUser = null; }} class="crew-management__btn crew-management__btn--cancel">Cancel</button>
          </li>
        {/if}
        {:else}
            <li class="crew-management__item crew-management__item--empty">No users yet.</li>
        {/each}
    </ul>
  {/if}
</div>

<style>
  .crew-management__avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    overflow: hidden;
    background: #ddd;
    flex-shrink: 0;
  }
  .crew-management__avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .crew-management__avatar-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
    font-weight: bold;
    color: #555;
  }
  .crew-management__jobs {
    grid-column: 1 / -1;
    margin-top: 1rem;
    padding: 1rem;
    background: #f9f9f9;
    border-radius: 4px;
  }
  .crew-management__edit-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 1rem;
    background: #f0f0f0;
  }
  .crew-management {
    max-width: 900px;
    margin: 0 auto;
    padding: 2rem;
  }

  .crew-management__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    gap: 1rem;
  }

  .crew-management__title {
    font-size: 1.8rem;
    margin: 0;
  }

  .crew-management__add-form {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .crew-management__input,
  .crew-management__select {
    padding: 0.5rem 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font-size: 1rem;
  }

  .crew-management__btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
  }

  .crew-management__btn--add { background: #4caf50; color: white; }
  .crew-management__btn--edit { background: #2196f3; color: white; }
  .crew-management__btn--save { background: #4caf50; color: white; }
  .crew-management__btn--cancel { background: #9e9e9e; color: white; }
  .crew-management__btn--delete { background: #f44336; color: white; }
  .crew-management__btn--toggle { background: #ff9800; color: white; }

  .crew-management__list {
    list-style: none;
    padding: 0;
  }

  .crew-management__item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    border-bottom: 1px solid #eee;
    gap: 1rem;
  }

  .crew-management__item--empty {
    justify-content: center;
    color: #666;
    font-style: italic;
  }

  .crew-management__info {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .crew-management__name {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .crew-management__role,
  .crew-management__status {
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.85rem;
    font-weight: 500;
  }

  .crew-management__role--admin {
    background: #9c27b0;
    color: white;
  }

  .crew-management__role--crew {
    background: #2196f3;
    color: white;
  }

  .crew-management__status--active {
    background: #4caf50;
    color: white;
  }

  .crew-management__status--inactive {
    background: #f44336;
    color: white;
  }

  .crew-management__actions {
    display: flex;
    gap: 0.5rem;
  }

  .crew-management__error {
    color: #f44336;
    text-align: center;
    font-size: 1.1rem;
  }
  .crew-management__checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
    font-size: 0.95rem;
  }

  .crew-management__edit-row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    padding: 1rem;
    background: #f0f0f0;
    border-radius: 4px;
  }
</style>
