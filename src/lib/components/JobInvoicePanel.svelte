<!-- src/lib/components/JobInvoicePanel.svelte -->
<script lang="ts">
	import {
		db,
		type Job,
		type Invoice,
		type Client,
		createInvoice,
		updateInvoice,
		generateInvoiceDocx,
		deleteInvoice,
		removeInvoiceSupportingDocuments,
		addSupportingDocumentsToJob
	} from '$lib/db';
	import { auth } from '$lib/stores/auth.svelte';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { saveAs } from 'file-saver';
	import { pb } from '$lib/db/pb';
	import { clientPrefersEmailBilling } from '$lib/notifications/crewSchedule';
	import { dateToInputValue, getInvoiceDueDateForJob, inputValueToDate } from '$lib/utils/dates';
	import { toast } from '$lib/stores/toast.svelte';

	let {
		job = $bindable<Job | null>(null),
		invoice = $bindable<Invoice | null>(null),
		onStatusChange = (newInvoice: Invoice | null) => {}
	} = $props();

	const isAdmin = $derived(auth.currentUser?.role === 'admin');

	let isGenerating = $state(false);
	let isUploading = $state(false);
	let isSending = $state(false);

	let client = $state<Client | null>(null);

	$effect(() => {
		const clientId = job?.clientId;
		if (!clientId) {
			client = null;
			return;
		}
		db.clients.get(clientId).then((c) => {
			client = c ?? null;
		});
	});

	const canEmailInvoice = $derived(
		clientPrefersEmailBilling(client?.preferredBillingMethod) && !!client?.email
	);

	async function fetchPrimaryInvoiceBlob(inv: Invoice): Promise<Blob | null> {
		if (!inv.pbId || !inv.primaryInvoiceFile?.filename) return null;
		const url = pb.files.getURL(
			{ id: inv.pbId, collectionName: 'invoices' },
			inv.primaryInvoiceFile.filename
		);
		const res = await fetch(url);
		if (!res.ok) return null;
		return res.blob();
	}

	async function handleSendInvoiceToClient() {
		if (!job || !invoice || !canEmailInvoice || !client?.email) return;
		isSending = true;
		try {
			const blob = await fetchPrimaryInvoiceBlob(invoice);
			if (!blob) {
				toast.error('Invoice file not ready yet — wait for sync or upload a revised .docx.');
				return;
			}
			const filename = invoice.primaryInvoiceFile?.filename || 'invoice.docx';
			const buf = await blob.arrayBuffer();
			const bytes = new Uint8Array(buf);
			let binary = '';
			for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
			const docxBase64 = btoa(binary);

			const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—';
			const res = await fetch('/api/invoices/send-email', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: pb.authStore.token
				},
				body: JSON.stringify({
					clientEmail: client.email,
					clientName: client.name,
					jobTitle: job.title || 'Service',
					amount: invoice.amount ?? job.totalAmount ?? 0,
					dueDate,
					filename,
					docxBase64
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.details || err.error || 'Send failed');
			}
			if (invoice.status === 'generated' || invoice.status === 'draft') {
				await updateInvoice(invoice.id!, { status: 'sent', updatedAt: new Date() });
				const fresh = await db.invoices.get(invoice.id!);
				if (fresh) {
					invoice = fresh;
					onStatusChange(fresh);
				}
			}
			toast.success(`Invoice emailed to ${client.email}`);
		} catch (err) {
			console.error('Failed to send invoice', err);
			toast.error(err instanceof Error ? err.message : 'Failed to send invoice email');
		} finally {
			isSending = false;
		}
	}

	async function handleGenerateDraft() {
		if (!job) return;
		isGenerating = true;

		try {
			await optionsStore.load?.();
			const c = job.clientId ? await db.clients.get(job.clientId) : null;

			const blob = await generateInvoiceDocx(job, c, {
				taxRate: optionsStore.data?.taxRate,
				invoiceDueDays: optionsStore.data?.invoiceDueDays
			});

			const filename = `${(job.title || 'invoice').replace(/[^a-z0-9]/gi, '_')}.docx`;
			saveAs(blob, filename);

			const dueDays = optionsStore.data?.invoiceDueDays ?? 30;
			const dueDate = getInvoiceDueDateForJob(job, dueDays);

			const newInvoiceId = await createInvoice(
				{
					jobId: job.id,
					clientId: job.clientId,
					status: job.status === 'completed' ? 'generated' : 'draft',
					dueDate,
					amount: job.totalAmount,
					billableItems: job.billableItems,
					notes: job.notes,
					importSource: job.importSource
				},
				{
					primary: { blob, filename }
				}
			);

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
		const blob = file;

		try {
			await updateInvoice(
				invoice.id!,
				{
					updatedAt: new Date()
				},
				{
					primary: { blob, filename: file.name }
				}
			);

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
			input.value = '';
		}
	}

	async function handleQuickStatus(newStatus: Invoice['status']) {
		if (!invoice || !invoice.id) return;
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

	async function downloadPrimary() {
		if (!invoice?.pbId || !invoice.primaryInvoiceFile?.filename) {
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

	async function handleRegenerate() {
		if (!job || !invoice) return;
		isGenerating = true;
		try {
			await optionsStore.load?.();
			const c = job.clientId ? await db.clients.get(job.clientId) : null;
			const blob = await generateInvoiceDocx(job, c, {
				taxRate: optionsStore.data?.taxRate,
				invoiceDueDays: optionsStore.data?.invoiceDueDays
			});
			const filename = `${(job.title || 'invoice').replace(/[^a-z0-9]/gi, '_')}.docx`;
			saveAs(blob, filename);

			const dueDays = optionsStore.data?.invoiceDueDays ?? 30;
			const dueDate = getInvoiceDueDateForJob(job, dueDays);
			await updateInvoice(
				invoice.id!,
				{ dueDate, updatedAt: new Date() },
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

	async function handleEditPaidAt(e: Event) {
		if (!invoice) return;
		const input = e.target as HTMLInputElement;
		const paidAt = inputValueToDate(input.value);
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

	async function handleEditDueDate(e: Event) {
		if (!invoice) return;
		const input = e.target as HTMLInputElement;
		const dueDate = inputValueToDate(input.value) ?? invoice.dueDate;
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

	function downloadSupportingDoc(doc: { filename: string }) {
		if (!invoice?.pbId || !doc.filename) return;
		const url = pb.files.getURL(
			{ id: invoice.pbId, collectionName: 'invoices' },
			doc.filename
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = doc.filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	async function handleDeleteSupportingDoc(doc: { filename: string }) {
		if (!invoice?.id || !isAdmin) return;
		const msg = `Delete supporting document "${doc.filename}"? This cannot be undone.`;
		if (!confirm(msg)) return;
		try {
			await removeInvoiceSupportingDocuments(invoice.id, [doc.filename]);
			const fresh = await db.invoices.get(invoice.id);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
			toast.success('Supporting document removed');
		} catch (err) {
			console.error('Failed to delete supporting document', err);
			toast.error('Failed to delete supporting document');
		}
	}

	async function handleDeleteInvoice() {
		if (!invoice?.id || !isAdmin) return;
		const label = invoice.primaryInvoiceFile?.filename || 'this invoice';
		const msg = `Delete invoice (${label})? This removes the invoice record and all attached files. This cannot be undone.`;
		if (!confirm(msg)) return;
		try {
			await deleteInvoice(invoice.id);
			invoice = null;
			onStatusChange(null);
			toast.success('Invoice deleted');
		} catch (err) {
			console.error('Failed to delete invoice', err);
			toast.error('Failed to delete invoice');
		}
	}

	async function handleAddSupporting(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.length || !job?.id) return;

		isUploading = true;
		const newFiles = Array.from(input.files).map((file) => ({
			blob: file,
			filename: file.name,
			type: file.type || 'application/octet-stream'
		}));

		try {
			const invoiceId = await addSupportingDocumentsToJob(job, newFiles);
			const fresh = await db.invoices.get(invoiceId);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
			toast.success('Supporting documents added');
		} catch (err) {
			console.error('Failed to add supporting documents', err);
			toast.error('Failed to add supporting documents');
		} finally {
			isUploading = false;
			input.value = '';
		}
	}
</script>

<div class="job-invoice-panel">
	{#if invoice}
		<div class="job-invoice-panel__status">
			<span
				class="job-invoice-panel__status-badge job-invoice-panel__status-badge--{invoice.status}"
			>
				{invoice.status}
			</span>
			{#if invoice}
				<button
					class="job-invoice-panel__small-btn"
					onclick={handleRegenerate}
					disabled={isGenerating}>Regenerate</button
				>
				<span class="job-invoice-panel__due-edit">
					Due on:
					<input
						type="date"
						value={dateToInputValue(invoice.dueDate)}
						onchange={handleEditDueDate}
					/>
				</span>
			{/if}
			{#if canEmailInvoice && invoice.primaryInvoiceFile?.filename}
				<button
					class="job-invoice-panel__small-btn job-invoice-panel__small-btn--primary"
					onclick={handleSendInvoiceToClient}
					disabled={isSending || !invoice.pbId}
					title={invoice.pbId ? 'Email current .docx to client' : 'Waiting for invoice sync'}
				>
					{isSending ? 'Sending…' : 'Send to Client'}
				</button>
			{:else if client && !canEmailInvoice}
				<span class="job-invoice-panel__sync-hint"
					>Client billing preference is not email — send manually</span
				>
			{/if}
			{#if invoice.status === 'generated'}
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('sent')}
					>Mark Sent</button
				>
			{:else if invoice.status === 'sent'}
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('generated')}
					>Set Unsent</button
				>
				<button
					class="job-invoice-panel__small-btn job-invoice-panel__small-btn--primary"
					onclick={() => handleQuickStatus('paid')}>Mark Paid</button
				>
			{:else if invoice.status === 'paid'}
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('generated')}
					>Set Unsent</button
				>
				<button class="job-invoice-panel__small-btn" onclick={() => handleQuickStatus('sent')}
					>Mark Unpaid</button
				>
				<span class="job-invoice-panel__paid-edit">
					Paid on:
					<input type="date" value={dateToInputValue(invoice.paidAt)} onchange={handleEditPaidAt} />
				</span>
			{/if}
		</div>

		<div class="job-invoice-panel__file-row">
			{#if invoice.primaryInvoiceFile?.filename}
				<span class="job-invoice-panel__filename">{invoice.primaryInvoiceFile.filename}</span>
				{#if invoice.pbId}
					<button class="job-invoice-panel__small-btn" onclick={downloadPrimary}>Open</button>
				{:else}
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

		{#if invoice.supportingDocuments?.length}
			<ul class="job-invoice-panel__supporting-list">
				{#each invoice.supportingDocuments as doc (doc.filename)}
					<li class="job-invoice-panel__supporting-item">
						<span class="job-invoice-panel__supporting-name" title={doc.filename}>
							{doc.filename}
						</span>
						<div class="job-invoice-panel__supporting-actions">
							{#if invoice.pbId}
								<button
									type="button"
									class="job-invoice-panel__small-btn"
									onclick={() => downloadSupportingDoc(doc)}>Open</button
								>
							{:else}
								<span class="job-invoice-panel__sync-hint">pending sync</span>
							{/if}
							{#if isAdmin}
								<button
									type="button"
									class="job-invoice-panel__small-btn job-invoice-panel__small-btn--danger"
									onclick={() => handleDeleteSupportingDoc(doc)}>Delete</button
								>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if isAdmin}
			<div class="job-invoice-panel__danger-row">
				<button
					type="button"
					class="job-invoice-panel__small-btn job-invoice-panel__small-btn--danger"
					onclick={handleDeleteInvoice}
				>
					Delete invoice
				</button>
			</div>
		{/if}
	{:else}
		<button
			class="job-invoice-panel__generate-btn"
			onclick={handleGenerateDraft}
			disabled={isGenerating || !job}
		>
			{isGenerating ? 'Generating…' : 'Generate Draft Invoice'}
		</button>
		<p class="job-invoice-panel__hint">
			Downloads an editable .docx for review. Tweak in Word, re-upload if needed, then use
			<strong>Send to Client</strong> when ready (email clients only).
		</p>

		<div class="job-invoice-panel__file-row">
			<label class="job-invoice-panel__upload-label job-invoice-panel__upload-label--supporting">
				<input
					type="file"
					multiple
					accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword"
					onchange={handleAddSupporting}
					disabled={isUploading || !job}
				/>
				{isUploading ? 'Uploading…' : '+ Add supporting docs'}
			</label>
		</div>
		<p class="job-invoice-panel__hint">
			Attach photos, PDFs, or other files anytime — no invoice required.
		</p>
	{/if}
</div>

<style>
	.job-invoice-panel {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		background: var(--color-surface-alt);
		margin-top: var(--space-2);
	}

	@media (max-width: 768px) {
		.job-invoice-panel {
			padding: var(--space-2);
			border-radius: var(--radius-sm);
			margin-top: var(--space-1);
		}
	}

	.job-invoice-panel__status {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-2);
		flex-wrap: wrap;
	}

	@media (max-width: 768px) {
		.job-invoice-panel__status {
			gap: var(--space-1);
		}
	}

	.job-invoice-panel__status-badge {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.55rem;
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
	}
	.job-invoice-panel__status-badge--draft {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}
	.job-invoice-panel__status-badge--generated {
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
	}
	.job-invoice-panel__status-badge--sent {
		background: var(--color-success-soft);
		color: var(--color-success);
	}
	.job-invoice-panel__status-badge--paid {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.job-invoice-panel__paid-edit {
		font-size: var(--font-size-xs);
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.job-invoice-panel__paid-edit input {
		padding: var(--space-1) var(--space-1);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.job-invoice-panel__due-edit {
		font-size: var(--font-size-xs);
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.job-invoice-panel__due-edit input {
		padding: var(--space-1) var(--space-1);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.job-invoice-panel__small-btn {
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}
	.job-invoice-panel__small-btn:hover {
		background: var(--color-surface-alt);
	}
	@media (max-width: 768px) {
		.job-invoice-panel__small-btn {
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-xs);
		}
	}
	.job-invoice-panel__small-btn--primary {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}
	.job-invoice-panel__small-btn--primary:hover {
		filter: brightness(1.1);
	}

	.job-invoice-panel__file-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
	}

	.job-invoice-panel__filename {
		color: var(--color-text-muted);
		font-family: monospace;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.job-invoice-panel__sync-hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.job-invoice-panel__upload-label {
		cursor: pointer;
		color: var(--color-primary);
		text-decoration: underline;
		font-size: var(--font-size-xs);
		white-space: nowrap;
	}
	.job-invoice-panel__upload-label input {
		display: none;
	}

	.job-invoice-panel__upload-label--supporting {
		font-size: var(--font-size-xs);
	}

	.job-invoice-panel__generate-btn {
		width: 100%;
		padding: var(--space-3);
		background: var(--color-warning-soft);
		color: var(--color-warning);
		border: 1px solid var(--color-warning);
		border-radius: var(--radius-md);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
	}
	.job-invoice-panel__generate-btn:disabled {
		opacity: 0.6;
	}

	.job-invoice-panel__hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0;
	}

	.job-invoice-panel__supporting-list {
		list-style: none;
		margin: var(--space-2) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.job-invoice-panel__supporting-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	.job-invoice-panel__supporting-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: monospace;
		color: var(--color-text-muted);
	}

	.job-invoice-panel__supporting-actions {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
	}

	.job-invoice-panel__small-btn--danger {
		border-color: var(--color-danger);
		color: var(--color-danger-emphasis, var(--color-danger));
	}

	.job-invoice-panel__small-btn--danger:hover {
		background: var(--color-danger-soft);
	}

	.job-invoice-panel__danger-row {
		margin-top: var(--space-3);
		padding-top: var(--space-2);
		border-top: 1px solid var(--color-border);
	}
</style>