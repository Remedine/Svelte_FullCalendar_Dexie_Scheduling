<!-- src/lib/components/JobDetailsModal.svelte -->
<script module>
	import { type Job, type Invoice } from '$lib/db';

	type JobDetailsContext = {
		fromClientId?: string;
		fromClientName?: string;
		initialTab?: 'job' | 'invoice';
	};

	let modalInstance: {
		open: (jobOrId: string | Job, context?: JobDetailsContext) => void;
	} | null = null;

	export function openJobDetailsModal(jobOrId: string | Job, context?: JobDetailsContext) {
		if (modalInstance) {
			modalInstance.open(jobOrId, context);
		} else {
			console.warn('JobDetailsModal not yet mounted');
		}
	}
</script>

<script lang="ts">
	import {
		db,
		type Job,
		type Invoice,
		type Client,
		ensureInvoiceShell,
		updateJob,
		getUserPhotoSrc,
		ensureInvoiceForJob,
		isInvoiceOverdue,
		cancelJob
	} from '$lib/db';
	import { pb, pullUsersFromServer, pullInvoicesFromServer } from '$lib/db/pb';
	import { auth } from '$lib/stores/auth.svelte';
	import { openJobModal } from './JobFormModal.svelte';
	import { goto } from '$app/navigation';
	import { toDateString } from '$lib/utils/dates';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import InvoiceEditor from './InvoiceEditor.svelte';

	// )=- Module-level singleton so any page can call openJobDetailsModal(job) without prop drilling.
	// Mirrors the proven pattern from JobFormModal.
	// Reference: JOBS_AND_INVOICES_SPEC.md (Phase 3) + Remedine/Svelte_FullCalendar_Dexie_Scheduling

	let show = $state(false);
	let loading = $state(true);
	let job = $state<Job | null>(null);
	let invoice = $state<Invoice | null>(null);
	let clientContext = $state<JobDetailsContext | null>(null);
	let showInvoiceUpload = $state(false);
	let resolvedClient = $state<Client | null>(null);

	// )=- Cancel flow state for Phase 7 "Cancel flow from details if needed".
	// Uses cancelReasons from options (loaded in the options $effect).
	// Inline form (BEM) to avoid modal inception; calls the existing cancelJob helper from db.
	// After cancel, reloads job so status/notes update, and cancelled info shows.
	// )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 + Remedine/Svelte_FullCalendar_Dexie_Scheduling
	let showCancelForm = $state(false);
	let selectedCancelReason = $state('');
	let cancelNotesInput = $state('');
	let activeTab = $state<'job' | 'invoice'>('job');

	// Register singleton (runes only, no onMount)
	$effect(() => {
		modalInstance = {
			open: async (jobOrId: string | Job, ctx?: JobDetailsContext) => {
				clientContext = ctx || null;
				loading = true;
				show = true;
				activeTab = ctx?.initialTab ?? 'job';
				showCancelForm = false;

				try {
					if (typeof jobOrId === 'string') {
						const found = await db.jobs.get(jobOrId);
						job = found || null;
					} else {
						job = jobOrId;
					}

					if (job) {
						// Defensive reload in case we were passed stale object
						const fresh = await db.jobs.get(job.id!);
						if (fresh) job = fresh;

						if (auth.currentUser?.role === 'admin' && navigator.onLine) {
							await pullInvoicesFromServer();
						}
						invoice = await ensureInvoiceShell(job);

						if (job.clientId) {
							let cl = await db.clients.get(job.clientId);
							if (!cl) cl = await db.clients.where('pbId').equals(job.clientId).first();
							if (cl) {
								resolvedClient = cl;
							}
						}
					}
				} catch (e) {
					console.error('Failed to load job/invoice for details modal', e);
				} finally {
					loading = false;
				}
			}
		};
	});

	// )=- Auto-load options so due days, tax, and areasOfTown are available (for labels/colors in location section and future regenerate).
	$effect(() => {
		if (show && !optionsStore.data) {
			optionsStore.load?.();
		}
	});

	const areaOptions = $derived(optionsStore.data?.areasOfTown || []);
	const area = $derived(areaOptions.find((a) => a.id === job?.areaOfTown));

	// )=- Cancel reasons from options for the cancel form (Phase 7).
	const cancelReasons = $derived(optionsStore.data?.cancelReasons || []);

	// )=- Load users for crew avatars in the details modal (consistent with jobs page cards and calendar).
	// For admins we also trigger the server pull (guarded) so photos/names for other crew are available even if Crew page not visited.
	let users = $state<any[]>([]);
	$effect(() => {
		if (show && users.length === 0) {
			db.users.toArray().then((us: any[]) => {
				users = us;
			});
			if (auth.currentUser?.role === 'admin' && navigator.onLine) {
				pullUsersFromServer().then(() => {
					db.users.toArray().then((us: any[]) => { users = us; });
				});
			}
		}
	});

	function closeModal() {
		show = false;
		job = null;
		invoice = null;
		clientContext = null;
		showInvoiceUpload = false;
		resolvedClient = null;
		activeTab = 'job';
		showCancelForm = false;
	}

	// )=- "Edit full job" flow required by spec: close this modal first (avoid inception),
	// call the existing openJobModal, then use its onAfterSave callback to re-open this details modal
	// with fresh data. This gives the user a seamless round-trip.
	async function editJob() {
		if (!job) return;
		const currentJob = { ...job };
		closeModal();

		openJobModal(currentJob, async () => {
			// )=- Improved re-open for Phase 7 risk "Modal stacking / re-open callback must feel smooth (no flash, correct data)".
			// We explicitly re-fetch the job from Dexie inside the callback (after the form has saved and closed).
			// Passing the fresh object to openJobDetailsModal (which still does defensive reload but starts with up-to-date data).
			// This ensures "correct data" without relying on the id-only path, and the close-then-open is the chosen pattern to avoid stacking.
			// A small async gap lets the form's close animation settle before the details re-appears.
			// Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 + risk notes + Remedine/Svelte_FullCalendar_Dexie_Scheduling
			if (currentJob.id) {
				const freshJob = await db.jobs.get(currentJob.id);
				// small delay to reduce visual flash between modals
				await new Promise((r) => setTimeout(r, 50));
				const reopenContext: JobDetailsContext = {
					...clientContext,
					initialTab: 'job'
				};
				if (freshJob) {
					openJobDetailsModal(freshJob, reopenContext);
				} else {
					openJobDetailsModal(currentJob.id, reopenContext);
				}
			}
		});
	}

	function jumpToCalendar() {
		if (!job) return;
		// )=- Jump to split calendar with local date + jobId so SplitCalendar focuses the day and
		// briefly highlights the matching event block.
		const date = toDateString(job.start);
		const params = new URLSearchParams({ date });
		const jobId = job.id || job.pbId;
		if (jobId) params.set('jobId', jobId);
		goto(`/calendar/split?${params.toString()}`);
		closeModal();
	}

	// Quick inline status change (spec allows light inline edits)
	async function quickUpdateJobStatus(newStatus: Job['status']) {
		if (!job?.id) return;
		if (newStatus === 'completed' && new Date() < new Date(job.start)) {
			alert('Cannot mark complete before the job start time.');
			return;
		}
		await updateJob(job.id, { status: newStatus });
		if (newStatus === 'completed') {
			await ensureInvoiceForJob(job, 'generated');
			if (job.id) invoice = await ensureInvoiceShell(job);
		}
		const fresh = await db.jobs.get(job.id);
		if (fresh) job = fresh;
	}

	// )=- Cancel flow from details modal (Phase 7).
	// Requires a reason from options.cancelReasons; optional notes.
	// Uses the shared cancelJob(db) which sets status, cancelReason, cancelNotes, cancelledAt, cancelledBy (current user).
	// Resets form and reloads job for fresh display (cancel info will show in Notes section).
	async function confirmCancelJob() {
		if (!job?.id || !selectedCancelReason) return;
		await cancelJob(job.id, selectedCancelReason, cancelNotesInput || undefined);
		const fresh = await db.jobs.get(job.id);
		if (fresh) job = fresh;
		// close form
		showCancelForm = false;
		selectedCancelReason = '';
		cancelNotesInput = '';
	}

	// Derived display helpers (kept simple, BEM-ready)
	const jobStatusClass = $derived(
		job ? `job-details__status job-details__status--${job.status}` : ''
	);
	const invoiceStatus = $derived(invoice?.status || 'none');
	// )=- Now uses the shared helper (added for Phase 7 overdue visuals everywhere) for consistency across jobs cards, clients related list, and modal.
	const isOverdue = $derived(isInvoiceOverdue(invoice));
</script>

{#if show}
	<div class="modal-overlay job-details-modal" role="presentation" onclick={closeModal}>
		<div class="modal-content job-details-modal__content" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
			{#if loading}
				<div class="job-details-modal__loading">Loading job details…</div>
			{:else if !job}
				<div class="job-details-modal__empty">Job not found.</div>
			{:else}
				<div class="job-details-modal__header">
					<div class="job-details-modal__header-top">
						<div class="job-details-modal__header-main">
							<h2 class="job-details-modal__title">{job.title || 'Untitled Job'}</h2>
							{#if clientContext?.fromClientName}
								<div class="job-details-modal__context">
									Related to <strong>{clientContext.fromClientName}</strong>
								</div>
							{/if}
							<p class="job-details-modal__header-meta">
								<span class={jobStatusClass}>{job.status}</span>
								<span class="job-details-modal__meta-sep" aria-hidden="true">·</span>
								<span
									class="job-details-modal__status job-details-modal__status--{invoiceStatus}"
								>
									{invoice ? invoice.status : 'no invoice'}
								</span>
								{#if isOverdue}
									<span class="job-details-modal__meta-sep" aria-hidden="true">·</span>
									<span class="job-details-modal__overdue">Overdue</span>
								{/if}
								<span class="job-details-modal__meta-sep" aria-hidden="true">·</span>
								<strong class="job-details-modal__header-amount"
									>${(invoice?.amount ?? job.totalAmount)?.toFixed(2) || '0.00'}</strong
								>
								{#if invoice}
									<span class="job-details-modal__meta-sep" aria-hidden="true">·</span>
									<span>Due {new Date(invoice.dueDate).toLocaleDateString()}</span>
								{/if}
							</p>
						</div>
						<button
							type="button"
							class="job-details-modal__close-btn"
							aria-label="Close"
							onclick={closeModal}
						>
							×
						</button>
					</div>
				</div>

				<div class="job-details-modal__tabs" role="tablist">
					<button
						type="button"
						role="tab"
						class="job-details-modal__tab"
						class:job-details-modal__tab--active={activeTab === 'job'}
						aria-selected={activeTab === 'job'}
						onclick={() => (activeTab = 'job')}
					>
						Job
					</button>
					<button
						type="button"
						role="tab"
						class="job-details-modal__tab"
						class:job-details-modal__tab--active={activeTab === 'invoice'}
						aria-selected={activeTab === 'invoice'}
						onclick={() => (activeTab = 'invoice')}
					>
						Invoice
					</button>
				</div>

				<div class="job-details-modal__body">
					{#if activeTab === 'job'}
						<section class="job-details-modal__section">
							<h3 class="job-details-modal__section-title">Client &amp; Location</h3>
							<div class="job-details-modal__meta">
								{#if resolvedClient}
									<div><strong>{resolvedClient.name}</strong></div>
									<div>
										{resolvedClient.serviceAddressStreet || ''}
										{resolvedClient.serviceAddressCity || ''}
									</div>
								{:else}
									<div>Client: {job.clientId}</div>
								{/if}
								<div style="color: {getDisplayAreaColor(area?.color) || '#64748b'};">
									Area: {area?.label || job.areaOfTown || '—'}
								</div>
							</div>
						</section>

						<section class="job-details-modal__section">
							<h3 class="job-details-modal__section-title">Schedule</h3>
							<div class="job-details-modal__meta">
								<div>Start: {new Date(job.start).toLocaleString()}</div>
								<div>End: {new Date(job.end).toLocaleString()}</div>
							</div>
						</section>

						<section class="job-details-modal__section">
							<h3 class="job-details-modal__section-title">Assigned Crew</h3>
							<div class="job-details-modal__crew">
								{#each job.assignedCrew || [] as crewName}
									{@const u = users.find((uu) => uu.name === crewName)}
									<span class="job-details-modal__crew-pill" title={crewName}>
										{#if u?.photo}
											<img
												class="job-details-modal__crew-avatar"
												src={getUserPhotoSrc(u.photo, u)}
												alt={crewName}
											/>
										{:else}
											<span class="job-details-modal__crew-initial"
												>{crewName?.[0]?.toUpperCase() || '?'}</span
											>
										{/if}
										{crewName}
									</span>
								{:else}
									<span class="job-details-modal__empty-text">No crew assigned</span>
								{/each}
							</div>
						</section>

						<section class="job-details-modal__section">
							<h3 class="job-details-modal__section-title">Notes</h3>
							<p class="job-details-modal__notes">{job.notes || '—'}</p>
							{#if job.cancelReason}
								<p class="job-details-modal__cancel">
									Cancelled: {job.cancelReason}
									{job.cancelNotes ? `— ${job.cancelNotes}` : ''}
								</p>
							{/if}
						</section>

						<section class="job-details-modal__section job-details-modal__job-actions">
							<h3 class="job-details-modal__section-title">Job actions</h3>
							<div class="job-details-modal__action-row">
								{#if job.status === 'completed'}
									<button
										class="job-details-modal__btn job-details-modal__btn--small"
										onclick={() => quickUpdateJobStatus('scheduled')}
									>
										Revert to scheduled
									</button>
								{:else}
									<button
										class="job-details-modal__btn job-details-modal__btn--small job-details-modal__btn--primary"
										onclick={() => quickUpdateJobStatus('completed')}
										disabled={new Date() < new Date(job.start)}
									>
										Mark complete
									</button>
								{/if}
								{#if job.status !== 'cancelled' && job.status !== 'completed'}
									<button
										class="job-details-modal__btn job-details-modal__btn--small job-details-modal__btn--cancel"
										onclick={() => (showCancelForm = !showCancelForm)}
									>
										{showCancelForm ? 'Hide cancel' : 'Cancel job'}
									</button>
								{/if}
							</div>
							{#if showCancelForm}
								<div class="job-details-modal__cancel-form">
									<select bind:value={selectedCancelReason} class="job-details-modal__cancel-select">
										<option value="">Select cancel reason...</option>
										{#each cancelReasons as reason (reason)}
											<option value={reason}>{reason}</option>
										{/each}
									</select>
									<textarea
										bind:value={cancelNotesInput}
										class="job-details-modal__cancel-notes"
										placeholder="Optional notes (e.g. customer request, weather, etc.)"
										rows="2"
									></textarea>
									<div class="job-details-modal__cancel-actions">
										<button
											class="job-details-modal__btn job-details-modal__btn--small job-details-modal__btn--cancel-confirm"
											onclick={confirmCancelJob}
											disabled={!selectedCancelReason}
										>
											Confirm cancel
										</button>
										<button
											class="job-details-modal__btn job-details-modal__btn--small"
											onclick={() => {
												showCancelForm = false;
												selectedCancelReason = '';
												cancelNotesInput = '';
											}}
										>
											Dismiss
										</button>
									</div>
								</div>
							{/if}
						</section>

						<div class="job-details-modal__footer job-details-modal__footer--job sticky-footer">
							<button
								class="job-details-modal__btn job-details-modal__btn--edit"
								onclick={editJob}
							>
								Edit job
							</button>
							<button class="job-details-modal__btn" onclick={jumpToCalendar}>Calendar</button>
						</div>
					{:else}
						<section class="job-details-modal__section job-details-modal__section--invoice">
							<InvoiceEditor
								bind:job
								bind:invoice
								onClose={closeModal}
								onEditJob={editJob}
								onStatusChange={(newInv) => {
									invoice = newInv;
								}}
							/>
						</section>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* JobDetailsModal standardized to design tokens + BEM. Base classes (.button, etc.) used in markup where possible.
	   Hardcoded colors and sizes replaced with vars and --space-* scale for full cohesion with the rest of the app. */

	/* Base job-details-modal shell now from global .modal-overlay + .modal-content for cohesion. */

	.job-details-modal__loading,
	.job-details-modal__empty {
		padding: var(--space-8) var(--space-4);
		text-align: center;
		color: var(--color-text-muted);
	}

	.job-details-modal__header {
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.job-details-modal__header-top {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.job-details-modal__header-main {
		flex: 1;
		min-width: 0;
	}

	.job-details-modal__title {
		margin: 0;
		font-size: var(--font-size-lg);
		font-weight: var(--font-weight-bold);
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.job-details-modal__context {
		font-size: var(--font-size-xs);
		color: var(--color-primary);
		margin-top: var(--space-1);
	}

	.job-details-modal__header-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		margin: var(--space-1) 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.4;
	}

	.job-details-modal__header-amount {
		color: var(--color-text);
	}

	.job-details-modal__meta-sep {
		opacity: 0.5;
	}

	.job-details-modal__close-btn {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}

	.job-details-modal__close-btn:hover {
		background: var(--color-surface-alt);
		color: var(--color-text);
	}

	.job-details-modal__status {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.6rem;
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
	}
	.job-details-modal__status--draft { background: var(--color-warning-soft); color: var(--color-warning); }
	.job-details-modal__status--generated { background: var(--color-primary-soft); color: var(--color-primary-emphasis); }
	.job-details-modal__status--sent { background: var(--color-success-soft); color: var(--color-success); }
	.job-details-modal__status--paid { background: var(--color-success-soft); color: var(--color-success); }
	.job-details-modal__overdue {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		font-size: var(--font-size-xs);
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-full);
	}

	.job-details-modal__tabs {
		display: flex;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.job-details-modal__tab {
		flex: 1;
		padding: var(--space-2) var(--space-4);
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}

	.job-details-modal__tab:hover {
		color: var(--color-text);
		background: var(--color-surface-alt);
	}

	.job-details-modal__tab--active {
		color: var(--color-primary-emphasis);
		border-bottom-color: var(--color-primary);
		background: var(--color-surface-alt);
	}

	.job-details-modal__body {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}

	.job-details-modal__content {
		display: flex;
		flex-direction: column;
		max-height: min(92vh, 900px);
		overflow: hidden;
	}

	.job-details-modal__section {
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.job-details-modal__section--invoice {
		padding: var(--space-3);
		border-bottom: none;
	}

	.job-details-modal__job-actions {
		border-bottom: none;
	}

	.job-details-modal__action-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.job-details-modal__section-title {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-2);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.job-details-modal__meta {
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.job-details-modal__crew {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.job-details-modal__crew-pill {
		background: var(--color-surface-alt);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		font-size: var(--font-size-sm);
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.job-details-modal__crew-avatar {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid var(--color-border);
	}
	.job-details-modal__crew-initial {
		font-size: 0.6rem;
		font-weight: var(--font-weight-semibold);
	}

	@media (max-width: 768px) {
		.job-details-modal__section {
			padding: var(--space-3);
		}

		.job-details-modal__section--invoice {
			padding: var(--space-2);
		}

		.job-details-modal__tab {
			padding: var(--space-2) var(--space-3);
			font-size: var(--font-size-xs);
		}

		.job-details-modal__header {
			padding: var(--space-2) var(--space-3);
		}

		.job-details-modal__title {
			font-size: var(--font-size-base);
		}

		.job-details-modal__footer--job {
			padding: var(--space-2) var(--space-3);
		}
	}

	.job-details-modal__empty-text {
		color: var(--color-text-subtle);
		font-size: var(--font-size-sm);
	}

	.job-details-modal__notes {
		white-space: pre-wrap;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.job-details-modal__cancel {
		color: var(--color-danger-emphasis);
		font-size: var(--font-size-sm);
		margin-top: var(--space-2);
	}

	.job-details-modal__footer {
		display: flex;
		gap: var(--space-2);
	}

	.job-details-modal__footer--job {
		padding: var(--space-2) var(--space-4);
	}

	.job-details-modal__footer--job .job-details-modal__btn {
		flex: 1;
	}

	.job-details-modal__btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}

	.job-details-modal__btn--primary {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.job-details-modal__btn--edit {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		border-color: var(--color-primary);
	}

	.job-details-modal__btn--close {
		background: var(--color-surface-alt);
	}

	.job-details-modal__btn--primary {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.job-details-modal__btn--small {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.5rem;
	}

	/* Cancel form uses tokens */
	.job-details-modal__cancel-form {
		margin-top: var(--space-3);
		padding: var(--space-3);
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.job-details-modal__cancel-select,
	.job-details-modal__cancel-notes {
		width: 100%;
		margin-bottom: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-sm);
		background: var(--color-surface);
	}
	.job-details-modal__cancel-actions {
		display: flex;
		gap: var(--space-2);
	}
	.job-details-modal__btn--cancel {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border-color: var(--color-danger);
	}
	.job-details-modal__btn--cancel-confirm {
		background: var(--color-danger-emphasis);
		color: white;
		border-color: var(--color-danger-emphasis);
	}
	.job-details-modal__btn--cancel-confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Supporting documents list (invoice-related). Mobile bottom-sheet friendly. */
	.job-details-modal__docs {
		list-style: none;
		padding: 0;
		margin: 0 0 var(--space-2);
		font-size: var(--font-size-xs);
	}
	.job-details-modal__docs li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		border-bottom: 1px dotted var(--color-border);
	}
	.job-details-modal__docs li:last-child {
		border-bottom: none;
	}

	.job-details-modal__not-available {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.job-details-modal__offline-note {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}

	/* Mobile tweaks for invoice/supporting sections inside bottom sheet */
	@media (max-width: 768px) {
		.job-details-modal__docs {
			font-size: var(--font-size-xs);
		}
		.job-details-modal__docs li {
			flex-wrap: wrap;
			gap: var(--space-1);
		}
		.job-details-modal__small-btn {
			font-size: var(--font-size-xs);
			padding: 0.1rem 0.4rem;
			color: var(--color-text);
			background: var(--color-surface);
			border: 1px solid var(--color-border-strong);
		}
	}
</style>
