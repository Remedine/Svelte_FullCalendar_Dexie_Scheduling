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
	import { createJob, updateJob, cancelJob, rescheduleCancelledJob, updateClient } from '$lib/db';
	import ClientPicker from './ClientPicker.svelte';
	import BillableItemRow from './BillableItemRow.svelte';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import { normalizeTaxRateToPercent } from '$lib/utils/tax';
	import { db, type Client, cleanupDuplicateUsers, getUserPhotoSrc } from '$lib/db';

	let show = $state(false);
	let isEditing = $state(false);
	let editingJobId = $state<string | null>(null);
	let showCancelConfirm = $state(false);
	let isUpdatingCancelReason = $state(false);
	let showRescheduleHighlight = $state(false);
	let selectedCancelReason = $state('');

	let currentJob = $state<any>({
		title: 'Full Exterior Window Cleaning',
		start: new Date(),
		end: new Date(),
		clientId: null,
		assignedCrew: [],
		areaOfTown: '',
		notes: '',
		cancelReason: '',
		cancelNotes: '',
		billableItems: [{ title: '', price: 0, quantity: 1, total: 0 }]
	});

	let crewOptions = $state<string[]>([]);
	let crewPhotoMap = $state<Record<string, string>>({});
	let afterSaveCallback: (() => void) | null = null;

	const areaOptions = $derived(
		(optionsStore.data?.areasOfTown || []).map((area: any) => ({
			value: area.id,
			label: area.label,
			color: area.color
		}))
	);

	const cancelReasons = $derived(optionsStore.data?.cancelReasons || []);
	const defaultBillableItems = $derived(optionsStore.data?.defaultBillableItems || []);

	// Register this instance
	$effect(() => {
		modalInstance = {
			open: async (job?: any, callback?: () => void) => {
				afterSaveCallback = callback || null;

				if (!optionsStore.data) {
					await optionsStore.load?.();
				}
				// )=- Try to pull fresh options from PB when opening job modal (so areas, durations, billables from options page are up to date).
				// Guarded by auth in the store; falls back to local/default if not possible.
				if (navigator.onLine) {
					await optionsStore.pullFromPB?.();
				}

				if (job) {
					const startDate = job.start instanceof Date ? job.start : new Date(job.start);

					let endDate;

					if (job.end instanceof Date && !isNaN(job.end.getTime())) {
						endDate = job.end;
					} else {
						// Use the correct field name from options
						const durationHours = optionsStore.data?.defaultJobDurationHours ?? 2;
						endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);
					}

					currentJob = {
						...job,
						start: startDate,
						end: endDate,
						areaOfTown: job.areaOfTown ?? '',
						assignedCrew: job.assignedCrew || [],
						billableItems: job.billableItems?.length
							? job.billableItems.map((b: any) => {
								// Normalize legacy shape from options (uses 'hours' key for Per Hour) to form shape (quantity + unit)
								if (b.hours !== undefined) {
									return { ...b, quantity: b.hours, unit: 'hour' };
								}
								return { ...b, unit: b.unit || 'qty' };
							})
							: [{ title: '', price: 0, quantity: 1, total: 0, unit: 'qty' }]
					};

					isEditing = true;
					editingJobId = job.id || null;
				} else {
					// New job (when opened without passing a job object)
					const now = new Date();
					const durationHours = optionsStore.data?.defaultJobDurationHours ?? 2;

					currentJob = {
						title: 'Full Exterior Window Cleaning',
						start: now,
						end: new Date(now.getTime() + durationHours * 60 * 60 * 1000),
						clientId: null,
						assignedCrew: [],
						areaOfTown: areaOptions[0]?.value || '',
						notes: '',
						cancelReason: '',
						cancelNotes: '',
						billableItems: [{ title: '', price: 0, quantity: 1, total: 0, unit: 'qty' }]
					};

					isEditing = false;
					editingJobId = null;
				}

				showRescheduleHighlight = false;
				isUpdatingCancelReason = false;
				showCancelConfirm = false;
				selectedCancelReason = job?.cancelReason || '';

				show = true;
			}
		};
	});

	// Load crew members (with photos for avatars)
	$effect(() => {
		cleanupDuplicateUsers().then(() => {
			db.users.toArray().then((users: any[]) => {
				const active = users.filter((u) => u.active);
				crewOptions = Array.from(
					new Set(
						active.map((u) => u.name)
					)
				).sort();
				// Build photo map (name -> src) so we can render avatars without names
				crewPhotoMap = {};
				active.forEach((u: any) => {
					if (u.name) {
						crewPhotoMap[u.name] = getUserPhotoSrc(u.photo, u) || '';
					}
				});
			});
		});
	});

	// Area sync from client → job happens only in ClientPicker onSelect (user picks a client).
	// Do NOT auto-sync on clientId bind when opening edit — that overwrote the job's saved area
	// with the client's area (e.g. always showing Valley).

	// Scroll modal content to top when it opens
	$effect(() => {
		if (show) {
			setTimeout(() => {
				const content = document.querySelector('.new-job-modal__content');
				if (content) {
					content.scrollTop = 0;
				}
			}, 50);
		}
	});

	const subtotal = $derived(
		currentJob.billableItems.reduce((sum: number, item: any) => sum + (item.total || 0), 0)
	);

	const taxRatePercent = $derived(normalizeTaxRateToPercent(optionsStore.data?.taxRate, 8));
	const taxRateDecimal = $derived(taxRatePercent / 100);
	const taxAmount = $derived(Math.round(subtotal * taxRateDecimal * 100) / 100);
	const totalAmount = $derived(subtotal + taxAmount);

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
			{ title: '', price: 0, quantity: 1, total: 0, unit: 'qty' }
		];
	}

	function removeBillableItem(index: number) {
		if (currentJob.billableItems.length > 1) {
			currentJob.billableItems = currentJob.billableItems.filter((_: any, i: number) => i !== index);
		}
	}

	function getAreaColor(areaId: string | undefined): string {
		if (!areaId || !areaOptions.length) return '#64748b';
		const area = areaOptions.find((a: any) => a.value === areaId);
		return getDisplayAreaColor(area?.color);
	}

	function parseJobDate(value: Date | string | undefined): Date | null {
		if (!value) return null;
		const date = value instanceof Date ? value : new Date(value);
		return isNaN(date.getTime()) ? null : date;
	}

	function startReschedule() {
		showRescheduleHighlight = true;
		requestAnimationFrame(() => {
			document.getElementById('job-start')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	}

	function openUpdateCancelReason() {
		selectedCancelReason = currentJob.cancelReason || '';
		isUpdatingCancelReason = true;
		showCancelConfirm = true;
	}

	function closeCancelConfirm() {
		showCancelConfirm = false;
		isUpdatingCancelReason = false;
	}

	async function saveJob() {
		if (!currentJob.clientId) {
			alert('Please select a client');
			return;
		}

		const startDate = parseJobDate(currentJob.start);
		const endDate = parseJobDate(currentJob.end);

		if (!startDate || !endDate) {
			alert('Please enter valid start and end times.');
			return;
		}

		if (showRescheduleHighlight) {
			const now = new Date();
			if (startDate <= now || endDate <= now) {
				alert('Start and end times must be in the future to reschedule a cancelled job.');
				return;
			}
			if (endDate <= startDate) {
				alert('End time must be after start time.');
				return;
			}
		}

		// )=- If the client has no areaOfTown yet but this job does, backfill the client.
		// In almost all cases client and job share the area; this makes the job form "teach" the client
		// its area when the client was created without one (e.g. inline creation in this modal or older data).
		// We do this on every save (create or edit) so historical jobs can correct the client's area.
		if (currentJob.clientId && currentJob.areaOfTown) {
			const client = await db.clients.get(currentJob.clientId);
			if (client && !client.areaOfTown) {
				await updateClient(currentJob.clientId, {
					...client,
					areaOfTown: currentJob.areaOfTown,
					updatedAt: new Date()
				});
			}
		}

		const cleanPayload = {
			title: currentJob.title || 'Untitled Job',
			start: startDate,
			end: endDate,
			clientId: currentJob.clientId,
			assignedCrew: currentJob.assignedCrew || [],
			areaOfTown: currentJob.areaOfTown,
			notes: currentJob.notes || undefined,
			billableItems: currentJob.billableItems.map((item: any) => ({ ...item })),
			subtotal,
			taxRate: taxRatePercent,
			taxAmount,
			totalAmount,
			status: isEditing ? currentJob.status || 'scheduled' : 'scheduled'
		};

		try {
			if (isEditing && editingJobId) {
				if (showRescheduleHighlight && currentJob.status === 'cancelled') {
					await rescheduleCancelledJob(editingJobId, cleanPayload);
				} else {
					await updateJob(editingJobId, cleanPayload);
				}
			} else {
				await createJob(cleanPayload);
			}

			showRescheduleHighlight = false;
			show = false;

			if (afterSaveCallback) {
				setTimeout(() => afterSaveCallback(), 450);
			}
		} catch (err) {
			console.error('Failed to save job', err);
			alert('Error saving job - check console');
		}
	}

	async function confirmCancel() {
		if (!editingJobId || !selectedCancelReason) return;

		if (isUpdatingCancelReason) {
			if (currentJob.status !== 'cancelled') {
				closeCancelConfirm();
				return;
			}
			await cancelJob(editingJobId, selectedCancelReason, currentJob.cancelNotes);
			currentJob.cancelReason = selectedCancelReason;
			closeCancelConfirm();
			return;
		}

		// )=- Extra runtime guard: do not allow cancelling completed jobs even if UI button was somehow shown.
		if (currentJob.status === 'completed' || currentJob.status === 'cancelled') {
			alert('Cannot cancel a completed or already-cancelled job.');
			closeCancelConfirm();
			return;
		}
		await cancelJob(editingJobId, selectedCancelReason, currentJob.cancelNotes);
		show = false;
		closeCancelConfirm();
		if (afterSaveCallback) afterSaveCallback();
	}

	function closeModal() {
		show = false;
		showRescheduleHighlight = false;
		closeCancelConfirm();
	}
</script>

<!-- Main Modal -->
{#if show}
	<div class="modal-overlay new-job-modal" role="presentation" onclick={closeModal}>
		<div
			class="modal-content new-job-modal__content"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.stopPropagation();
					closeModal();
				}
			}}
		>
			<div class="new-job-modal__header">
				<h2 class="new-job-modal__title">
					{isEditing ? 'Edit Job' : 'Create New Job'}
				</h2>
				{#if isEditing && currentJob.status === 'cancelled'}
					<div class="new-job-modal__header-meta">
						<span class="new-job-modal__status new-job-modal__status--cancelled">Cancelled</span>
						{#if currentJob.cancelReason}
							<span class="new-job-modal__cancel-detail">{currentJob.cancelReason}</span>
						{/if}
					</div>
				{/if}
			</div>

			<div class="new-job-modal__form">
				<!-- Job Title -->
				<div class="new-job-modal__field">
					<label for="job-title" class="new-job-modal__label label">Job Title (optional)</label>
					<input id="job-title" class="new-job-modal__input input" bind:value={currentJob.title} />
				</div>

				<!-- Client -->
				<div class="new-job-modal__field">
					<label for="client-picker" class="new-job-modal__label label">Client</label>

					<ClientPicker
						bind:value={currentJob.clientId}
						allowCreate={true}
						placeholder="Select or create client..."
						onSelect={(client: Client) => {
							// )=- When client selected (existing or newly created inline), auto-set job area to client's area if present.
							// This enforces the common case that job and client share the same areaOfTown.
							if (client?.areaOfTown) {
								currentJob.areaOfTown = client.areaOfTown;
							}
							console.log('✅ Client selected:', client.name);
						}}
						onCreate={async (name: string) => {
							console.log('New client created inline:', name);
						}}
					/>
				</div>

				<!-- )=- Area of Town moved immediately under the Client picker (as requested).
             We also added backfill: on job save, if the selected client has no areaOfTown
             but the job does, we update the client. This keeps the common "client == job area" invariant
             without forcing the user to set it twice. -->
				<div class="new-job-modal__field">
					<label for="job-area" class="new-job-modal__label label">Area of Town</label>
					<div
						class="area-field-wrapper"
						style="border-left: 6px solid {getAreaColor(currentJob.areaOfTown)};"
					>
						<select
							id="job-area"
							class="area-select input"
							bind:value={currentJob.areaOfTown}
						>
							<option value="">Select area...</option>
							{#each areaOptions as option (option.value)}
								<option 
									value={option.value}
									style="color: {getDisplayAreaColor(option.color)};"
								>■ {option.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Dates -->
				<div
					class="new-job-modal__field-group"
					class:new-job-modal__field-group--reschedule-highlight={showRescheduleHighlight}
				>
					<div class="new-job-modal__field">
						<label for="job-start" class="new-job-modal__label label">Start</label>
						<input
							id="job-start"
							type="datetime-local"
							class="new-job-modal__input input"
							class:new-job-modal__input--reschedule-highlight={showRescheduleHighlight}
							value={toDatetimeLocal(currentJob?.start)}
							oninput={(e) => {
								const val = (e.target as HTMLInputElement).value;
								if (val) currentJob.start = new Date(val);
							}}
						/>
					</div>

					<div class="new-job-modal__field">
						<label for="job-end" class="new-job-modal__label label">End</label>
						<input
							id="job-end"
							type="datetime-local"
							class="new-job-modal__input input"
							class:new-job-modal__input--reschedule-highlight={showRescheduleHighlight}
							value={toDatetimeLocal(currentJob?.end)}
							oninput={(e) => {
								const val = (e.target as HTMLInputElement).value;
								if (val) currentJob.end = new Date(val);
							}}
						/>
					</div>
				</div>

				<!-- Crew / Assigned Staff: avatars only (no names), border highlight for selected -->
				<fieldset class="new-job-modal__field">
					<legend class="new-job-modal__label label">Crew / Assigned Staff</legend>
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
									aria-label={crew}
								/>
								<div
									class="new-job-modal__crew-avatar"
									class:selected={currentJob.assignedCrew.includes(crew)}
									title={crew}
								>
									{#if crewPhotoMap[crew]}
										<img src={crewPhotoMap[crew]} alt={crew} />
									{:else}
										<span class="initial">{crew?.charAt(0)?.toUpperCase() || '?'}</span>
									{/if}
								</div>
							</label>
						{/each}
					</div>
				</fieldset>

				<!-- Notes -->
				<div class="new-job-modal__field">
					<label for="job-notes" class="new-job-modal__label label">Notes / Special Instructions</label>
					<textarea
						id="job-notes"
						class="new-job-modal__input input"
						rows="3"
						bind:value={currentJob.notes}
						placeholder="Gate code, dog in yard, ladder needed..."
					></textarea>
				</div>

				<!-- Billable Items -->
				<div class="new-job-modal__field">
					<label id="billable-label" class="new-job-modal__label label">Billable Items</label>
					<div class="billable-items" role="group" aria-labelledby="billable-label">
						{#each currentJob.billableItems as item, index (index)}
							<BillableItemRow
								bind:item={currentJob.billableItems[index]}
								onRemove={() => removeBillableItem(index)}
							/>
						{/each}

						<button
							type="button"
							class="new-job-modal__btn new-job-modal__btn-add button"
							onclick={addBillableItem}
						>
							+ Add another item
						</button>
					</div>
				</div>

				<!-- Totals -->
				<div class="totals-summary">
					<div class="totals-summary__line">Subtotal: <strong>${subtotal.toFixed(2)}</strong></div>
					<div class="totals-summary__line">Tax ({taxRatePercent.toFixed(1)}%):</div>
					<div class="totals-summary__total">Total: <strong>${totalAmount.toFixed(2)}</strong></div>
				</div>
			</div>

			<!-- Sticky Footer / Anchored actions.
			     Per request: Close + Save Changes on one line, right aligned.
			     Cancel Job on next line, right aligned, text-only red (de-emphasized).
			     Primary actions always visible at bottom of modal view. -->
			<div class="new-job-modal__footer sticky-footer">
				<div class="footer-primary">
					<button class="new-job-modal__btn button button--ghost" onclick={closeModal}>
						{isEditing ? 'Close' : 'Cancel'}
					</button>

					<button
						class="new-job-modal__btn button button--primary"
						class:new-job-modal__btn--reschedule-highlight={showRescheduleHighlight}
						onclick={saveJob}
					>
						{showRescheduleHighlight ? 'Save reschedule' : isEditing ? 'Save Changes' : 'Create Job'}
					</button>
				</div>

				{#if isEditing && currentJob.status === 'cancelled'}
					<div class="new-job-modal__cancelled-actions">
						<button
							type="button"
							class="new-job-modal__secondary-action"
							onclick={openUpdateCancelReason}
						>
							Update cancel reason
						</button>
						<button
							type="button"
							class="new-job-modal__secondary-action new-job-modal__secondary-action--reschedule"
							onclick={startReschedule}
						>
							Reschedule
						</button>
					</div>
				{/if}

				{#if isEditing && currentJob.status !== 'completed' && currentJob.status !== 'cancelled'}
					<!-- )=- Prevent cancel for completed or already-cancelled jobs.
               )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 (cancel flow) + Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
					<button class="cancel-job-text" onclick={() => (showCancelConfirm = true)}>
						Cancel Job
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Cancel Confirmation -->
{#if showCancelConfirm}
	<div class="modal-overlay cancel-confirm-modal" role="presentation" onclick={closeCancelConfirm}>
		<div class="modal-content cancel-confirm-modal__content" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.stopPropagation();
					closeCancelConfirm();
				}
			}}>
			<h3 class="cancel-confirm-modal__title">
				{isUpdatingCancelReason ? 'Update cancel reason' : 'Cancel Job?'}
			</h3>
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
				<label class="new-job-modal__label">
					Additional notes (optional)
					<textarea
						class="new-job-modal__input"
						rows="3"
						bind:value={currentJob.cancelNotes}
						placeholder="Any extra details..."
					></textarea>
				</label>
			</div>

			<div class="cancel-confirm-modal__footer">
				<button
					class="new-job-modal__btn new-job-modal__btn--cancel button button--ghost"
					onclick={closeCancelConfirm}
				>
					Nevermind
				</button>
				<button
					class="new-job-modal__btn new-job-modal__btn--cancel-job button"
					onclick={confirmCancel}
					disabled={!selectedCancelReason}
				>
					{isUpdatingCancelReason ? 'Save reason' : 'Confirm Cancellation'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* JobFormModal now leans heavily on globals.css primitives (.input, .label, .button) + design tokens
	   for cohesion. BEM kept for specific structure and overrides. All colors/spacing/radii via vars. */

	/* Base .new-job-modal shell now uses global .modal-overlay + .modal-content for cohesion.
	   (global handles mobile bottom-sheet). Only prefixed BEM extensions here. */

	.new-job-modal__header {
		padding: var(--space-6) var(--space-4) 0;
	}

	.new-job-modal__title {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.new-job-modal__header-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.new-job-modal__status {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.6rem;
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
	}

	.new-job-modal__status--cancelled {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
	}

	.new-job-modal__cancel-detail {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.new-job-modal__form {
		flex: 1;
		overflow-y: auto;
		margin-top: var(--space-6);
		padding: 0 var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.new-job-modal__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.new-job-modal__field-group {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
	}

	/* .new-job-modal__label now relies entirely on the .label primitive from globals.css */

	/* .new-job-modal__input relies on global .input primitive */

	.new-job-modal__crew-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		padding: var(--space-2) 0;
	}

	.new-job-modal__crew-option {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.new-job-modal__crew-option input[type="checkbox"] {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
	}

	.new-job-modal__crew-avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid transparent;
		background: var(--color-surface-alt);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 11px;
		font-weight: 600;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.new-job-modal__crew-avatar.selected {
		border-color: var(--color-primary);
	}
	.new-job-modal__crew-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.new-job-modal__crew-avatar .initial {
		text-transform: uppercase;
	}

	.billable-items {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		background: var(--color-surface-alt);
		/* Group the billable rows with consistent internal spacing */
	}


	.totals-summary {
		background: var(--color-surface-alt);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		font-size: var(--font-size-base);
		margin-bottom: var(--space-3);
	}

	.totals-summary__line {
		color: var(--color-text-muted);
	}

	.totals-summary__total {
		font-size: var(--font-size-xl);
		border-top: 2px solid var(--color-border);
		padding-top: var(--space-3);
		margin-top: var(--space-3);
	}

	.new-job-modal__footer {
		/* base from global .sticky-footer; specific layout kept */
		display: flex;
		flex-direction: column;
		align-items: flex-end; /* all content right aligned */
		gap: var(--space-2);
	}

	.footer-primary {
		display: flex;
		gap: var(--space-2);
		/* Close and Save Changes on one line, right aligned */
	}

	.new-job-modal__btn {
		/* base .button provides core button styles; these add modal-specific sizing */
		padding: var(--space-3) var(--space-6);
	}

	.new-job-modal__btn-add {
		width: 100%;
		margin-top: var(--space-3);
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}

	.area-field-wrapper {
		display: flex;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		min-height: 44px; /* match input touch target */
		transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
	}

	.area-field-wrapper:focus-within {
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}

	.area-select {
		flex: 1;
		border: none;
		background: transparent;
		padding: var(--space-2) var(--space-4); /* padding + room for native dropdown arrow */
		font-size: var(--font-size-base);
		color: var(--color-text);
		outline: none;
		cursor: pointer;
		width: 100%;
		appearance: none; /* cleaner native look, arrow still shows in most browsers */
	}

	/* For the options in the native dropdown: use token bg for dark mode support.
	   Inline style on each option sets the text color to the area color, making the color visible "next to"/for each option in the list. */
	.area-select option {
		background: var(--color-surface);
	}

	/* cancel-confirm uses global modal shell now; only its specific BEM kept. */

	.cancel-confirm-modal__footer {
		position: sticky;
		bottom: 0;
		background: var(--color-surface);
		padding: var(--space-4) var(--space-5);
		border-top: 1px solid var(--color-border);
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		z-index: 10;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
	}

	.cancel-job-text {
		color: var(--color-danger-emphasis);
		font-weight: var(--font-weight-semibold);
		background: none;
		border: none;
		cursor: pointer;
	}

	.new-job-modal__cancelled-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		width: 100%;
	}

	.new-job-modal__secondary-action {
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}

	.new-job-modal__secondary-action--reschedule {
		border-color: var(--color-primary);
		color: var(--color-primary-emphasis);
		background: var(--color-primary-soft);
	}

	.new-job-modal__input--reschedule-highlight,
	.new-job-modal__field-group--reschedule-highlight {
		outline: 2px solid var(--color-warning);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.new-job-modal__field-group--reschedule-highlight {
		padding: var(--space-2);
		animation: new-job-modal-reschedule-pulse 1.2s ease-in-out infinite;
	}

	.new-job-modal__btn--reschedule-highlight {
		animation: new-job-modal-reschedule-pulse 1.2s ease-in-out infinite;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 35%, transparent);
	}

	@keyframes new-job-modal-reschedule-pulse {
		0%,
		100% {
			outline-color: var(--color-warning);
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 35%, transparent);
		}
		50% {
			outline-color: var(--color-primary);
			box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 30%, transparent);
		}
	}

	/* Calendar picker icon color for dark mode (the native indicator is dark by default) */
	.new-job-modal__input[type="datetime-local"]::-webkit-calendar-picker-indicator {
		filter: invert(0.2);
	}
	.dark .new-job-modal__input[type="datetime-local"]::-webkit-calendar-picker-indicator {
		filter: invert(1); /* white/light for dark mode */
	}

	/* Mobile tweaks for job form modal title (per request): reduce height by minimizing margin/padding,
	   slightly smaller font. Keeps a few pixels for visual breathing room. Desktop unchanged. */
	@media (max-width: 768px) {
		.new-job-modal__header {
			padding: 2px var(--space-2) 0;
		}

		.new-job-modal__title {
			font-size: var(--font-size-lg);
		}

		.new-job-modal__form {
			margin-top: var(--space-2);
		}
	}
</style>
