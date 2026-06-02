<!-- src/routes/(app)/options/+page.svelte -->
<script lang="ts">
  import { options$, optionsStore } from '$lib/stores/options.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { goto } from '$app/navigation';
  import { db } from '$lib/db';

  let activeTab = $state<'general' | 'billing' | 'services' | 'areas' | 'cancel'>('general');

  // Admin protection
  $effect(() => {
    if (auth.currentUser?.role !== 'admin') {
      goto('/calendar');
    }
  });

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'billing', label: 'Billing & Tax' },
    { id: 'services', label: 'Services & Billables' },
    { id: 'areas', label: 'Areas of Town' },
    { id: 'cancel', label: 'Cancellation Reasons' }
  ] as const;

  // Safe editable copy - initialized as empty object
  let editingOptions = $state<any>({});

  // Populate when options become available
  $effect(() => {
    if (optionsStore.data) {
      editingOptions = { ...optionsStore.data };
    }
  });

  async function saveOptions() {
    if (!editingOptions || !editingOptions.id) return;
    
    const updated = {
      ...editingOptions,
      lastUpdated: new Date(),
      updatedBy: auth.currentUser?.name || 'Admin'
    };

    await db.options.put(updated);
    console.log('✅ Options saved successfully');
  }
</script>

<svelte:head>
  <title>Options - Capital City Windows</title>
</svelte:head>

<div class="options-page">
  <div class="options-page__header">
    <h1 class="options-page__title">Business Options</h1>
    <p class="options-page__subtitle">Configure system-wide settings • Admin only</p>
  </div>

  <!-- Tabs -->
  <div class="options-page__tabs">
    {#each tabs as tab}
      <button
        class="options-page__tab {activeTab === tab.id ? 'options-page__tab--active' : ''}"
        onclick={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  <div class="options-page__content">
    {#if activeTab === 'general'}
      <h2>General Settings</h2>
      <div class="form-grid">
        <label>Default Job Duration (hours)</label>
        <input 
          type="number" 
          step="0.25" 
          bind:value={editingOptions.defaultJobDurationHours} 
        />
      </div>

    {:else if activeTab === 'billing'}
      <h2>Billing & Tax Settings</h2>
      <div class="form-grid">
        <label>Tax Rate (%)</label>
        <input 
          type="number" 
          step="0.01" 
          bind:value={editingOptions.taxRate} 
        />
        
        <label>Invoice Due Days</label>
        <input 
          type="number" 
          bind:value={editingOptions.invoiceDueDays} 
        />
        
        <label>Currency</label>
        <input bind:value={editingOptions.currency} />
      </div>

        {:else if activeTab === 'services'}
      <h2>Services & Billables</h2>
      <p class="help-text">Default templates used when creating new jobs.</p>
      
      {#if editingOptions}
        {#if editingOptions.defaultBillableItems}
          {#each editingOptions.defaultBillableItems as item, index (index)}
            <div class="billable-row">
              <input bind:value={item.title} placeholder="Service name" />
              <input type="number" bind:value={item.price} placeholder="Price" />
              <input type="number" step="0.25" bind:value={item.hours} placeholder="Hours" />
              <button type="button" onclick={() => editingOptions.defaultBillableItems.splice(index, 1)}>Remove</button>
            </div>
          {/each}
        {/if}

        <button type="button" onclick={() => {
          if (!editingOptions.defaultBillableItems) editingOptions.defaultBillableItems = [];
          editingOptions.defaultBillableItems.push({ title: '', price: 0, hours: 1 });
        }}>
          + Add New Billable Item
        </button>
      {/if}

    {:else if activeTab === 'areas'}
      <h2>Areas of Town</h2>
      <p>Areas loaded from options.</p>

    {:else if activeTab === 'cancel'}
      <h2>Cancellation Reasons</h2>
      <ul>
        {#each editingOptions?.cancelReasons || [] as reason}
          <li>{reason}</li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Footer -->
  <div class="options-page__footer">
    <button class="options-page__btn options-page__btn--save" onclick={saveOptions}>
      💾 Save All Changes
    </button>
  </div>
</div>

<style>
  /* (Your existing styles - keep them the same) */
  .options-page { padding: 2rem; max-width: 1100px; margin: 0 auto; }
  .options-page__header { margin-bottom: 2rem; }
  .options-page__title { font-size: 2.1rem; font-weight: 700; color: #1e2937; }
  .options-page__subtitle { color: #64748b; }
  .options-page__tabs { display: flex; gap: 0.5rem; border-bottom: 2px solid #e2e8f0; margin-bottom: 2rem; flex-wrap: wrap; }
  .options-page__tab { padding: 0.9rem 1.75rem; background: none; border: none; font-size: 1.05rem; font-weight: 500; color: #64748b; cursor: pointer; border-bottom: 3px solid transparent; }
  .options-page__tab--active { color: #2563eb; border-bottom: 3px solid #2563eb; font-weight: 600; }
  .options-page__content { background: white; border-radius: 12px; padding: 2.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); min-height: 520px; }
  .form-grid { display: grid; grid-template-columns: 200px 1fr; gap: 1rem; align-items: center; max-width: 600px; }
  .billable-row { display: grid; grid-template-columns: 3fr 1fr 1fr auto; gap: 0.75rem; margin-bottom: 0.75rem; align-items: center; }
  .options-page__footer { margin-top: 2.5rem; text-align: right; }
  .options-page__btn { padding: 0.9rem 2.25rem; border-radius: 8px; font-weight: 600; font-size: 1.05rem; }
  .options-page__btn--save { background: #2563eb; color: white; border: none; }
</style>