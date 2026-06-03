<!-- src/routes/(app)/admin/options/+page.svelte -->
<script lang="ts">
  import { options$, optionsStore } from '$lib/stores/options.svelte';
  import { auth } from '$lib/stores/auth.svelte';
  import { goto } from '$app/navigation';
  import { db } from '$lib/db';

  let activeTab = $state<'scheduling' | 'invoice'>('scheduling');

  $effect(() => {
    if (!auth.currentUser || auth.currentUser.role !== 'admin') {
      goto('/calendar', { replaceState: true });
    }
  });

  const tabs = [
    { id: 'scheduling', label: 'Scheduling Options' },
    { id: 'invoice', label: 'Invoice Options' }
  ] as const;

  let editingOptions = $state<any>({});

  $effect(() => {
    if (optionsStore.data) {
      editingOptions = structuredClone(optionsStore.data);
    }
  });

  async function saveOptions() {
    if (!editingOptions?.id) return;
    
    const updated = {
      ...editingOptions,
      lastUpdated: new Date(),
      updatedBy: auth.currentUser?.name || 'Admin'
    };

    await db.options.put(updated);
    console.log('✅ Options saved to Dexie');
  }

  // === Areas of Town helpers ===
  function addNewArea() {
    if (!editingOptions.areasOfTown) editingOptions.areasOfTown = {};
    
    const newKey = 'new-area-' + Date.now();
    editingOptions.areasOfTown[newKey] = {
      label: 'New Area',
      color: '#64748b'
    };
  }

  function deleteArea(key: string) {
    if (confirm(`Delete area "${editingOptions.areasOfTown[key]?.label || key}"?`)) {
      delete editingOptions.areasOfTown[key];
    }
  }

  function moveAreaUp(key: string) {
    const keys = Object.keys(editingOptions.areasOfTown);
    const index = keys.indexOf(key);
    if (index <= 0) return;

    const newKeys = [...keys];
    [newKeys[index], newKeys[index - 1]] = [newKeys[index - 1], newKeys[index]];

    const reordered: any = {};
    newKeys.forEach(k => reordered[k] = editingOptions.areasOfTown[k]);

    editingOptions.areasOfTown = reordered;
  }

  function moveAreaDown(key: string) {
    const keys = Object.keys(editingOptions.areasOfTown);
    const index = keys.indexOf(key);
    if (index === -1 || index === keys.length - 1) return;

    const newKeys = [...keys];
    [newKeys[index], newKeys[index + 1]] = [newKeys[index + 1], newKeys[index]];

    const reordered: any = {};
    newKeys.forEach(k => reordered[k] = editingOptions.areasOfTown[k]);

    editingOptions.areasOfTown = reordered;
  }

  function isDefaultArea(key: string): boolean {
    const keys = Object.keys(editingOptions.areasOfTown || {});
    return keys[0] === key;
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
    {#if activeTab === 'scheduling'}
      <h2>Scheduling Options</h2>

      <!-- General -->
      <div class="form-section">
        <h3>General</h3>
        <div class="form-grid">
          <label>Default Job Duration (hours)</label>
          <input type="number" step="0.25" bind:value={editingOptions.defaultJobDurationHours} />
        </div>
      </div>

      <!-- Areas of Town -->
      <div class="form-section">
        <h3>Areas of Town</h3>
        <p class="options-page__help">The **top area** is used as the default for new jobs. Use arrows to reorder.</p>

        {#if editingOptions?.areasOfTown}
          <div class="areas-list">
            {#each Object.entries(editingOptions.areasOfTown) as [key, area] (key)}
              <div class="area-item {isDefaultArea(key) ? 'area-item--default' : ''}">
                <input 
                  class="area-item__label-input"
                  bind:value={area.label} 
                  placeholder="Area name"
                />

                <input 
                  type="color" 
                  class="area-item__color"
                  bind:value={area.color} 
                />

                <div class="area-item__controls">
                  <button 
                    type="button" 
                    class="area-item__move-btn"
                    onclick={() => moveAreaUp(key)}
                    disabled={Object.keys(editingOptions.areasOfTown)[0] === key}
                  >
                    ↑
                  </button>
                  <button 
                    type="button" 
                    class="area-item__move-btn"
                    onclick={() => moveAreaDown(key)}
                    disabled={Object.keys(editingOptions.areasOfTown).at(-1) === key}
                  >
                    ↓
                  </button>
                  <button 
                    type="button" 
                    class="area-item__remove"
                    onclick={() => deleteArea(key)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <button type="button" class="options-page__btn options-page__btn--add" onclick={addNewArea}>
          + Add New Area
        </button>
      </div>

      <!-- Cancellation Reasons -->
      <div class="form-section">
        <h3>Cancellation Reasons</h3>
        <p class="options-page__help">(Full editor coming soon)</p>
        <ul>
          {#each editingOptions?.cancelReasons || [] as reason}
            <li>{reason}</li>
          {/each}
        </ul>
      </div>

    {:else if activeTab === 'invoice'}
      <h2>Invoice & Billing Settings</h2>
      
      <div class="form-section">
        <h3>Billing & Tax</h3>
        <div class="form-grid">
          <label>Tax Rate (%)</label>
          <input type="number" step="0.01" bind:value={editingOptions.taxRate} />
          <label>Invoice Due Days</label>
          <input type="number" bind:value={editingOptions.invoiceDueDays} />
        </div>
      </div>

      <div class="form-section">
        <h3>Default Billable Items</h3>
        <p class="options-page__help">Templates used when creating new jobs</p>

        {#if editingOptions?.defaultBillableItems}
          <div class="billable-list">
            {#each editingOptions.defaultBillableItems as item, index (index)}
              <div class="billable-item">
                <input class="billable-item__input" bind:value={item.title} placeholder="Service name" />
                <div class="billable-item__price">
                  <span>$</span>
                  <input type="number" class="billable-item__input billable-item__input--price" bind:value={item.price} />
                </div>
                <select value={item.hours !== undefined ? 'hours' : 'quantity'}
                  onchange={(e) => {
                    const val = (e.target as HTMLSelectElement).value;
                    if (val === 'hours') {
                      item.hours = item.hours ?? 1;
                      delete item.quantity;
                    } else {
                      item.quantity = item.quantity ?? 1;
                      delete item.hours;
                    }
                  }}>
                  <option value="quantity">Quantity</option>
                  <option value="hours">Hours</option>
                </select>
                <button type="button" class="billable-item__remove" onclick={() => editingOptions.defaultBillableItems.splice(index, 1)}>
                  ✕
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <button type="button" class="options-page__btn options-page__btn--add"
          onclick={() => {
            if (!editingOptions.defaultBillableItems) editingOptions.defaultBillableItems = [];
            editingOptions.defaultBillableItems.push({ title: '', price: 0, hours: 1 });
          }}>
          + Add New Billable Item
        </button>
      </div>
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
  .options-page { padding: 2rem; max-width: 1100px; margin: 0 auto; }
  .options-page__header { margin-bottom: 2rem; }
  .options-page__title { font-size: 2.1rem; font-weight: 700; color: #1e2937; }
  .options-page__subtitle { color: #64748b; }
  .options-page__tabs { display: flex; gap: 0.5rem; border-bottom: 2px solid #e2e8f0; margin-bottom: 2rem; flex-wrap: wrap; }
  .options-page__tab { padding: 0.9rem 1.75rem; background: none; border: none; font-size: 1.05rem; font-weight: 500; color: #64748b; cursor: pointer; border-bottom: 3px solid transparent; }
  .options-page__tab--active { color: #2563eb; border-bottom: 3px solid #2563eb; font-weight: 600; }
  .options-page__content { background: white; border-radius: 12px; padding: 2.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); min-height: 520px; }
  .form-grid { display: grid; grid-template-columns: 200px 1fr; gap: 1rem; align-items: center; max-width: 600px; }
  .form-section { margin-bottom: 2.5rem; }
  .options-page__help { color: #64748b; margin-bottom: 1.5rem; }

  .areas-list { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
  .area-item { 
    display: grid; 
    grid-template-columns: 3fr 80px 120px; 
    gap: 1rem; 
    align-items: center; 
    background: #f8fafc; 
    padding: 1rem; 
    border-radius: 8px; 
    position: relative;
  }
  .area-item--default::before {
    content: "★ Default";
    position: absolute;
    top: 8px;
    left: 12px;
    background: #22c55e;
    color: white;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 1px 7px 2px;
    border-radius: 9999px;
    line-height: 1;
    z-index: 2;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }

  .area-item__label-input { padding: 0.6rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; }
  .area-item__color { width: 80px; height: 42px; padding: 0; border: 1px solid #cbd5e1; border-radius: 6px; cursor: pointer; }

  .area-item__controls {
    display: flex;
    gap: 4px;
  }
  .area-item__move-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e2e8f0;
    border: none;
    border-radius: 6px;
    font-size: 1.1rem;
    cursor: pointer;
    color: #475569;
  }
  .area-item__move-btn:hover:not(:disabled) {
    background: #cbd5e1;
  }
  .area-item__move-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .area-item__remove { 
    background: #fee2e2; 
    color: #dc2626; 
    border: none; 
    width: 38px; 
    height: 38px; 
    border-radius: 6px; 
    cursor: pointer; 
    font-size: 1.1rem; 
  }

  .billable-list { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
  .billable-item { display: flex; align-items: center; gap: 0.75rem; background: #f8fafc; padding: 0.75rem 1rem; border-radius: 8px; }
  .billable-item__input { flex: 1; padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; }
  .billable-item__input--price { width: 100px; }
  .billable-item__remove { background: #fee2e2; color: #dc2626; border: none; width: 32px; height: 32px; border-radius: 6px; cursor: pointer; }

  .options-page__btn { padding: 0.9rem 2.25rem; border-radius: 8px; font-weight: 600; cursor: pointer; }
  .options-page__btn--save { background: #2563eb; color: white; border: none; }
  .options-page__btn--add { background: #e0f2fe; color: #0369a1; border: none; padding: 0.75rem 1.5rem; font-weight: 500; }
</style>