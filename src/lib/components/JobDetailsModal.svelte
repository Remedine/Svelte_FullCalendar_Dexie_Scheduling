<!-- src/lib/components/JobDetailsModal.svelte -->
<script module>
	import { type Job, type Invoice } from '$lib/db';

	let modalInstance: {
		open: (
			jobOrId: string | Job,
			context?: { fromClientId?: string; fromClientName?: string }
		) => void;
	} | null = null;

	export function openJobDetailsModal(
		jobOrId: string | Job,
		context?: { fromClientId?: string; fromClientName?: string }
	) {
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
		getInvoiceForJob,
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
	import { optionsStore } from '$lib/stores/options.svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';
	import JobInvoicePanel from './JobInvoicePanel.svelte';

	// )=- Module-level singleton so any page can call openJobDetailsModal(job) without prop drilling.
	// Mirrors the proven pattern from JobFormModal.
	// Reference: JOBS_AND_INVOICES_SPEC.md (Phase 3) + Remedine/Svelte_FullCalendar_Dexie_Scheduling

	let show = $state(false);
	let loading = $state(true);
	let job = $state<Job | null>(null);
	let invoice = $state<Invoice | null>(null);
	let clientContext = $state<{ fromClientId?: string; fromClientName?: string } | null>(null);
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

	// Register singleton (runes only, no onMount)
	$effect(() => {
		modalInstance = {
			open: async (
				jobOrId: string | Job,
				ctx?: { fromClientId?: string; fromClientName?: string }
			) => {
				clientContext = ctx || null;
				loading = true;
				show = true;

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

						invoice = (await getInvoiceForJob(job.id!)) || null;

						if (auth.currentUser?.role === 'admin' && navigator.onLine) {
							// )=- Import + call added to fix "pullInvoicesFromServer is not defined" ReferenceError on modal open (log: JobDetailsModal.svelte:65).
							// Pull ensures fresh invoice data (incl. newly generated primary files) before showing billing panel.
							// Guard matches users pull and jobs page refresh. Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md Phase 3/4
							await pullInvoicesFromServer();
							invoice = (await getInvoiceForJob(job.id!)) || null;
						}

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
				if (freshJob) {
					openJobDetailsModal(freshJob, clientContext || undefined);
				} else {
					openJobDetailsModal(currentJob.id, clientContext || undefined);
				}
			}
		});
	}

	function jumpToCalendar() {
		if (!job) return;
		// )=- Jump to the split calendar (the richer view with job list) and pass ?date so SplitCalendar
		// picks it up for initialDate / gotoDate. Closes the modal for clean UX.
		// Reference: JOBS_AND_INVOICES_SPEC.md (calendar jump in Phase 7)
		const date = new Date(job.start).toISOString().split('T')[0];
		goto(`/calendar/split?date=${date}`);
		closeModal();
	}

	// )=- Download a supporting document when the invoice has been synced (pbId present).
	// Mirrors downloadPrimary in the panel. Uses pb.files.getURL.
	// When !pbId the UI already shows "not available offline" (Phase 7 messaging).
	// )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 4/7 + Remedine/Svelte_FullCalendar_Dexie_Scheduling
	function downloadSupporting(doc: { filename: string; type?: string }) {
		if (!invoice?.pbId || !doc.filename) return;
		const record = {
			id: invoice.pbId,
			collectionName: 'invoices'
		};
		const url = pb.files.getURL(record, doc.filename);
		const a = document.createElement('a');
		a.href = url;
		a.download = doc.filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
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
			const freshInv = await getInvoiceForJob(job.id);
			if (freshInv) invoice = freshInv;
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
				<!-- Header -->
				<div class="job-details-modal__header">
					<div>
						<h2 class="job-details-modal__title">{job.title || 'Untitled Job'}</h2>
						{#if clientContext?.fromClientName}
							<!-- )=- Client context indicator as chosen in spec. Keeps the user oriented when opened from the clients page expandable list. -->
							<div class="job-details-modal__context">
								Related to <strong>{clientContext.fromClientName}</strong>
							</div>
						{/if}
					</div>

					<div class="job-details-modal__badges">
						<span class={jobStatusClass}>{job.status}</span>
						<span class="job-details-modal__status job-details-modal__status--{invoiceStatus}">
							{invoice ? invoice.status : 'no invoice'}
						</span>
						{#if isOverdue}
							<span class="job-details-modal__overdue">OVERDUE</span>
						{/if}
						<!-- )=- Per spec: Mark complete marks job complete + generates invoice for review.
						     Button appears if not yet completed. Sets status, then user can immediately use the
						     Generate button in the Billing/Invoice panel below (which will use 'generated' status).
						     Reference: JOBS_AND_INVOICES_SPEC.md -->
						<!-- )=- Context-aware single button for job status per user request. Scheduled shows "Mark Complete" (with start-time guard). Completed shows "Revert to Scheduled". Confirmed status removed from this UI as not needed. Guard prevents completing before start time. -->
						{#if job.status === 'completed'}
							<button
								class="job-details-modal__btn job-details-modal__btn--small"
								onclick={() => quickUpdateJobStatus('scheduled')}
							>
								Revert to Scheduled
							</button>
						{:else}
							<button
								class="job-details-modal__btn job-details-modal__btn--small"
								onclick={() => quickUpdateJobStatus('completed')}
								disabled={new Date() < new Date(job.start)}
							>
								Mark Complete
							</button>
						{/if}

						<!-- )=- Cancel flow from details (Phase 7 "if needed"). Only for non-cancelled jobs.
						     Toggles inline form using options.cancelReasons + notes (same data as JobFormModal cancel).
						     On confirm calls cancelJob which sets all the cancel* fields + status.
						     )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 + Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
						{#if job.status !== 'cancelled' && job.status !== 'completed'}
							<button
								class="job-details-modal__btn job-details-modal__btn--small job-details-modal__btn--cancel"
								onclick={() => (showCancelForm = !showCancelForm)}
							>
								{showCancelForm ? 'Hide Cancel' : 'Cancel'}
							</button>
						{/if}
					</div>

					<!-- )=- Inline cancel form (BEM). Appears when Cancel toggled.
					     Select from cancelReasons (required), optional notes textarea.
					     Buttons to confirm (calls cancelJob) or dismiss.
					     On success form hides and job reloads (cancel info appears in Notes section below). -->
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
									Confirm Cancel
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
				</div>

				<div class="job-details-modal__totals">
					<strong>${job.totalAmount?.toFixed(2) || '0.00'}</strong>
					{#if invoice}
						<span class="job-details-modal__due">
							Due: {new Date(invoice.dueDate).toLocaleDateString()}
						</span>
					{/if}
				</div>

				<!-- Client / Area -->
				<section class="job-details-modal__section">
					<h3 class="job-details-modal__section-title">Client &amp; Location</h3>
					<div class="job-details-modal__meta">
						<!-- )=- Now resolves full client (via clientId/pbId) for name + address display (Phase 4+ polish). Falls back to ID if not found. Area uses options for label + color. -->
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

				<!-- Schedule -->
				<section class="job-details-modal__section">
					<h3 class="job-details-modal__section-title">Schedule</h3>
					<div class="job-details-modal__meta">
						<div>Start: {new Date(job.start).toLocaleString()}</div>
						<div>End: {new Date(job.end).toLocaleString()}</div>
					</div>
				</section>

				<!-- Crew (with avatars, consistent with jobs cards and calendar) -->
				<section class="job-details-modal__section">
					<h3 class="job-details-modal__section-title">Assigned Crew</h3>
					<div class="job-details-modal__crew">
						<!-- )=- Guard for legacy jobs (assignedCrew may be undefined/null from old imports). 'imperfection allowed' requirement.
						     )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 + Phase 10 -->
						{#each job.assignedCrew || [] as crewName}
							{@const u = users.find((uu) => uu.name === crewName)}
							<span class="job-details-modal__crew-pill" title={crewName}>
								{#if u?.photo}
									<!-- )=- Use central helper for normalization. -->
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

				<!-- Billing Items + Invoice Panel (Generate Draft lives under Billing per spec) -->
				<section class="job-details-modal__section">
					<h3 class="job-details-modal__section-title">Billable Items</h3>
					<div class="job-details-modal__billables">
						{#each job.billableItems || [] as item, i (i)}
							<div class="job-details-modal__billable-row">
								<span>{item.title || 'Item'}</span>
								<span>${(item.total || 0).toFixed(2)} × {item.quantity}</span>
							</div>
						{:else}
							<div class="job-details-modal__empty-text">No billable items</div>
						{/each}
					</div>

					<!-- )=- JobInvoicePanel is rendered directly under Billing Items (as decided in planning).
					     It contains the real Generate Draft (Phase 4 generator + file persistence) and revised upload. -->
					<JobInvoicePanel
						bind:job
						bind:invoice
						onStatusChange={(newInv) => {
							// )=- Pure state lift for the header badges (status, overdue, due date) and the "Mark Complete" flow.
							// All actual persistence (status changes, regenerate, paidAt edit, supporting add) now lives inside
							// JobInvoicePanel so we never double-queue updateInvoice calls (which was causing the repeated
							// "Invoice updated in PocketBase" + "Synced update" spam in the logs after every status or regen action).
							// The previous always-on update here was firing after the panel's own updateInvoice for files/status/paid.
							// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
							invoice = newInv;
						}}
					/>
				</section>

				<!-- Notes -->
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

				<!-- )=- Supporting documents (per spec Phase 4/10 for legacy + uploads + Phase 7 offline messaging).
				     - When pbId present: show filenames + small "Download" buttons using pb.files.getURL (same pattern as primary in panel).
				     - When no pbId (offline or not yet synced to server): show clear "Not available offline" message + note.
				     Files are never cached as blobs in Dexie for invoices (only metadata). This fulfills "Offline file messaging".
				     )=- Reference: JOBS_AND_INVOICES_SPEC.md + Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
				{#if invoice?.supportingDocuments?.length}
					<section class="job-details-modal__section">
						<h3 class="job-details-modal__section-title">Supporting Documents</h3>
						<ul class="job-details-modal__docs">
							{#each invoice.supportingDocuments as doc}
								<li>
									{doc.filename}
									{doc.type ? `(${doc.type})` : ''}
									{#if invoice.pbId}
										<button
											class="job-details-modal__small-btn"
											onclick={() => downloadSupporting(doc)}>Download</button
										>
									{:else}
										<span class="job-details-modal__not-available">not available offline</span>
									{/if}
								</li>
							{/each}
						</ul>
						{#if !invoice.pbId}
							<p class="job-details-modal__offline-note">
								Supporting documents are stored on the server and are not available while offline or
								before the first successful sync.
							</p>
						{/if}
					</section>
				{/if}

				<!-- Footer Actions -->
				<div class="job-details-modal__footer sticky-footer">
					<div class="job-details-modal__footer-left">
						<button class="job-details-modal__btn job-details-modal__btn--edit" onclick={editJob}>
							Edit full job
						</button>
						<button class="job-details-modal__btn" onclick={jumpToCalendar}>
							View on calendar
						</button>
					</div>

					<button class="job-details-modal__btn job-details-modal__btn--close" onclick={closeModal}>
						Close
					</button>
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
		padding: var(--space-5) var(--space-4) var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}

	.job-details-modal__title {
		margin: 0 0 var(--space-1);
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-bold);
	}

	.job-details-modal__context {
		font-size: var(--font-size-sm);
		color: var(--color-primary);
		margin-bottom: var(--space-2);
	}

	.job-details-modal__badges {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
		flex-wrap: wrap;
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

	.job-details-modal__totals {
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-alt);
		font-size: var(--font-size-lg);
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.job-details-modal__section {
		padding: var(--space-4);
		border-bottom: 1px solid var(--color-border);
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

	.job-details-modal__billables {
		margin-bottom: var(--space-3);
	}

	.job-details-modal__billable-row {
		display: flex;
		justify-content: space-between;
		font-size: var(--font-size-sm);
		padding: var(--space-1) 0;
		border-bottom: 1px dotted var(--color-border);
	}

	/* Mobile bottom-sheet refinements for billing/invoice area (tighter spacing, full use of width). */
	@media (max-width: 768px) {
		.job-details-modal__section {
			padding: var(--space-3);
		}
		.job-details-modal__billables {
			margin-bottom: var(--space-2);
		}
		.job-details-modal__billable-row {
			font-size: var(--font-size-xs);
			padding: 0.05rem 0;
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
		/* base from global .sticky-footer */
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
	}

	.job-details-modal__footer-left {
		display: flex;
		gap: var(--space-2);
	}

	.job-details-modal__btn {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
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

	.job-details-modal__btn--small {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.5rem;
	}

	/* Cancel form uses tokens */
	.job-details-modal__cancel-form {
		padding: var(--space-3) var(--space-4);
		background: var(--color-surface-alt);
		border-top: 1px solid var(--color-border);
		border-bottom: 1px solid var(--color-border);
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
		}
	}
</style>
