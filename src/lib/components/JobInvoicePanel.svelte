<!-- src/lib/components/JobInvoicePanel.svelte -->
<!-- 
)= - Reusable invoice panel extracted as requested during planning.
   Lives under the Billing Items section in JobDetailsModal (and can be reused elsewhere later).
   Handles:
     - Generate Draft (calls generateInvoiceDocx, downloads via file-saver, then persists via createInvoice with file blob)
     - Re-upload of edited .docx (file input → Blob → updateInvoice with files param)
     - Status display + quick transitions (delegated to parent or direct)
   Uses the new Phase 4 generate helper + the files support we added to createInvoice/updateInvoice in Phase 2.
   BEM + runes + TypeScript per AGENTS.md.
   Reference: JOBS_AND_INVOICES_SPEC.md (Phase 4)
-->
<script lang="ts">
	import { db, type Job, type Invoice, type Client, createInvoice, updateInvoice, generateInvoiceDocx } from '$lib/db';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { saveAs } from 'file-saver';
	import { pb } from '$lib/db/pb';

	let {
		job = $bindable<Job | null>(null),
		invoice = $bindable<Invoice | null>(null),
		onStatusChange = (newInvoice: Invoice) => {},
	} = $props();

	let isGenerating = $state(false);
	let isUploading = $state(false);

	// )=- Date input helpers to avoid the classic <input type="date"> + JS Date timezone shift bug.
	// The browser date picker gives "YYYY-MM-DD" (local calendar date, no time).
	// new Date('2026-07-10') is interpreted as UTC midnight in most browsers → can become July 9th in local time
	// (e.g. for UTC-5 or during DST). toISOString().slice(0,10) on a local Date can also shift the day.
	// We use local component getters + new Date(year, monthIndex, day) to keep the intended calendar day.
	// This fixes the reported discrepancy where picker shows 07/10 but display shows 07/09 for dueDate (and same for paidAt).
	// Applied to both due date override and paid date editing.
	// )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling + JOBS_AND_INVOICES_SPEC.md (dueDate / paidAt on Invoice)
	function dateToInputValue(d: Date | string | undefined | null): string {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	function inputValueToDate(val: string): Date | undefined {
		if (!val) return undefined;
		const [y, m, d] = val.split('-').map(Number);
		if (!y || !m || !d) return undefined;
		// Construct as local date at midnight (no UTC conversion)
		return new Date(y, m - 1, d);
	}

	async function handleGenerateDraft() {
		if (!job) return;
		isGenerating = true;

		try {
			await optionsStore.load?.();
			const client = job.clientId ? await db.clients.get(job.clientId) : null;

			const blob = await generateInvoiceDocx(job, client, {
				taxRate: optionsStore.data?.taxRate,
				invoiceDueDays: optionsStore.data?.invoiceDueDays,
			});

			// Immediate download for the user (editable .docx)
			const filename = `${(job.title || 'invoice').replace(/[^a-z0-9]/gi, '_')}.docx`;
			saveAs(blob, filename);

			// Persist to our system (metadata + the actual file blob via the files param we built in Phase 2)
			// This will go through createInvoice → queue → PB with FormData file upload.
			const newInvoiceId = await createInvoice(
				{
					jobId: job.id,
					clientId: job.clientId,
					status: job.status === 'completed' ? 'generated' : 'draft',
					amount: job.totalAmount,
					billableItems: job.billableItems,
					notes: job.notes,
					importSource: job.importSource,
				},
				{
					primary: { blob, filename }
				}
			);

			// Refresh local invoice state for the parent modal
			const fresh = await db.invoices.get(newInvoiceId);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
		} catch (err) {
			console.error('Failed to generate invoice', err);
			alert('Failed to generate invoice. See console for details.');
		} finally {
			isGenerating = false;
		}
	}

	async function handleRevisedUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.length || !job || !invoice) return;

		isUploading = true;
		const file = input.files[0];
		const blob = file; // already a Blob/File

		try {
			// Update the existing invoice record with the new file.
			// The _files mechanism + FormData in sync will replace the primary file in PB.
			await updateInvoice(
				invoice.id!,
				{
					updatedAt: new Date()
				},
				{
					primary: { blob, filename: file.name }
				}
			);

			// Refresh
			const fresh = await db.invoices.get(invoice.id!);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
		} catch (err) {
			console.error('Failed to upload revised invoice', err);
			alert('Upload failed. Check console.');
		} finally {
			isUploading = false;
			input.value = ''; // allow re-select same file
		}
	}

	async function handleQuickStatus(newStatus: Invoice['status']) {
		if (!invoice || !invoice.id) return;
		// )=- Now performs the actual persistence (like regenerate, revised upload, and editPaidAt do).
		// Previously the parent modal's onStatusChange was blindly calling updateInvoice for every notification,
		// causing double (or more) queue items + repeated PB updates + the spam of "updated in PocketBase" / "Synced update" logs
		// the user saw after every status transition or regenerate.
		// With bind:invoice + onStatusChange we still lift the fresh state for the modal header badges/overdue/due.
		// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
		const patch: Partial<Invoice> = { status: newStatus };
		if (newStatus === 'paid' && !invoice.paidAt) {
			patch.paidAt = new Date();
		}
		try {
			await updateInvoice(invoice.id, patch);
			const fresh = await db.invoices.get(invoice.id);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
		} catch (err) {
			console.error('Failed to update invoice status', err);
			alert('Failed to update status. See console.');
		}
	}

	// )=- Download/open the existing primary invoice .docx from PB when one has been generated.
	// Uses the pbId from the Dexie invoice record (populated after sync) to build the file URL via pb.files.getURL.
	// Triggers a direct download so user can open/edit the .docx in Word/etc.
	async function downloadPrimary() {
		if (!invoice?.pbId || !invoice.primaryInvoiceFile?.filename) {
			// )=- Guard kept (defensive). The UI now hides the Open button + shows "syncing…" instead of alert (better UX right after generate before queue roundtrip).
			console.info('Open invoice requested before pbId stamped (still syncing).');
			return;
		}
		const record = {
			id: invoice.pbId,
			collectionName: 'invoices'
		};
		const url = pb.files.getURL(record, invoice.primaryInvoiceFile.filename);
		const a = document.createElement('a');
		a.href = url;
		a.download = invoice.primaryInvoiceFile.filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	// )=- Regenerate the primary .docx using current job data (for when billables or details changed after initial generate).
	// Downloads fresh copy and updates the primaryInvoiceFile on the existing invoice record (via _files in update).
	async function handleRegenerate() {
		if (!job || !invoice) return;
		isGenerating = true;
		try {
			await optionsStore.load?.();
			const client = job.clientId ? await db.clients.get(job.clientId) : null;
			const blob = await generateInvoiceDocx(job, client, {
				taxRate: optionsStore.data?.taxRate,
				invoiceDueDays: optionsStore.data?.invoiceDueDays,
			});
			const filename = `${(job.title || 'invoice').replace(/[^a-z0-9]/gi, '_')}.docx`;
			saveAs(blob, filename);
			await updateInvoice(
				invoice.id!,
				{ updatedAt: new Date() },
				{ primary: { blob, filename } }
			);
			const fresh = await db.invoices.get(invoice.id!);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
		} catch (err) {
			console.error('Failed to regenerate invoice', err);
			alert('Failed to regenerate invoice. See console for details.');
		} finally {
			isGenerating = false;
		}
	}

	// )=- Edit the paidAt date directly (for corrections). Updates via updateInvoice and refreshes bound state.
	async function handleEditPaidAt(e: Event) {
		if (!invoice) return;
		const input = e.target as HTMLInputElement;
		const val = input.value;
		// )=- Use inputValueToDate (instead of new Date(val)) to prevent the same local vs UTC date shift bug
		// that was causing the due date picker (07/10) vs displayed (07/09) discrepancy.
		const paidAt = inputValueToDate(val);
		try {
			await updateInvoice(invoice.id!, { paidAt, updatedAt: new Date() });
			const fresh = await db.invoices.get(invoice.id!);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
		} catch (err) {
			console.error('Failed to edit paid date', err);
			alert('Failed to update paid date.');
		}
	}

	// )=- Edit the dueDate directly (user override for the due date that was originally computed from job.end + options.invoiceDueDays).
	// Updates via updateInvoice (which queues the change + persists to PB on sync).
	// Refreshes the bound invoice so the modal header "Due:" display and any other UI updates immediately.
	// This fulfills the request to "be able to override the due date put in a new due date".
	// )=- Reference: JOBS_AND_INVOICES_SPEC.md (dueDate on Invoice, set at generation but now overridable) + Remedine/Svelte_FullCalendar_Dexie_Scheduling
	async function handleEditDueDate(e: Event) {
		if (!invoice) return;
		const input = e.target as HTMLInputElement;
		const val = input.value;
		// )=- Use inputValueToDate to create a true local calendar date instead of new Date(val) (which treats YYYY-MM-DD as UTC).
		// This ensures the stored dueDate matches exactly what the user picked in the browser's date picker.
		const dueDate = inputValueToDate(val) ?? invoice.dueDate;
		try {
			await updateInvoice(invoice.id!, { dueDate, updatedAt: new Date() });
			const fresh = await db.invoices.get(invoice.id!);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
		} catch (err) {
			console.error('Failed to edit due date', err);
			alert('Failed to update due date.');
		}
	}

	// )=- Add (append) supporting documents (scans, photos, exports, etc.) for the invoice.
	// Uses the same files mechanism; updateInvoice now appends to the supportingDocuments metadata list (see index.ts).
	// Only the new blobs are sent in this batch to the queue/FormData. Existing files on PB are preserved.
	// After success we refresh the bound invoice so the modal's "Supporting Documents" list (and any future UI) sees the new entries.
	// Per JOBS_AND_INVOICES_SPEC.md Phase 4/10 (supporting docs for legacy + manual adds).
	async function handleAddSupporting(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.length || !invoice?.id) return;

		isUploading = true;
		const newFiles = Array.from(input.files).map((file) => ({
			blob: file,
			filename: file.name,
			type: file.type || 'application/octet-stream'
		}));

		try {
			await updateInvoice(
				invoice.id,
				{ updatedAt: new Date() },
				{ supporting: newFiles }
			);
			const fresh = await db.invoices.get(invoice.id);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
		} catch (err) {
			console.error('Failed to add supporting documents', err);
			alert('Failed to add supporting documents. See console.');
		} finally {
			isUploading = false;
			input.value = ''; // allow selecting the same files again later
		}
	}
</script>

<div class="job-invoice-panel">
	{#if invoice}
		<div class="job-invoice-panel__status">
			<span class="job-invoice-panel__status-badge job-invoice-panel__status-badge--{invoice.status}">
				{invoice.status}
			</span>
			{#if invoice}
				<button class="job-invoice-panel__small-btn" onclick={handleRegenerate} disabled={isGenerating}>Regenerate</button>
				<!-- )=- Due date override UI. Always available for an existing invoice so user can adjust the due date that was set at generation time.
				     Uses the same pattern as the paid date editor. BEM class for styling. -->
				<span class="job-invoice-panel__due-edit">
					Due on: 
					<input 
						type="date" 
						value={dateToInputValue(invoice.dueDate)} 
						onchange={handleEditDueDate} 
					/>
				</span>
			{/if}
			{#if invoice.status === 'generated'}
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('sent')}>Mark Sent</button>
			{:else if invoice.status === 'sent'}
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('generated')}>Set Unsent</button>
				<button class="job-invoice-panel__small-btn job-invoice-panel__small-btn--primary" onclick={() => handleQuickStatus('paid')}>Mark Paid</button>
			{:else if invoice.status === 'paid'}
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('generated')}>Set Unsent</button>
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('sent')}>Mark Unpaid</button>
				<span class="job-invoice-panel__paid-edit">
					Paid on: 
					<input 
						type="date" 
						value={dateToInputValue(invoice.paidAt)} 
						onchange={handleEditPaidAt} 
					/>
				</span>
			{/if}
		</div>

		<div class="job-invoice-panel__file-row">
			{#if invoice.primaryInvoiceFile?.filename}
				<span class="job-invoice-panel__filename">{invoice.primaryInvoiceFile.filename}</span>
				{#if invoice.pbId}
					<!-- )=- Open uses pb.files.getURL on the server record (after queue stamped pbId). Per spec "there needs to be a way to open it" once generated. -->
					<button class="job-invoice-panel__small-btn" onclick={downloadPrimary}>Open</button>
				{:else}
					<!-- )=- Per JOBS_AND_INVOICES_SPEC.md Phase 7: clear offline / not-yet-synced messaging for primary file.
					     Files live only on PB (no local blobs for invoices except avatars). Show explicit message instead of silent fail or vague "syncing".
					     "syncing…" kept only for the very brief post-generate optimistic window before queue processes. -->
					<span class="job-invoice-panel__sync-hint">not available offline (pending sync)</span>
				{/if}
			{/if}
			<label class="job-invoice-panel__upload-label">
				<input 
					type="file" 
					accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
					onchange={handleRevisedUpload}
					disabled={isUploading}
				/>
				{isUploading ? 'Uploading…' : 'Upload revised .docx'}
			</label>
		</div>

		<!-- )=- Supporting documents upload (additive). Multiple files allowed. Appends to existing list both in Dexie metadata (optimistic) and on PB via the files queue branch.
		     The list of current supporting filenames is still shown in the JobDetailsModal "Supporting Documents" section for now.
		     This fulfills the "ability to add more for legacy imports" requirement. -->
		<div class="job-invoice-panel__file-row">
			<label class="job-invoice-panel__upload-label job-invoice-panel__upload-label--supporting">
				<input 
					type="file" 
					multiple
					accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword"
					onchange={handleAddSupporting}
					disabled={isUploading}
				/>
				{isUploading ? 'Uploading…' : '+ Add supporting docs'}
			</label>
		</div>
	{:else}
		<button 
			class="job-invoice-panel__generate-btn"
			onclick={handleGenerateDraft}
			disabled={isGenerating || !job}
		>
			{isGenerating ? 'Generating…' : 'Generate Draft Invoice'}
		</button>
		<p class="job-invoice-panel__hint">
			Creates an editable .docx, downloads it immediately, and saves a copy to the job (via PocketBase).
		</p>
	{/if}
</div>

<style>
	.job-invoice-panel {
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 0.75rem;
		background: #fafafa;
		margin-top: 0.5rem;
	}

	.job-invoice-panel__status {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	.job-invoice-panel__status-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-weight: 600;
		text-transform: uppercase;
	}
	.job-invoice-panel__status-badge--draft { background: #fef3c7; color: #92400e; }
	.job-invoice-panel__status-badge--generated { background: #dbeafe; color: #1e40af; }
	.job-invoice-panel__status-badge--sent { background: #d1fae5; color: #166534; }
	.job-invoice-panel__status-badge--paid { background: #a7f3d0; color: #065f46; }

	.job-invoice-panel__paid-edit { font-size: 0.7rem; display: flex; align-items: center; gap: 0.25rem; }
	.job-invoice-panel__paid-edit input { padding: 0.1rem 0.2rem; border: 1px solid #cbd5e1; border-radius: 3px; font-size: 0.65rem; }

	/* )=- Due date override editor style. Matches the paid-edit for visual consistency.
	   Allows user to put in a new due date after initial generation (which used options.invoiceDueDays + job end).
	   )=- Reference: user request + JOBS_AND_INVOICES_SPEC.md */
	.job-invoice-panel__due-edit { font-size: 0.7rem; display: flex; align-items: center; gap: 0.25rem; }
	.job-invoice-panel__due-edit input { padding: 0.1rem 0.2rem; border: 1px solid #cbd5e1; border-radius: 3px; font-size: 0.65rem; }

	.job-invoice-panel__small-btn {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid #cbd5e1;
		border-radius: 4px;
		background: white;
		cursor: pointer;
	}
	.job-invoice-panel__small-btn--primary {
		background: #3b82f6;
		color: white;
		border-color: #3b82f6;
	}

	.job-invoice-panel__file-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.job-invoice-panel__filename {
		color: #475569;
		font-family: monospace;
	}

	/* )=- Small hint for the brief window after Generate (local Dexie + queue) before PB create in processSyncQueue stamps the pbId and filename metadata is enough for Open. */
	.job-invoice-panel__sync-hint {
		font-size: 0.65rem;
		color: #64748b;
		font-style: italic;
	}

	.job-invoice-panel__upload-label {
		cursor: pointer;
		color: #0369a1;
		text-decoration: underline;
	}
	.job-invoice-panel__upload-label input {
		display: none;
	}

	/* )=- Slightly different treatment for the "add more" supporting button (not a replace action). */
	.job-invoice-panel__upload-label--supporting {
		font-size: 0.75rem;
	}

	.job-invoice-panel__generate-btn {
		width: 100%;
		padding: 0.6rem;
		background: #fef3c7;
		color: #92400e;
		border: 1px solid #fde68c;
		border-radius: 6px;
		font-weight: 600;
		cursor: pointer;
	}
	.job-invoice-panel__generate-btn:disabled {
		opacity: 0.6;
	}

	.job-invoice-panel__hint {
		font-size: 0.75rem;
		color: #64748b;
		margin: 0.4rem 0 0;
	}
</style>
