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
			const loadLocal = () =>
				import('$lib/db').then(({ db }) =>
					db.users.toArray().then((us: any[]) => {
						users = us;
					})
				);
			loadLocal();
			if (auth.currentUser?.role === 'admin' && navigator.onLine) {
				pullUsersFromServer().then(loadLocal); // re-load after pull completes for fresh data in this modal instance
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
	<div class="job-details-modal" onclick={closeModal}>
		<div class="job-details-modal__content" onclick={(e) => e.stopPropagation()}>
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
						<div style="color: {area?.color || '#64748b'};">
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
				<div class="job-details-modal__footer">
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
	/* BEM naming strictly followed as required by AGENTS.md */
	.job-details-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1100;
	}

	.job-details-modal__content {
		background: white;
		width: 100%;
		max-width: 560px;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
		max-height: 92vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}

	.job-details-modal__loading,
	.job-details-modal__empty {
		padding: 3rem 1rem;
		text-align: center;
		color: #64748b;
	}

	.job-details-modal__header {
		padding: 1.25rem 1rem 0.75rem;
		border-bottom: 1px solid #e2e8f0;
	}

	.job-details-modal__title {
		margin: 0 0 0.25rem;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.job-details-modal__context {
		font-size: 0.85rem;
		color: #0369a1;
		margin-bottom: 0.5rem;
	}

	.job-details-modal__badges {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}

	.job-details-modal__status {
		font-size: 0.7rem;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		font-weight: 600;
		text-transform: uppercase;
	}
	.job-details-modal__status--draft {
		background: #fef3c7;
		color: #92400e;
	}
	.job-details-modal__status--generated {
		background: #dbeafe;
		color: #1e40af;
	}
	.job-details-modal__status--sent {
		background: #d1fae5;
		color: #166534;
	}
	.job-details-modal__status--paid {
		background: #a7f3d0;
		color: #065f46;
	}
	.job-details-modal__overdue {
		background: #fee2e2;
		color: #991b1b;
		font-size: 0.65rem;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
	}

	.job-details-modal__totals {
		padding: 0.75rem 1rem;
		background: #f8fafc;
		font-size: 1.1rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.job-details-modal__section {
		padding: 1rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.job-details-modal__section-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #475569;
		margin: 0 0 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.job-details-modal__meta {
		font-size: 0.95rem;
		color: #334155;
	}

	.job-details-modal__crew {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.job-details-modal__crew-pill {
		background: #f1f5f9;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.8rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.job-details-modal__crew-avatar {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid #e2e8f0;
	}
	.job-details-modal__crew-initial {
		font-size: 0.6rem;
		font-weight: 600;
	}

	.job-details-modal__billables {
		margin-bottom: 0.75rem;
	}

	.job-details-modal__billable-row {
		display: flex;
		justify-content: space-between;
		font-size: 0.9rem;
		padding: 0.25rem 0;
		border-bottom: 1px dotted #e2e8f0;
	}

	.job-details-modal__empty-text {
		color: #94a3b8;
		font-size: 0.9rem;
	}

	.job-details-modal__invoice-meta {
		margin-bottom: 0.5rem;
		font-size: 0.95rem;
	}

	.job-details-modal__invoice-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.job-details-modal__notes {
		white-space: pre-wrap;
		font-size: 0.9rem;
		color: #475569;
	}

	.job-details-modal__cancel {
		color: #b91c1c;
		font-size: 0.85rem;
		margin-top: 0.5rem;
	}

	.job-details-modal__footer {
		padding: 1rem;
		border-top: 1px solid #e2e8f0;
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		background: white;
		position: sticky;
		bottom: 0;
	}

	.job-details-modal__footer-left {
		display: flex;
		gap: 0.5rem;
	}

	.job-details-modal__btn {
		padding: 0.55rem 1rem;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 500;
		border: 1px solid #cbd5e1;
		background: white;
		cursor: pointer;
	}

	.job-details-modal__btn--primary {
		background: #3b82f6;
		color: white;
		border-color: #3b82f6;
	}

	.job-details-modal__btn--edit {
		background: #e0f2fe;
		color: #0369a1;
		border-color: #bae6fd;
	}

	.job-details-modal__btn--draft {
		width: 100%;
		margin-top: 0.5rem;
		background: #fef3c7;
		color: #92400e;
		border-color: #fde68c;
	}

	.job-details-modal__btn--close {
		background: #f1f5f9;
	}

	.job-details-modal__btn--small {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
	}

	.job-details-modal__upload-hint {
		font-size: 0.8rem;
		color: #64748b;
		margin-top: 0.25rem;
	}

	/* )=- BEM for Phase 7 offline file messaging on supporting docs.
	   .not-available for inline per-file note when !pbId.
	   .offline-note for the explanatory paragraph (matches spec "File not available offline").
	   Small button reuses the existing --small style for download actions when available. */
	.job-details-modal__not-available {
		font-size: 0.65rem;
		color: #94a3b8;
		font-style: italic;
		margin-left: 0.4rem;
	}
	.job-details-modal__offline-note {
		font-size: 0.75rem;
		color: #64748b;
		margin-top: 0.4rem;
		font-style: italic;
	}
	.job-details-modal__small-btn {
		font-size: 0.65rem;
		padding: 0.1rem 0.35rem;
		margin-left: 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 3px;
		background: white;
		cursor: pointer;
	}

	/* )=- BEM for cancel form (Phase 7). Simple stacked layout for reason select + notes + actions.
	   Reuses small-btn pattern; cancel buttons get red tint for destructive action.
	   )=- Reference: JOBS_AND_INVOICES_SPEC.md Phase 7 + Remedine/Svelte_FullCalendar_Dexie_Scheduling */
	.job-details-modal__cancel-form {
		padding: 0.75rem 1rem;
		background: #f8fafc;
		border-top: 1px solid #e2e8f0;
		border-bottom: 1px solid #e2e8f0;
	}
	.job-details-modal__cancel-select,
	.job-details-modal__cancel-notes {
		width: 100%;
		margin-bottom: 0.5rem;
		padding: 0.35rem;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		font-size: 0.85rem;
	}
	.job-details-modal__cancel-actions {
		display: flex;
		gap: 0.5rem;
	}
	.job-details-modal__btn--cancel {
		background: #fee2e2;
		color: #991b1b;
		border-color: #fecaca;
	}
	.job-details-modal__btn--cancel-confirm {
		background: #991b1b;
		color: white;
		border-color: #991b1b;
	}
	.job-details-modal__btn--cancel-confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
