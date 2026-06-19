<!-- InvoiceEditor.svelte — always-visible invoice snapshot editor -->
<script lang="ts">
	import {
		db,
		type Job,
		type Invoice,
		type Client,
		type InvoiceBillableItem,
		type InvoiceClientSnapshot,
		saveInvoiceSnapshot,
		bumpInvoiceVersionForGenerate,
		refreshInvoiceSnapshotFromJob,
		writeInvoiceSnapshotToClientJob,
		updateInvoice,
		removePrimaryInvoiceFile,
		removeInvoiceSupportingDocuments,
		addSupportingDocumentsToJob,
		generateInvoiceDocxFromSnapshot,
		businessInfoFromOptions,
		calculateInvoiceTotals,
		validateInvoiceSnapshot,
		isDocxStale,
		normalizeTaxRateToPercent
	} from '$lib/db';
	import { auth } from '$lib/stores/auth.svelte';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { saveAs } from 'file-saver';
	import { pb } from '$lib/db/pb';
	import { clientPrefersEmailBilling } from '$lib/notifications/crewSchedule';
	import { dateToInputValue, inputValueToDate } from '$lib/utils/dates';
	import { toast } from '$lib/stores/toast.svelte';
	import BillableItemRow from '$lib/components/BillableItemRow.svelte';
	import type { InvoiceDiscount } from '$lib/utils/invoiceTypes';
	import { emptyInvoiceDiscount } from '$lib/utils/invoiceSnapshot';

	let {
		job = $bindable<Job | null>(null),
		invoice = $bindable<Invoice | null>(null),
		onStatusChange = (_newInvoice: Invoice | null) => {}
	} = $props();

	const isAdmin = $derived(auth.currentUser?.role === 'admin');
	const isDev = import.meta.env.DEV;

	let isGenerating = $state(false);
	let isUploading = $state(false);
	let isSending = $state(false);
	let isSaving = $state(false);
	let envelopePreview = $state(false);
	let validationErrors = $state<string[]>([]);

	let clientSnapshot = $state<InvoiceClientSnapshot>({
		name: '',
		serviceAddressStreet: '',
		serviceAddressCity: '',
		serviceAddressState: '',
		serviceAddressZip: '',
		useBillingAddress: false
	});
	let billableItems = $state<InvoiceBillableItem[]>([]);
	let invoiceDiscount = $state<InvoiceDiscount>(emptyInvoiceDiscount());
	let notes = $state('');
	let dueDate = $state<Date>(new Date());
	let invoiceDate = $state<Date>(new Date());
	let status = $state<Invoice['status']>('draft');
	let paidAt = $state<Date | undefined>(undefined);

	let linkedClient = $state<Client | null>(null);

	const taxRatePercent = $derived(normalizeTaxRateToPercent(optionsStore.data?.taxRate, 8));

	const totals = $derived(
		calculateInvoiceTotals({
			billableItems,
			invoiceDiscount,
			taxRatePercent
		})
	);

	const canEmailInvoice = $derived(
		clientPrefersEmailBilling(linkedClient?.preferredBillingMethod) &&
			!!(clientSnapshot.email || linkedClient?.email)
	);

	const docxStale = $derived(invoice ? isDocxStale(invoice) : false);
	const hasPrimaryDocx = $derived(!!invoice?.primaryInvoiceFile?.filename);

	$effect(() => {
		const clientId = job?.clientId;
		if (!clientId) {
			linkedClient = null;
			return;
		}
		db.clients.get(clientId).then(async (c) => {
			if (!c) c = await db.clients.where('pbId').equals(clientId).first();
			linkedClient = c ?? null;
		});
	});

	function loadDraftFromInvoice(inv: Invoice) {
		if (inv.clientSnapshot) clientSnapshot = { ...inv.clientSnapshot };
		billableItems = (inv.billableItems || []).map((i) => ({ ...i }));
		invoiceDiscount = inv.invoiceDiscount
			? { ...inv.invoiceDiscount }
			: emptyInvoiceDiscount();
		notes = inv.notes || '';
		dueDate = inv.dueDate instanceof Date ? inv.dueDate : new Date(inv.dueDate);
		invoiceDate = inv.invoiceDate
			? inv.invoiceDate instanceof Date
				? inv.invoiceDate
				: new Date(inv.invoiceDate)
			: new Date();
		status = inv.status;
		paidAt = inv.paidAt
			? inv.paidAt instanceof Date
				? inv.paidAt
				: new Date(inv.paidAt)
			: undefined;
	}

	$effect(() => {
		if (invoice?.id) loadDraftFromInvoice(invoice);
	});

	function draftPayload(): Partial<Invoice> {
		return {
			clientSnapshot: { ...clientSnapshot },
			billableItems: billableItems.map((i) => ({ ...i })),
			invoiceDiscount: { ...invoiceDiscount },
			notes,
			dueDate,
			invoiceDate,
			status,
			paidAt
		};
	}

	async function persistDraft(): Promise<Invoice | null> {
		if (!invoice?.id) return null;
		isSaving = true;
		validationErrors = [];
		try {
			const validation = validateInvoiceSnapshot({
				clientSnapshot,
				billableItems,
				invoiceDiscount,
				notes,
				dueDate,
				invoiceDate
			});
			if (!validation.success) {
				validationErrors = validation.error.issues.map((i) => i.message);
				return null;
			}
			const fresh = await saveInvoiceSnapshot(invoice.id, draftPayload());
			invoice = fresh;
			onStatusChange(fresh);
			return fresh;
		} catch (err) {
			console.error('Failed to save invoice snapshot', err);
			toast.error('Failed to save invoice');
			return null;
		} finally {
			isSaving = false;
		}
	}

	function addLine() {
		billableItems = [
			...billableItems,
			{ title: '', price: 0, quantity: 1, unit: 'qty', total: 0, lineDiscount: { type: 'amount', value: 0 } }
		];
	}

	function removeLine(index: number) {
		billableItems = billableItems.filter((_, i) => i !== index);
	}

	async function handleRefreshFromJob() {
		if (!invoice?.id || !job) return;
		try {
			const fresh = await refreshInvoiceSnapshotFromJob(invoice.id, job);
			invoice = fresh;
			loadDraftFromInvoice(fresh);
			onStatusChange(fresh);
			toast.success('Refreshed from job and client');
		} catch (err) {
			console.error(err);
			toast.error('Refresh failed');
		}
	}

	async function handleGenerateDocx() {
		if (!job || !invoice?.id) return;
		isGenerating = true;
		validationErrors = [];
		try {
			await optionsStore.load?.();
			const saved = await persistDraft();
			if (!saved) return;

			const bumped = await bumpInvoiceVersionForGenerate(invoice.id);
			invoice = bumped;
			loadDraftFromInvoice(bumped);

			const blob = await generateInvoiceDocxFromSnapshot(
				bumped,
				job,
				linkedClient,
				{
					...businessInfoFromOptions(optionsStore.data),
					invoiceNumber: bumped.invoiceNumber || '',
					invoiceNotes: notes,
					invoiceDate
				},
				isDev && envelopePreview ? { envelopePreview: true } : undefined
			);

			const filename = `${(job.title || 'invoice').replace(/[^a-z0-9]/gi, '_')}.docx`;
			saveAs(blob, filename);

			const nextStatus =
				status === 'draft' && job.status === 'completed' ? 'generated' : status;

			await updateInvoice(
				invoice.id,
				{
					status: nextStatus,
					lastGeneratedAt: new Date(),
					updatedAt: new Date()
				},
				{ primary: { blob, filename } }
			);

			const fresh = await db.invoices.get(invoice.id);
			if (fresh) {
				invoice = fresh;
				status = fresh.status;
				onStatusChange(fresh);
			}

			try {
				await writeInvoiceSnapshotToClientJob(invoice.id);
			} catch (err) {
				console.error('Write-back to client/job failed after generate', err);
				toast.error('Invoice saved, but failed to sync billing to client/job records');
			}

			toast.success(hasPrimaryDocx ? 'Invoice regenerated' : 'Invoice generated');
		} catch (err) {
			console.error('Generate invoice failed', err);
			toast.error('Failed to generate invoice');
		} finally {
			isGenerating = false;
		}
	}

	async function handleRevisedUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.length || !invoice?.id) return;
		isUploading = true;
		try {
			const file = input.files[0];
			await updateInvoice(invoice.id, { updatedAt: new Date(), lastGeneratedAt: new Date() }, {
				primary: { blob: file, filename: file.name }
			});
			const fresh = await db.invoices.get(invoice.id);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
			toast.success('Revised .docx uploaded');
		} catch (err) {
			console.error(err);
			toast.error('Upload failed');
		} finally {
			isUploading = false;
			input.value = '';
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
				loadDraftFromInvoice(fresh);
				onStatusChange(fresh);
			}
			toast.success('Supporting documents added');
		} catch (err) {
			console.error(err);
			toast.error('Failed to add supporting documents');
		} finally {
			isUploading = false;
			input.value = '';
		}
	}

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
		const email = clientSnapshot.email || linkedClient?.email;
		if (!job || !invoice?.id || !canEmailInvoice || !email) return;
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
			const dueLabel = dueDate ? dueDate.toLocaleDateString() : '—';
			const res = await fetch('/api/invoices/send-email', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: pb.authStore.token
				},
				body: JSON.stringify({
					clientEmail: email,
					clientName: clientSnapshot.name || linkedClient?.name,
					jobTitle: job.title || 'Service',
					amount: totals.total,
					dueDate: dueLabel,
					filename,
					docxBase64
				})
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.details || err.error || 'Send failed');
			}
			if (status === 'generated' || status === 'draft') {
				status = 'sent';
				await persistDraft();
			}
			toast.success(`Invoice emailed to ${email}`);
		} catch (err) {
			console.error('Failed to send invoice', err);
			toast.error(err instanceof Error ? err.message : 'Failed to send invoice email');
		} finally {
			isSending = false;
		}
	}

	async function handleQuickStatus(newStatus: Invoice['status']) {
		if (!invoice?.id) return;
		status = newStatus;
		if (newStatus === 'paid' && !paidAt) paidAt = new Date();
		await persistDraft();
	}

	async function handleRemovePrimary() {
		if (!invoice?.id || !isAdmin) return;
		if (!confirm('Remove the .docx file? Invoice data and supporting docs will stay.')) return;
		await removePrimaryInvoiceFile(invoice.id);
		const fresh = await db.invoices.get(invoice.id);
		if (fresh) {
			invoice = fresh;
			onStatusChange(fresh);
		}
		toast.success('.docx removed');
	}

	function downloadPrimary() {
		if (!invoice?.pbId || !invoice.primaryInvoiceFile?.filename) return;
		const url = pb.files.getURL(
			{ id: invoice.pbId, collectionName: 'invoices' },
			invoice.primaryInvoiceFile.filename
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = invoice.primaryInvoiceFile.filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}
</script>

{#if job && invoice}
	<div class="invoice-editor">
		{#if docxStale}
			<p class="invoice-editor__stale-banner">
				Billing fields changed since last .docx — regenerate to update the document.
			</p>
		{/if}

		{#if validationErrors.length}
			<ul class="invoice-editor__errors">
				{#each validationErrors as msg}
					<li>{msg}</li>
				{/each}
			</ul>
		{/if}

		<section class="invoice-editor__section">
			<h4 class="invoice-editor__section-title">Client &amp; addresses</h4>
			<label class="invoice-editor__field">
				Client name
				<input class="invoice-editor__input" bind:value={clientSnapshot.name} onchange={() => persistDraft()} />
			</label>
			<div class="invoice-editor__grid">
				<label>Service street<input class="invoice-editor__input" bind:value={clientSnapshot.serviceAddressStreet} onchange={() => persistDraft()} /></label>
				<label>City<input class="invoice-editor__input" bind:value={clientSnapshot.serviceAddressCity} onchange={() => persistDraft()} /></label>
				<label>State<input class="invoice-editor__input" bind:value={clientSnapshot.serviceAddressState} onchange={() => persistDraft()} /></label>
				<label>ZIP<input class="invoice-editor__input" bind:value={clientSnapshot.serviceAddressZip} onchange={() => persistDraft()} /></label>
			</div>
			<label class="invoice-editor__checkbox">
				<input type="checkbox" bind:checked={clientSnapshot.useBillingAddress} onchange={() => persistDraft()} />
				Use separate billing address on invoice
			</label>
			{#if clientSnapshot.useBillingAddress}
				<div class="invoice-editor__grid">
					<label>Billing street<input class="invoice-editor__input" bind:value={clientSnapshot.billingAddressStreet} onchange={() => persistDraft()} /></label>
					<label>Billing city<input class="invoice-editor__input" bind:value={clientSnapshot.billingAddressCity} onchange={() => persistDraft()} /></label>
					<label>Billing state<input class="invoice-editor__input" bind:value={clientSnapshot.billingAddressState} onchange={() => persistDraft()} /></label>
					<label>Billing ZIP<input class="invoice-editor__input" bind:value={clientSnapshot.billingAddressZip} onchange={() => persistDraft()} /></label>
				</div>
			{/if}
			<div class="invoice-editor__grid">
				<label>Phone<input class="invoice-editor__input" bind:value={clientSnapshot.phone} onchange={() => persistDraft()} /></label>
				<label>Email<input class="invoice-editor__input" bind:value={clientSnapshot.email} onchange={() => persistDraft()} /></label>
			</div>
		</section>

		<section class="invoice-editor__section">
			<div class="invoice-editor__section-head">
				<h4 class="invoice-editor__section-title">Billable items</h4>
				<button type="button" class="invoice-editor__btn" onclick={addLine}>+ Line</button>
			</div>
			{#each billableItems as item, i (i)}
				<BillableItemRow
					bind:item={billableItems[i]}
					showDiscount={true}
					onRemove={() => {
						removeLine(i);
						persistDraft();
					}}
				/>
			{/each}
			<div class="invoice-editor__invoice-discount">
				<span>Invoice discount</span>
				<select
					bind:value={invoiceDiscount.type}
					onchange={() => persistDraft()}
				>
					<option value="amount">$</option>
					<option value="percent">%</option>
				</select>
				<input
					type="number"
					min="0"
					step="0.01"
					bind:value={invoiceDiscount.value}
					onchange={() => persistDraft()}
				/>
			</div>
			<div class="invoice-editor__totals">
				<span>Subtotal: ${totals.subtotal.toFixed(2)}</span>
				<span>Tax ({taxRatePercent}%): ${totals.taxAmount.toFixed(2)}</span>
				<strong>Total: ${totals.total.toFixed(2)}</strong>
			</div>
		</section>

		<section class="invoice-editor__section">
			<h4 class="invoice-editor__section-title">Invoice details</h4>
			<label class="invoice-editor__field">
				Invoice notes (printed on .docx)
				<textarea class="invoice-editor__textarea" rows="2" bind:value={notes} onchange={() => persistDraft()}></textarea>
			</label>
			<div class="invoice-editor__grid">
				<label>Due date
					<input type="date" class="invoice-editor__input" value={dateToInputValue(dueDate)} onchange={(e) => { dueDate = inputValueToDate((e.target as HTMLInputElement).value) ?? dueDate; persistDraft(); }} />
				</label>
				<label>Invoice date
					<input type="date" class="invoice-editor__input" value={dateToInputValue(invoiceDate)} onchange={(e) => { invoiceDate = inputValueToDate((e.target as HTMLInputElement).value) ?? invoiceDate; persistDraft(); }} />
				</label>
			</div>
			{#if invoice.invoiceNumber}
				<p class="invoice-editor__meta">Invoice # {invoice.invoiceNumber} (v{invoice.version ?? 0})</p>
			{/if}
			<div class="invoice-editor__status-row">
				<span class="invoice-editor__badge invoice-editor__badge--{status}">{status}</span>
				{#if status === 'generated'}
					<button type="button" class="invoice-editor__btn" onclick={() => handleQuickStatus('sent')}>Mark Sent</button>
				{:else if status === 'sent'}
					<button type="button" class="invoice-editor__btn" onclick={() => handleQuickStatus('generated')}>Set Unsent</button>
					<button type="button" class="invoice-editor__btn invoice-editor__btn--primary" onclick={() => handleQuickStatus('paid')}>Mark Paid</button>
				{:else if status === 'paid'}
					<button type="button" class="invoice-editor__btn" onclick={() => handleQuickStatus('generated')}>Set Unsent</button>
					<button type="button" class="invoice-editor__btn" onclick={() => handleQuickStatus('sent')}>Mark Unpaid</button>
					<label>Paid on
						<input type="date" value={dateToInputValue(paidAt)} onchange={(e) => { paidAt = inputValueToDate((e.target as HTMLInputElement).value) ?? paidAt; persistDraft(); }} />
					</label>
				{/if}
				{#if canEmailInvoice && hasPrimaryDocx}
					<button
						type="button"
						class="invoice-editor__btn invoice-editor__btn--primary"
						onclick={handleSendInvoiceToClient}
						disabled={isSending || !invoice.pbId}
						title={invoice.pbId ? 'Email current .docx to client' : 'Waiting for invoice sync'}
					>
						{isSending ? 'Sending…' : 'Send to Client'}
					</button>
				{:else if linkedClient && !canEmailInvoice}
					<span class="invoice-editor__hint">Client billing preference is not email — send manually</span>
				{/if}
			</div>
		</section>

		<section class="invoice-editor__section invoice-editor__actions">
			{#if isDev}
				<label class="invoice-editor__checkbox">
					<input type="checkbox" bind:checked={envelopePreview} />
					Envelope preview
				</label>
			{/if}
			<button
				type="button"
				class="invoice-editor__btn"
				onclick={handleRefreshFromJob}
				title="Reload client, addresses, billables, and due date from the current job and client records. Keeps invoice date, notes, and discounts."
			>
				Refresh from job
			</button>
			<button
				type="button"
				class="invoice-editor__btn invoice-editor__btn--primary"
				onclick={handleGenerateDocx}
				disabled={isGenerating}
			>
				{isGenerating ? 'Working…' : hasPrimaryDocx ? 'Regenerate .docx' : 'Generate .docx'}
			</button>
			<label class="invoice-editor__upload">
				<input type="file" accept=".docx" onchange={handleRevisedUpload} disabled={isUploading} />
				Upload revised .docx
			</label>
			<label class="invoice-editor__upload">
				<input type="file" multiple accept="image/*,.pdf,.doc,.docx" onchange={handleAddSupporting} disabled={isUploading} />
				+ Supporting docs
			</label>
			{#if hasPrimaryDocx && isAdmin}
				<button type="button" class="invoice-editor__btn invoice-editor__btn--danger" onclick={handleRemovePrimary}>Remove .docx</button>
				{#if invoice.pbId}
					<button type="button" class="invoice-editor__btn" onclick={downloadPrimary}>Open .docx</button>
				{/if}
			{/if}
			{#if isSaving}<span class="invoice-editor__hint">Saving…</span>{/if}
		</section>

		{#if invoice.supportingDocuments?.length}
			<ul class="invoice-editor__supporting">
				{#each invoice.supportingDocuments as doc (doc.filename)}
					<li>
						<span>{doc.filename}</span>
						{#if isAdmin}
							<button type="button" class="invoice-editor__btn invoice-editor__btn--danger" onclick={async () => {
								if (!invoice?.id) return;
								await removeInvoiceSupportingDocuments(invoice.id, [doc.filename]);
								const fresh = await db.invoices.get(invoice.id);
								if (fresh) { invoice = fresh; onStatusChange(fresh); }
							}}>Delete</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else}
	<p class="invoice-editor__hint">Loading invoice editor…</p>
{/if}

<style>
	.invoice-editor {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-3);
		background: var(--color-surface-alt);
		color: var(--color-text);
		margin-top: var(--space-2);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	@media (max-width: 768px) {
		.invoice-editor {
			padding: var(--space-2);
			border-radius: var(--radius-sm);
			margin-top: var(--space-1);
			gap: var(--space-2);
		}
	}

	.invoice-editor__section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.invoice-editor__section-title {
		margin: 0;
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.invoice-editor__section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.invoice-editor__grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-2);
	}

	@media (max-width: 768px) {
		.invoice-editor__grid {
			grid-template-columns: 1fr;
		}
	}

	.invoice-editor__field,
	.invoice-editor__grid label {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
	}

	.invoice-editor__input,
	.invoice-editor__textarea,
	.invoice-editor__invoice-discount select,
	.invoice-editor__invoice-discount input,
	.invoice-editor__status-row input[type='date'] {
		padding: var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font: inherit;
		box-sizing: border-box;
	}

	.invoice-editor__textarea {
		resize: vertical;
		min-height: 3rem;
		width: 100%;
	}

	.invoice-editor__input[type='date']::-webkit-calendar-picker-indicator {
		filter: invert(0.2);
	}

	.dark .invoice-editor__input[type='date']::-webkit-calendar-picker-indicator,
	.dark .invoice-editor__status-row input[type='date']::-webkit-calendar-picker-indicator {
		filter: invert(1);
	}

	.invoice-editor__checkbox {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		cursor: pointer;
	}

	.invoice-editor__totals {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		padding: var(--space-2);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
	}

	.invoice-editor__invoice-discount {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.invoice-editor__invoice-discount select {
		width: 3.5rem;
		padding: var(--space-1) var(--space-2);
	}

	.invoice-editor__invoice-discount input {
		width: 5rem;
		max-width: 100%;
	}

	.invoice-editor__meta {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.invoice-editor__actions {
		display: flex;
		flex-wrap: wrap;
		flex-direction: row;
		align-items: center;
		gap: var(--space-2);
		padding-top: var(--space-1);
		border-top: 1px solid var(--color-border);
	}

	@media (max-width: 768px) {
		.invoice-editor__actions {
			flex-direction: column;
			align-items: stretch;
		}

		.invoice-editor__actions .invoice-editor__btn--primary {
			width: 100%;
			padding: var(--space-2) var(--space-3);
		}
	}

	.invoice-editor__btn {
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
	}

	.invoice-editor__btn:hover:not(:disabled) {
		background: var(--color-surface-alt);
	}

	.invoice-editor__btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.invoice-editor__btn--primary {
		background: var(--color-primary);
		color: white;
		border-color: var(--color-primary);
	}

	.invoice-editor__btn--primary:hover:not(:disabled) {
		filter: brightness(1.1);
		background: var(--color-primary);
	}

	.invoice-editor__btn--danger {
		border-color: var(--color-danger);
		color: var(--color-danger-emphasis, var(--color-danger));
	}

	.invoice-editor__btn--danger:hover:not(:disabled) {
		background: var(--color-danger-soft);
	}

	.invoice-editor__upload {
		font-size: var(--font-size-xs);
		color: var(--color-primary);
		cursor: pointer;
		text-decoration: underline;
	}

	.invoice-editor__upload input {
		display: none;
	}

	@media (max-width: 768px) {
		.invoice-editor__upload {
			text-align: center;
			padding: var(--space-1) 0;
		}
	}

	.invoice-editor__stale-banner {
		margin: 0;
		padding: var(--space-2);
		background: var(--color-warning-soft);
		border: 1px solid var(--color-warning);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-xs);
		color: var(--color-warning);
	}

	.invoice-editor__errors {
		margin: 0;
		padding: var(--space-2) var(--space-2) var(--space-2) 1.4rem;
		color: var(--color-danger);
		font-size: var(--font-size-xs);
		background: var(--color-danger-soft);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-sm);
	}

	.invoice-editor__badge {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.55rem;
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
	}

	.invoice-editor__badge--draft {
		background: var(--color-warning-soft);
		color: var(--color-warning);
	}

	.invoice-editor__badge--generated {
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
	}

	.invoice-editor__badge--sent,
	.invoice-editor__badge--paid {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.invoice-editor__status-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	@media (max-width: 768px) {
		.invoice-editor__status-row {
			gap: var(--space-1);
		}

		.invoice-editor__status-row label {
			width: 100%;
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			font-size: var(--font-size-xs);
			color: var(--color-text-muted);
		}
	}

	.invoice-editor__hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
	}

	.invoice-editor__supporting {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--font-size-xs);
	}

	.invoice-editor__supporting li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}

	.invoice-editor__supporting li span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: monospace;
		color: var(--color-text-muted);
	}

	@media (max-width: 768px) {
		.invoice-editor__supporting li {
			flex-wrap: wrap;
		}
	}
</style>