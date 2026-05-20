<script lang="ts">
    import { onMount } from "svelte";
    import { db } from '$lib/db';
    import { auth } from '$lib/stores/auth.svelte';

    interface Props {
        onSuccess: () => void;
    }

    let { onSuccess }: Props = $props();
    let newPin = $state('');
    let confirmPin = $state('');
    let error = $state('');
    let isSubmitting = $state(false);

    async function handleSubmit() {
        if (newPin.length !== 4 || confirmPin.length !== 4) {
            error = 'Pin must be exactly 4 digits';
            return;
        }
        if (newPin !== confirmPin) {
            error = 'PINs do not match';
            return;
        }

        isSubmitting = true;
        error = '';

        try {
            await auth.setInitialPin(auth.currentUser!.id!, newPin);
            onSuccess();
        } catch (e) {
            error = 'Failed to set PIN. Please try again.';
        } finally {
            isSubmitting = false;
        }
    }
</script>

<div class="modal-overlay" onclick={onSuccess}>
  <div class="modal-content" onclick={e => e.stopPropagation()}>
    <h2 class="modal__title">Set Your New PIN</h2>
    <p class="modal__subtitle">This is required for first-time login or forced reset.</p>

    <div class="modal__form">
      <label class="modal__label">New 4-digit PIN</label>
      <input 
        type="password" 
        bind:value={newPin} 
        maxlength="4"
        class="modal__input"
        placeholder="1234"
        inputmode="numeric"
      />

      <label class="modal__label">Confirm PIN</label>
      <input 
        type="password" 
        bind:value={confirmPin} 
        maxlength="4"
        class="modal__input"
        placeholder="1234"
        inputmode="numeric"
      />

      {#if error}
        <p class="modal__error">{error}</p>
      {/if}
    </div>

    <div class="modal__actions">
      <button onclick={onSuccess} class="modal__btn modal__btn--cancel" disabled={isSubmitting}>
        Cancel
      </button>
      <button onclick={handleSubmit} class="modal__btn modal__btn--save" disabled={isSubmitting || newPin.length !== 4 || confirmPin.length !== 4}>
        {isSubmitting ? 'Setting PIN...' : 'Set PIN'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
  .modal-content {
    background: white;
    border-radius: 12px;
    width: 90%;
    max-width: 380px;
    padding: 2rem;
  }
  .modal__title { margin: 0 0 0.5rem 0; font-size: 1.4rem; }
  .modal__subtitle { color: #666; margin-bottom: 1.5rem; }
  .modal__form { display: flex; flex-direction: column; gap: 1rem; }
  .modal__label { font-weight: 600; margin-bottom: 0.25rem; }
  .modal__input {
    padding: 0.75rem;
    border: 1px solid #ccc;
    border-radius: 6px;
    font-size: 1.1rem;
    text-align: center;
    letter-spacing: 4px;
  }
  .modal__error { color: #f44336; text-align: center; margin: 0.5rem 0; }
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