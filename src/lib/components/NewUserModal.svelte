<!-- src/lib/components/NewUserModal.svelte -->
<script lang="ts">
  // )=- Per clarified requirements: Admin creates with firstName, lastName, email, role ONLY.
  // No PIN or password fields for admin (user sets password via email/forgot flow on first login; sets PIN + photo themselves after verification).
  // Auto-generate temp password for the PB auth record creation (share with user until email components added).
  // Always set forcePinUpdate=true and forcePhotoUpdate=true on new crew (admin can toggle later to force resets).
  // Use PB's verified field (synced locally on email login).
  // Zod for the minimal admin creation form.
  import { createUser } from '$lib/db';
  import { z } from 'zod';

  interface Props {
    onClose: (success?: boolean) => void;
  }

  let { onClose }: Props = $props();

  let firstName = $state('');
  let lastName = $state('');
  let email = $state('');
  let role = $state<'admin' | 'crew'>('crew');

  // )=- Zod schema for admin-only creation fields (no PIN/password - those are post-verification user actions).
  const NewUserSchema = z.object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    email: z.string().email('Please enter a valid email'),
    role: z.enum(['admin', 'crew']),
  });

  let errors = $state<Record<string, string>>({});
  let tempPasswordForUser = $state('');  // displayed once after creation for admin to communicate to the new crew member

  async function handleSubmit() {
    errors = {};
    tempPasswordForUser = '';

    const result = NewUserSchema.safeParse({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      role,
    });

    if (!result.success) {
      result.error.issues.forEach((issue) => {
        const field = issue.path[0] as string;
        errors[field] = issue.message;
      });
      return;
    }

    const data = result.data;
    const tempPass = crypto.randomUUID().slice(0, 12) + 'Aa1!';  // auto-generated; user will update via email link or forgot-password on login page

    try {
      await createUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        pinHash: '',  // user sets this themselves after first verified login
        role: data.role,
        active: true,
        forcePhotoUpdate: true,  // admin retains ability to force photo update via edit toggle
        forcePinUpdate: true,    // admin retains ability to force PIN reset via edit toggle; user sets initial PIN post-verification
        password: tempPass,      // temp for initial PB auth / verification (user changes it)
        photo: undefined,
      });
      tempPasswordForUser = tempPass;  // show to admin (until email components handle delivery + password set)
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

<div class="modal-overlay" onclick={onClose}>
  <div class="modal-content" onclick={stopProp}>
    <h2 class="modal__title">Add New User</h2>
    
    {#if tempPasswordForUser}
      <!-- Success view: show the auto-generated temp password once (admin shares with new crew member) -->
      <div class="modal__success">
        <h3>User created successfully!</h3>
        <p>Share this <strong>temporary password</strong> with the new crew member (they will use the email + this password for their first login to verify and set their real password + PIN/photo):</p>
        <div class="temp-pass-box">{tempPasswordForUser}</div>
        <p class="note">They should login with email/password first (this verifies the PB account). Then they can use the quick First Name + PIN method. Admin can later force PIN or photo reset via the edit toggles.</p>
        <button onclick={closeModal} class="modal__btn modal__btn--save">Done</button>
      </div>
    {:else}
      <div class="modal__form">
        <!-- Admin only enters first/last/email/role. Password auto-generated for initial verification. PIN set by user post-verification. -->
        <div class="modal__field">
          <label class="modal__label">First Name *</label>
          <input type="text" bind:value={firstName} class="modal__input" placeholder="John" />
          {#if errors.firstName}<small class="error">{errors.firstName}</small>{/if}
        </div>

        <div class="modal__field">
          <label class="modal__label">Last Name *</label>
          <input type="text" bind:value={lastName} class="modal__input" placeholder="Doe" />
          {#if errors.lastName}<small class="error">{errors.lastName}</small>{/if}
        </div>

        <div class="modal__field">
          <label class="modal__label">Email *</label>
          <input type="email" bind:value={email} class="modal__input" placeholder="john.doe@company.com" />
          {#if errors.email}<small class="error">{errors.email}</small>{/if}
        </div>

        <div class="modal__field">
          <label class="modal__label">Role</label>
          <select bind:value={role} class="modal__select">
            <option value="crew">Crew</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div class="modal__placeholder">
          A temporary password will be generated automatically for the new user's initial email/password login (to verify their account and set their real password + PIN + photo).<br>
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