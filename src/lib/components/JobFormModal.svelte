<!-- src/lib/components/JobFormModal.svelte -->
<script module>
  import { type Job } from '$lib/db';

  let modalInstance: {
    open: (job?: any, onAfterSave?: () => void) => void;
  } | null = null;

  export function openJobModal(job?: Partial<any>, onAfterSave?: () => void) {
    if (modalInstance) {
      modalInstance.open(job, onAfterSave);
    } else {
      console.warn('JobFormModal not yet mounted');
    }
  }
</script>

<script lang="ts">
  import { createJob, updateJob, cancelJob } from '$lib/db';
  import { BUSINESS_CONFIG } from '$lib/config';
  import ClientPicker from './ClientPicker.svelte';
  import BillableItemRow from './BillableItemRow.svelte';

  let show = $state(false);
  let isEditing = $state(false);
  let editingJobId = $state<string | null>(null);
  let showCancelConfirm = $state(false);
  let selectedCancelReason = $state('');

  let currentJob = $state<any>({
    title: 'Full Exterior Window Cleaning',
    start: new Date(),
    end: new Date(),
    clientId: null,
    assignedCrew: [],
    areaOfTown: 'thane',
    notes: '',
    cancelReason: '',
    cancelNotes: '',
    billableItems: [{ title: 'Full Exterior Window Cleaning', price: 100, quantity: 1, total: 100 }]
  });

  let crewOptions = $state<string[]>([]);
  let afterSaveCallback: (() => void) | null = null;

  // Register this instance so openJobModal can call it
  $effect(() => {
    modalInstance = {
      open: (job?: any, callback?: () => void) => {
        afterSaveCallback = callback || null;

        if (job) {
          currentJob = {
            ...job,
            start: job.start instanceof Date ? job.start : new Date(job.start),
            end: job.end instanceof Date ? job.end : new Date(job.end),
            assignedCrew: job.assignedCrew || [],
            billableItems: job.billableItems?.length 
              ? job.billableItems 
              : [{ title: job.title || 'Service', price: 100, quantity: 1, total: 100 }]
          };
          isEditing = !!job.id;
          editingJobId = job.id || null;
        } else {
          const now = new Date();

          currentJob = {
            title: 'Full Exterior Window Cleaning',
            start: now,
            end: new Date(now.getTime() + 4 * 60 * 60 * 1000),
            clientId: null,
            assignedCrew: [],
            areaOfTown: 'thane',
            notes: '',
            cancelReason: '',
            cancelNotes: '',
            billableItems: [{ title: 'Full Exterior Window Cleaning', price: 100, quantity: 1, total: 100 }]
          };
          isEditing = false;
          editingJobId = null;
        }
        show = true;
      }
    };
  });

  // Load crew members
  $effect(() => {
    import('$lib/db').then(({ db }) => {
      db.users.toArray().then((users: any[]) => {
        crewOptions = users
          .filter(u => u.active)
          .map(u => u.name)
          .sort();
      });
    });
  });

  const areaOptions = Object.entries(BUSINESS_CONFIG.areasOfTown).map(([key, value]) => ({
    value: key,
    label: value.label
  }));

  const cancelReasons = BUSINESS_CONFIG.cancelReasons;

  let subtotal = $derived(currentJob.billableItems.reduce((sum: number, item: any) => sum + (item.total || 0), 0));
  let taxAmount = $derived(Math.round(subtotal * BUSINESS_CONFIG.defaultTaxRate * 100) / 100);
  let totalAmount = $derived(subtotal + taxAmount);

  function toDatetimeLocal(date: Date | null | undefined): string {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function addBillableItem() {
    currentJob.billableItems = [
      ...currentJob.billableItems,
      { title: '', price: 0, quantity: 1, total: 0 }
    ];
  }

  function removeBillableItem(index: number) {
    if (currentJob.billableItems.length > 1) {
      currentJob.billableItems = currentJob.billableItems.filter((_, i) => i !== index);
    }
  }

  async function saveJob() {
    if (!currentJob.clientId) {
      alert('Please select a client');
      return;
    }

    console.log('Saving job with clientId:', currentJob.clientId);

    const cleanPayload = {
      title: currentJob.title || 'Untitled Job',
      start: currentJob.start instanceof Date ? currentJob.start : new Date(currentJob.start),
      end: currentJob.end instanceof Date ? currentJob.end : new Date(currentJob.end),
      clientId: currentJob.clientId,
      assignedCrew: currentJob.assignedCrew || [],
      areaOfTown: currentJob.areaOfTown,
      notes: currentJob.notes || undefined,
      billableItems: currentJob.billableItems.map((item: any) => ({ ...item })),
      subtotal,
      taxRate: BUSINESS_CONFIG.defaultTaxRate,
      taxAmount,
      totalAmount,
      status: isEditing ? (currentJob.status || 'scheduled') : 'scheduled'
    };

    try {
      if (isEditing && editingJobId) {
        await updateJob(editingJobId, cleanPayload);
      } else {
        await createJob(cleanPayload);
      }
      show = false;
      if (afterSaveCallback) afterSaveCallback();
    } catch (err) {
      console.error('Failed to save job', err);
      alert('Error saving job - check console');
    }
  }

  async function confirmCancel() {
    if (!editingJobId || !selectedCancelReason) return;
    await cancelJob(editingJobId, selectedCancelReason, currentJob.cancelNotes);
    show = false;
    showCancelConfirm = false;
    if (afterSaveCallback) afterSaveCallback();
  }

  function closeModal() {
    show = false;
    showCancelConfirm = false;
  }
</script>

<!-- Main Modal -->
{#if show}
  <div class="new-job-modal" onclick={closeModal}>
    <div class="new-job-modal__content" onclick={(e) => e.stopPropagation()}>
      <h2 class="new-job-modal__title">
        {isEditing ? 'Edit Job' : 'Create New Job'}
      </h2>

      <div class="new-job-modal__form">
        <!-- Job Title -->
        <div class="new-job-modal__field">
          <label for="job-title" class="new-job-modal__label">Job Title (optional)</label>
          <input id="job-title" class="new-job-modal__input" bind:value={currentJob.title} />
        </div>

        <!-- Client -->
        <div class="new-job-modal__field">
          <label for="client-picker" class="new-job-modal__label">Client</label>
          <ClientPicker bind:value={currentJob.clientId} placeholder="Select client..." />
        </div>

        <!-- Dates -->
        <div class="new-job-modal__field-group">
          <div class="new-job-modal__field">
            <label for="job-start" class="new-job-modal__label">Start</label>
            <input 
              id="job-start" 
              type="datetime-local" 
              class="new-job-modal__input"
              value={toDatetimeLocal(currentJob?.start)}
              oninput={(e) => {
                const val = (e.target as HTMLInputElement).value;
                if (val) currentJob.start = new Date(val);
              }} 
            />
          </div>

          <div class="new-job-modal__field">
            <label for="job-end" class="new-job-modal__label">End</label>
            <input 
              id="job-end" 
              type="datetime-local" 
              class="new-job-modal__input"
              value={toDatetimeLocal(currentJob?.end)}
              oninput={(e) => {
                const val = (e.target as HTMLInputElement).value;
                if (val) currentJob.end = new Date(val);
              }} 
            />
          </div>
        </div>

        <!-- Area -->
        <div class="new-job-modal__field">
          <label for="job-area" class="new-job-modal__label">Area of Town</label>
          <select id="job-area" class="new-job-modal__input" bind:value={currentJob.areaOfTown}>
            {#each areaOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>

        <!-- Crew -->
        <fieldset class="new-job-modal__field">
          <legend class="new-job-modal__label">Crew / Assigned Staff</legend>
          <div class="new-job-modal__crew-grid">
            {#each crewOptions as crew (crew)}
              <label class="new-job-modal__crew-option">
                <input 
                  type="checkbox" 
                  checked={currentJob.assignedCrew.includes(crew)}
                  onchange={(e) => {
                    const checked = (e.currentTarget as HTMLInputElement).checked;
                    currentJob.assignedCrew = checked 
                      ? [...currentJob.assignedCrew, crew] 
                      : currentJob.assignedCrew.filter((c: string) => c !== crew);
                  }}
                />
                {crew}
              </label>
            {/each}
          </div>
        </fieldset>

        <!-- Notes -->
        <div class="new-job-modal__field">
          <label for="job-notes" class="new-job-modal__label">Notes / Special Instructions</label>
          <textarea
            id="job-notes"
            class="new-job-modal__input"
            rows="3"
            bind:value={currentJob.notes}
            placeholder="Gate code, dog in yard, ladder needed..."
          ></textarea>
        </div>

        <!-- Billable Items -->
        <div class="new-job-modal__field">
          <label class="new-job-modal__label">Billable Items</label>
          <div class="billable-items">
            {#each currentJob.billableItems as item, index (index)}
              <BillableItemRow
                bind:item={currentJob.billableItems[index]}
                onRemove={() => removeBillableItem(index)}
                autofocusPrice={index === currentJob.billableItems.length - 1}
              />
            {/each}

            <button
              type="button"
              class="new-job-modal__btn new-job-modal__btn-add"
              onclick={addBillableItem}
            >
              + Add another item
            </button>
          </div>
        </div>

        <!-- Totals -->
        <div class="totals-summary">
          <div>Subtotal: <strong>${subtotal.toFixed(2)}</strong></div>
          <div>Tax (8%): <strong>${taxAmount.toFixed(2)}</strong></div>
          <div class="totals-summary__total">Total: <strong>${totalAmount.toFixed(2)}</strong></div>
        </div>
      </div>

      <!-- Footer -->
      <div class="new-job-modal__footer">
        {#if isEditing}
          <button class="cancel-job-text" onclick={() => showCancelConfirm = true}>
            Cancel Job
          </button>
        {/if}

        <div class="actions-right">
          <button class="new-job-modal__btn new-job-modal__btn--cancel" onclick={closeModal}>
            {isEditing ? 'Close' : 'Cancel'}
          </button>
          
          <button class="new-job-modal__btn new-job-modal__btn--primary" onclick={saveJob}>
            {isEditing ? 'Save Changes' : 'Create Job'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Cancel Confirmation -->
{#if showCancelConfirm}
  <div class="cancel-confirm-modal" onclick={() => showCancelConfirm = false}>
    <div class="cancel-confirm-modal__content" onclick={(e) => e.stopPropagation()}>
      <h3 class="cancel-confirm-modal__title">Cancel Job?</h3>
      <p class="cancel-confirm-modal__subtitle">Please select a reason:</p>

      <div class="cancel-reasons">
        {#each cancelReasons as reason}
          <label class="reason-option">
            <input 
              type="radio" 
              name="cancelReason"
              value={reason}
              bind:group={selectedCancelReason}
            />
            {reason}
          </label>
        {/each}
      </div>

      <div class="new-job-modal__field">
        <label class="new-job-modal__label">Additional notes (optional)</label>
        <textarea 
          class="new-job-modal__input" 
          rows="3"
          bind:value={currentJob.cancelNotes}
          placeholder="Any extra details..."
        ></textarea>
      </div>

      <div class="cancel-confirm-modal__footer">
        <button class="new-job-modal__btn new-job-modal__btn--cancel" onclick={() => showCancelConfirm = false}>
          Nevermind
        </button>
        <button 
          class="new-job-modal__btn new-job-modal__btn--cancel-job"
          onclick={confirmCancel}
          disabled={!selectedCancelReason}
        >
          Confirm Cancellation
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Your existing styles remain the same */
  .new-job-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 1000;
  }

  .new-job-modal__content {
    background: white;
    width: 100%;
    max-width: 560px;
    border-radius: 16px 16px 0 0;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    max-height: 95vh;
    overflow-y: auto;
    padding: 1.5rem 1rem;
  }

  .new-job-modal__title {
    margin: 0 0 1.5rem 0;
    font-size: 1.35rem;
    font-weight: 600;
    color: #1e2937;
  }

  .new-job-modal__form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .new-job-modal__field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .new-job-modal__field-group {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .new-job-modal__label {
    font-weight: 500;
    font-size: 0.95rem;
    color: #334155;
  }

  .new-job-modal__input {
    padding: 0.75rem 1rem;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 1rem;
  }

  .new-job-modal__crew-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.5rem 0;
  }

  .new-job-modal__crew-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
  }

  .billable-items {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 1rem;
    background: #fafafa;
  }

  .totals-summary {
    background: #f8fafc;
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    font-size: 1.05rem;
  }

  .totals-summary__total {
    font-size: 1.25rem;
    border-top: 2px solid #e2e8f0;
    padding-top: 0.75rem;
    margin-top: 0.75rem;
  }

  .new-job-modal__footer {
    position: sticky;
    bottom: 0;
    background: white;
    padding: 1rem 1.25rem;
    border-top: 1px solid #e5e7eb;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    align-items: center;
    z-index: 10;
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
  }

  .new-job-modal__btn {
    padding: 0.85rem 1.5rem;
    border-radius: 8px;
    font-weight: 500;
    cursor: pointer;
    border: none;
  }

  .new-job-modal__btn--cancel {
    background: #f1f5f9;
    color: #475569;
  }

  .new-job-modal__btn--primary {
    background: #3b82f6;
    color: white;
  }

  .new-job-modal__btn-add {
    background: #e0f2fe;
    color: #0369a1;
    width: 100%;
    margin-top: 0.5rem;
  }

  .cancel-confirm-modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
  }

  .cancel-confirm-modal__content {
    background: white;
    padding: 2rem;
    border-radius: 12px;
    max-width: 420px;
    width: 90%;
  }

  .cancel-confirm-modal__footer {
    position: sticky;
    bottom: 0;
    background: white;
    padding: 1rem 1.25rem;
    border-top: 1px solid #e5e7eb;
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    z-index: 10;
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
  }

  .cancel-job-text {
    color: #dc2626;
    font-weight: 600;
    background: none;
    border: none;
    cursor: pointer;
  }
</style>