<!-- src/lib/components/NewUserModal.svelte -->
<script lang="ts">
  import { db, type User } from '$lib/db';

  interface Props {
    onClose: (success?: boolean) => void;
  }

  let { onClose }: Props = $props();

  let name = $state('');
  let role = $state<'admin' | 'crew'>('crew');
  let initialPin = $state('');

  async function handleSubmit() {
    if (!name.trim()) return;

    const bcrypt = await import('bcryptjs');
    const pinHash = initialPin 
      ? await bcrypt.hash(initialPin, 10) 
      : '';

    const newUser: Omit<User, 'id'> = {
      name: name.trim(),
      pinHash,
      role,
      active: true,
      forcePhotoUpdate: false,
      forcePinUpdate: !initialPin,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.users.add(newUser);
    onClose(true);
  }

  function stopProp(e: Event) {
    e.stopPropagation();
  }
</script>

<div class="modal-overlay" onclick={onClose}>
  <div class="modal-content" onclick={stopProp}>
    <h2 class="modal__title">Add New User</h2>
    
    <div class="modal__form">
      <label class="modal__label">Name</label>
      <input type="text" bind:value={name} class="modal__input" placeholder="Full name" />

      <label class="modal__label">Role</label>
      <select bind:value={role} class="modal__select">
        <option value="crew">Crew</option>
        <option value="admin">Admin</option>
      </select>

      <label class="modal__label">Initial 4-digit PIN* </label>
      <input 
        type="password" 
        bind:value={initialPin} 
        maxlength="4" 
        class="modal__input" 
        placeholder="e.g. 4424" 
      />

      <div class="modal__placeholder">
        📸 Photo upload / camera coming soon<br>
        ✉️ Email welcome link coming soon
      </div>
    </div>

    <div class="modal__actions">
      <button onclick={onClose} class="modal__btn modal__btn--cancel">Cancel</button>
      <button onclick={handleSubmit} class="modal__btn modal__btn--save">Create User</button>
    </div>
  </div>
</div>

<style>
  /* BEM - unchanged */
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
  .modal__btn--cancel { background: #9e9e9e; color: white; }
  .modal__btn--save { background: #4caf50; color: white; }
</style>