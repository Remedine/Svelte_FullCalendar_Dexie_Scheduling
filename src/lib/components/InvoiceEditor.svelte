<!-- InvoiceEditor.svelte — invoice snapshot editor with accordion steps -->
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
		onStatusChange = (_newInvoice: Invoice | null) => {},
		onClose = () => {},
		onEditJob = () => {}
	} = $props();

	const WORKFLOW_STEPS = [
		{ id: 'draft' as const, label: 'Draft' },
		{ id: 'generated' as const, label: 'Ready' },
		{ id: 'sent' as const, label: 'Sent' },
		{ id: 'paid' as const, label: 'Paid' }
	];

	const isAdmin = $derived(auth.currentUser?.role === 'admin');
	const isDev = import.meta.env.DEV;

	let isGenerating = $state(false);
	let isUploading = $state(false);
	let isSending = $state(false);
	let isSaving = $state(false);
	let envelopePreview = $state(false);
	let validationErrors = $state<string[]>([]);
	let showOverflowMenu = $state(false);
	let showSupportingList = $state(false);

	let openWho = $state(false);
	let openWhat = $state(false);
	let openDocument = $state(false);

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
	let revisedFileInput = $state<HTMLInputElement | null>(null);
	let supportingFileInput = $state<HTMLInputElement | null>(null);

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
	const supportingCount = $derived(invoice?.supportingDocuments?.length ?? 0);
	const workflowIndex = $derived(WORKFLOW_STEPS.findIndex((s) => s.id === status));

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
			{
				title: '',
				price: 0,
				quantity: 1,
				unit: 'qty',
				total: 0,
				lineDiscount: { type: 'amount', value: 0 }
			}
		];
	}

	function removeLine(index: number) {
		billableItems = billableItems.filter((_, i) => i !== index);
	}

	function closeOverflowMenu() {
		showOverflowMenu = false;
	}

	async function handleRefreshFromJob() {
		if (!invoice?.id || !job) return;
		closeOverflowMenu();
		try {
			const fresh = await refreshInvoiceSnapshotFromJob(invoice.id, job);
			invoice = fresh;
			loadDraftFromInvoice(fresh);
			onStatusChange(fresh);
			toast.success('Updated from job');
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
		closeOverflowMenu();
		try {
			const file = input.files[0];
			await updateInvoice(
				invoice.id,
				{ updatedAt: new Date(), lastGeneratedAt: new Date() },
				{ primary: { blob: file, filename: file.name } }
			);
			const fresh = await db.invoices.get(invoice.id);
			if (fresh) {
				invoice = fresh;
				onStatusChange(fresh);
			}
			toast.success('Revised invoice uploaded');
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
		closeOverflowMenu();
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
			showSupportingList = true;
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
				toast.error('Invoice file not ready yet — wait for sync or upload a revised file.');
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

	async function handleWorkflowStep(stepId: Invoice['status']) {
		if (!invoice?.id || stepId === status) return;
		const targetIdx = WORKFLOW_STEPS.findIndex((s) => s.id === stepId);
		if (targetIdx < workflowIndex) {
			const label = WORKFLOW_STEPS.find((s) => s.id === stepId)?.label ?? stepId;
			if (!confirm(`Move invoice back to "${label}"?`)) return;
		}
		status = stepId;
		if (stepId === 'paid' && !paidAt) paidAt = new Date();
		await persistDraft();
	}

	async function handleRemovePrimary() {
		if (!invoice?.id || !isAdmin) return;
		closeOverflowMenu();
		if (!confirm('Remove the invoice file? Your billing details and attachments will stay.')) return;
		await removePrimaryInvoiceFile(invoice.id);
		const fresh = await db.invoices.get(invoice.id);
		if (fresh) {
			invoice = fresh;
			onStatusChange(fresh);
		}
		toast.success('Invoice file removed');
	}

	function downloadPrimary() {
		if (!invoice?.pbId || !invoice.primaryInvoiceFile?.filename) return;
		closeOverflowMenu();
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

<svelte:window onclick={() => (showOverflowMenu = false)} />

{#if job && invoice}
	<div class="invoice-editor">
		{#if validationErrors.length}
			<ul class="invoice-editor__errors">
				{#each validationErrors as msg}
					<li>{msg}</li>
				{/each}
			</ul>
		{/if}

		<!-- Step 1: Who & where -->
		<div class="invoice-editor__accordion" class:invoice-editor__accordion--open={openWho}>
			<button
				type="button"
				class="invoice-editor__accordion-head"
				aria-expanded={openWho}
				onclick={() => (openWho = !openWho)}
			>
				<span class="invoice-editor__accordion-num">1</span>
				<span class="invoice-editor__accordion-label">Who &amp; where</span>
				<span class="invoice-editor__accordion-chevron" aria-hidden="true">{openWho ? '▾' : '▸'}</span>
			</button>
			{#if openWho}
				<div class="invoice-editor__accordion-body">
					<label class="invoice-editor__field">
						Client name
						<input
							class="invoice-editor__input"
							bind:value={clientSnapshot.name}
							onchange={() => persistDraft()}
						/>
					</label>
					<div class="invoice-editor__grid">
						<label
							>Service street<input
								class="invoice-editor__input"
								bind:value={clientSnapshot.serviceAddressStreet}
								onchange={() => persistDraft()}
							/></label
						>
						<label
							>City<input
								class="invoice-editor__input"
								bind:value={clientSnapshot.serviceAddressCity}
								onchange={() => persistDraft()}
							/></label
						>
						<label
							>State<input
								class="invoice-editor__input"
								bind:value={clientSnapshot.serviceAddressState}
								onchange={() => persistDraft()}
							/></label
						>
						<label
							>ZIP<input
								class="invoice-editor__input"
								bind:value={clientSnapshot.serviceAddressZip}
								onchange={() => persistDraft()}
							/></label
						>
					</div>
					<label class="invoice-editor__checkbox">
						<input
							type="checkbox"
							bind:checked={clientSnapshot.useBillingAddress}
							onchange={() => persistDraft()}
						/>
						Different billing address on invoice
					</label>
					{#if clientSnapshot.useBillingAddress}
						<div class="invoice-editor__grid">
							<label
								>Billing street<input
									class="invoice-editor__input"
									bind:value={clientSnapshot.billingAddressStreet}
									onchange={() => persistDraft()}
								/></label
							>
							<label
								>Billing city<input
									class="invoice-editor__input"
									bind:value={clientSnapshot.billingAddressCity}
									onchange={() => persistDraft()}
								/></label
							>
							<label
								>Billing state<input
									class="invoice-editor__input"
									bind:value={clientSnapshot.billingAddressState}
									onchange={() => persistDraft()}
								/></label
							>
							<label
								>Billing ZIP<input
									class="invoice-editor__input"
									bind:value={clientSnapshot.billingAddressZip}
									onchange={() => persistDraft()}
								/></label
							>
						</div>
					{/if}
					<div class="invoice-editor__grid">
						<label
							>Phone<input
								class="invoice-editor__input"
								bind:value={clientSnapshot.phone}
								onchange={() => persistDraft()}
							/></label
						>
						<label
							>Email<input
								class="invoice-editor__input"
								bind:value={clientSnapshot.email}
								onchange={() => persistDraft()}
							/></label
						>
					</div>
				</div>
			{/if}
		</div>

		<!-- Step 2: What & how much -->
		<div class="invoice-editor__accordion" class:invoice-editor__accordion--open={openWhat}>
			<button
				type="button"
				class="invoice-editor__accordion-head"
				aria-expanded={openWhat}
				onclick={() => (openWhat = !openWhat)}
			>
				<span class="invoice-editor__accordion-num">2</span>
				<span class="invoice-editor__accordion-label">What &amp; how much</span>
				<span class="invoice-editor__accordion-summary">${totals.total.toFixed(2)}</span>
				<span class="invoice-editor__accordion-chevron" aria-hidden="true">{openWhat ? '▾' : '▸'}</span>
			</button>
			{#if openWhat}
				<div class="invoice-editor__accordion-body">
					<div class="invoice-editor__section-head">
						<span class="invoice-editor__hint">Line items on this invoice</span>
						<button type="button" class="invoice-editor__btn" onclick={addLine}>+ Add line</button>
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
						<select bind:value={invoiceDiscount.type} onchange={() => persistDraft()}>
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
				</div>
			{/if}
			<div class="invoice-editor__totals-bar">
				<span>Subtotal ${totals.subtotal.toFixed(2)}</span>
				<span>Tax ${totals.taxAmount.toFixed(2)}</span>
				<strong>Total ${totals.total.toFixed(2)}</strong>
			</div>
		</div>

		<!-- Step 3: Document & delivery -->
		<div class="invoice-editor__accordion" class:invoice-editor__accordion--open={openDocument}>
			<button
				type="button"
				class="invoice-editor__accordion-head"
				aria-expanded={openDocument}
				onclick={() => (openDocument = !openDocument)}
			>
				<span class="invoice-editor__accordion-num">3</span>
				<span class="invoice-editor__accordion-label">Document &amp; delivery</span>
				{#if hasPrimaryDocx}
					<span class="invoice-editor__accordion-summary">File ready</span>
				{/if}
				<span class="invoice-editor__accordion-chevron" aria-hidden="true">{openDocument ? '▾' : '▸'}</span>
			</button>
			{#if openDocument}
				<div class="invoice-editor__accordion-body">
					{#if docxStale}
						<p class="invoice-editor__stale-banner">
							Billing details changed — regenerate to update the invoice file.
						</p>
					{/if}

					<nav class="invoice-editor__workflow" aria-label="Invoice progress">
						{#each WORKFLOW_STEPS as step, i}
							{#if i > 0}
								<span
									class="invoice-editor__workflow-line"
									class:invoice-editor__workflow-line--done={i <= workflowIndex}
									aria-hidden="true"
								></span>
							{/if}
							<button
								type="button"
								class="invoice-editor__workflow-step"
								class:invoice-editor__workflow-step--current={status === step.id}
								class:invoice-editor__workflow-step--done={i < workflowIndex}
								onclick={() => handleWorkflowStep(step.id)}
							>
								{step.label}
							</button>
						{/each}
					</nav>

					{#if status === 'paid'}
						<label class="invoice-editor__field">
							Paid on
							<input
								type="date"
								class="invoice-editor__input"
								value={dateToInputValue(paidAt)}
								onchange={(e) => {
									paidAt = inputValueToDate((e.target as HTMLInputElement).value) ?? paidAt;
									persistDraft();
								}}
							/>
						</label>
					{/if}

					<label class="invoice-editor__field">
						Notes for the invoice (printed on document)
						<textarea
							class="invoice-editor__textarea"
							rows="2"
							bind:value={notes}
							onchange={() => persistDraft()}
						></textarea>
					</label>
					<div class="invoice-editor__grid">
						<label
							>Due date
							<input
								type="date"
								class="invoice-editor__input"
								value={dateToInputValue(dueDate)}
								onchange={(e) => {
									dueDate = inputValueToDate((e.target as HTMLInputElement).value) ?? dueDate;
									persistDraft();
								}}
							/></label
						>
						<label
							>Invoice date
							<input
								type="date"
								class="invoice-editor__input"
								value={dateToInputValue(invoiceDate)}
								onchange={(e) => {
									invoiceDate =
										inputValueToDate((e.target as HTMLInputElement).value) ?? invoiceDate;
									persistDraft();
								}}
							/></label
						>
					</div>
					{#if invoice.invoiceNumber}
						<p class="invoice-editor__meta">Invoice #{invoice.invoiceNumber}</p>
					{/if}

					{#if hasPrimaryDocx}
						<p class="invoice-editor__file-meta">
							<span>{invoice.primaryInvoiceFile?.filename}</span>
							{#if invoice.pbId}
								<button type="button" class="invoice-editor__link-btn" onclick={downloadPrimary}
									>Open file</button
								>
							{/if}
						</p>
					{/if}

					{#if linkedClient && !canEmailInvoice}
						<p class="invoice-editor__hint">
							This client prefers billing by mail — send the invoice manually.
						</p>
					{/if}

					{#if supportingCount > 0}
						<button
							type="button"
							class="invoice-editor__supporting-toggle"
							onclick={() => (showSupportingList = !showSupportingList)}
						>
							{showSupportingList ? 'Hide' : 'Show'}
							{supportingCount} attachment{supportingCount === 1 ? '' : 's'}
						</button>
						{#if showSupportingList}
							<ul class="invoice-editor__supporting">
								{#each invoice.supportingDocuments ?? [] as doc (doc.filename)}
									<li>
										<span>{doc.filename}</span>
										{#if isAdmin}
											<button
												type="button"
												class="invoice-editor__btn invoice-editor__btn--danger"
												onclick={async () => {
													if (!invoice?.id) return;
													await removeInvoiceSupportingDocuments(invoice.id, [doc.filename]);
													const fresh = await db.invoices.get(invoice.id);
													if (fresh) {
														invoice = fresh;
														onStatusChange(fresh);
													}
												}}>Delete</button
											>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		<!-- Hidden file inputs -->
		<input
			type="file"
			accept=".docx"
			class="invoice-editor__hidden-input"
			bind:this={revisedFileInput}
			onchange={handleRevisedUpload}
			disabled={isUploading}
		/>
		<input
			type="file"
			multiple
			accept="image/*,.pdf,.doc,.docx"
			class="invoice-editor__hidden-input"
			bind:this={supportingFileInput}
			onchange={handleAddSupporting}
			disabled={isUploading}
		/>

		<!-- Sticky action bar -->
		<div class="invoice-editor__footer">
			<div class="invoice-editor__footer-primary">
				<button
					type="button"
					class="invoice-editor__btn invoice-editor__btn--primary invoice-editor__btn--generate"
					onclick={handleGenerateDocx}
					disabled={isGenerating}
				>
					{isGenerating
						? 'Working…'
						: hasPrimaryDocx
							? 'Regenerate invoice'
							: 'Generate invoice'}
				</button>
				{#if canEmailInvoice && hasPrimaryDocx}
					<button
						type="button"
						class="invoice-editor__btn invoice-editor__btn--secondary"
						onclick={handleSendInvoiceToClient}
						disabled={isSending || !invoice.pbId}
						title={invoice.pbId ? 'Email invoice to client' : 'Waiting for sync'}
					>
						{isSending ? 'Sending…' : 'Send to client'}
					</button>
				{/if}
			</div>
			<div class="invoice-editor__footer-secondary">
				<button type="button" class="invoice-editor__btn" onclick={onEditJob}>Edit full job</button>
				{#if isSaving}<span class="invoice-editor__hint">Saving…</span>{/if}
				<div class="invoice-editor__overflow" onclick={(e) => e.stopPropagation()}>
					<button
						type="button"
						class="invoice-editor__btn invoice-editor__btn--overflow"
						aria-label="More actions"
						aria-expanded={showOverflowMenu}
						onclick={() => (showOverflowMenu = !showOverflowMenu)}
					>
						⋯
					</button>
					{#if showOverflowMenu}
						<ul class="invoice-editor__overflow-menu" role="menu">
							<li role="none">
								<button
									type="button"
									role="menuitem"
									class="invoice-editor__overflow-item"
									title="Update this invoice with the latest info from the job — who it's for, where the work was done, what's being billed, and when payment is due. Your invoice notes, discounts, and invoice date stay as you set them."
									onclick={handleRefreshFromJob}
								>
									Refresh from job
								</button>
							</li>
							<li role="none">
								<button
									type="button"
									role="menuitem"
									class="invoice-editor__overflow-item"
									disabled={isUploading}
									onclick={() => revisedFileInput?.click()}
								>
									Upload revised file
								</button>
							</li>
							<li role="none">
								<button
									type="button"
									role="menuitem"
									class="invoice-editor__overflow-item"
									disabled={isUploading}
									onclick={() => supportingFileInput?.click()}
								>
									Add attachments
								</button>
							</li>
							{#if hasPrimaryDocx && invoice.pbId}
								<li role="none">
									<button
										type="button"
										role="menuitem"
										class="invoice-editor__overflow-item"
										onclick={downloadPrimary}
									>
										Open invoice file
									</button>
								</li>
							{/if}
							{#if hasPrimaryDocx && isAdmin}
								<li role="none">
									<button
										type="button"
										role="menuitem"
										class="invoice-editor__overflow-item invoice-editor__overflow-item--danger"
										onclick={handleRemovePrimary}
									>
										Remove invoice file
									</button>
								</li>
							{/if}
							{#if isDev}
								<li role="none" class="invoice-editor__overflow-dev">
									<label class="invoice-editor__checkbox">
										<input type="checkbox" bind:checked={envelopePreview} />
										Envelope preview
									</label>
								</li>
							{/if}
						</ul>
					{/if}
				</div>
				<button type="button" class="invoice-editor__btn" onclick={onClose}>Close</button>
			</div>
		</div>
	</div>
{:else}
	<p class="invoice-editor__hint">Loading invoice…</p>
{/if}

<style>
	.invoice-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		color: var(--color-text);
		padding-bottom: var(--space-2);
	}

	.invoice-editor__accordion {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		overflow: hidden;
	}

	.invoice-editor__accordion--open {
		border-color: var(--color-border-strong);
	}

	.invoice-editor__accordion-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: none;
		background: var(--color-surface-alt);
		color: var(--color-text);
		font: inherit;
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		cursor: pointer;
		text-align: left;
	}

	.invoice-editor__accordion-head:hover {
		background: var(--color-surface);
	}

	.invoice-editor__accordion-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		border-radius: var(--radius-full);
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
		font-size: var(--font-size-xs);
		flex-shrink: 0;
	}

	.invoice-editor__accordion-label {
		flex: 1;
	}

	.invoice-editor__accordion-summary {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
	}

	.invoice-editor__accordion-chevron {
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
	}

	.invoice-editor__accordion-body {
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		border-top: 1px solid var(--color-border);
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

		.invoice-editor__accordion-body {
			padding: var(--space-2);
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
	.invoice-editor__invoice-discount input {
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

	.dark .invoice-editor__input[type='date']::-webkit-calendar-picker-indicator {
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

	.invoice-editor__section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
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

	.invoice-editor__totals-bar {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: var(--font-size-sm);
		color: var(--color-text);
		background: var(--color-surface-alt);
		border-top: 1px solid var(--color-border);
	}

	.invoice-editor__workflow {
		display: flex;
		align-items: center;
		gap: 0;
		padding: var(--space-2) 0;
		overflow-x: auto;
	}

	.invoice-editor__workflow-step {
		flex-shrink: 0;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-full);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		cursor: pointer;
		white-space: nowrap;
	}

	.invoice-editor__workflow-step--done {
		border-color: var(--color-primary);
		color: var(--color-primary-emphasis);
		background: var(--color-primary-soft);
	}

	.invoice-editor__workflow-step--current {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: white;
		font-weight: var(--font-weight-semibold);
	}

	.invoice-editor__workflow-line {
		width: 1rem;
		height: 2px;
		background: var(--color-border-strong);
		flex-shrink: 0;
	}

	.invoice-editor__workflow-line--done {
		background: var(--color-primary);
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

	.invoice-editor__meta,
	.invoice-editor__file-meta {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.invoice-editor__file-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding: var(--space-2);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
	}

	.invoice-editor__link-btn {
		border: none;
		background: none;
		color: var(--color-primary);
		font-size: var(--font-size-xs);
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
	}

	.invoice-editor__supporting-toggle {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--color-primary);
		font-size: var(--font-size-xs);
		cursor: pointer;
		text-decoration: underline;
		padding: 0;
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
		background: var(--color-surface-alt);
	}

	.invoice-editor__supporting li span {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-muted);
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

	.invoice-editor__hint {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		font-style: italic;
		margin: 0;
	}

	.invoice-editor__btn {
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		cursor: pointer;
		white-space: nowrap;
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

	.invoice-editor__btn--secondary {
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
		border-color: var(--color-primary);
	}

	.invoice-editor__btn--danger {
		border-color: var(--color-danger);
		color: var(--color-danger-emphasis, var(--color-danger));
	}

	.invoice-editor__btn--danger:hover:not(:disabled) {
		background: var(--color-danger-soft);
	}

	.invoice-editor__btn--overflow {
		min-width: 2.25rem;
		font-size: var(--font-size-lg);
		line-height: 1;
		padding: var(--space-1);
	}

	.invoice-editor__btn--generate {
		font-size: var(--font-size-sm);
		padding: var(--space-2) var(--space-4);
		font-weight: var(--font-weight-semibold);
	}

	.invoice-editor__footer {
		position: sticky;
		bottom: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3);
		margin: var(--space-1) calc(-1 * var(--space-3)) 0;
		background: var(--color-surface);
		border-top: 1px solid var(--color-border-strong);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
		z-index: 2;
	}

	.dark .invoice-editor__footer {
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.35);
	}

	@media (max-width: 768px) {
		.invoice-editor__footer {
			flex-direction: column;
			align-items: stretch;
			margin-left: calc(-1 * var(--space-2));
			margin-right: calc(-1 * var(--space-2));
			padding: var(--space-2);
		}

		.invoice-editor__footer-primary {
			flex-direction: column;
			width: 100%;
		}

		.invoice-editor__btn--generate {
			width: 100%;
		}

		.invoice-editor__footer-secondary {
			justify-content: space-between;
		}
	}

	.invoice-editor__footer-primary {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.invoice-editor__footer-secondary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.invoice-editor__overflow {
		position: relative;
	}

	.invoice-editor__overflow-menu {
		position: absolute;
		bottom: calc(100% + var(--space-1));
		right: 0;
		min-width: 11rem;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		z-index: var(--z-dropdown, 50);
	}

	.invoice-editor__overflow-item {
		display: block;
		width: 100%;
		padding: var(--space-2);
		border: none;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--color-text);
		font-size: var(--font-size-xs);
		text-align: left;
		cursor: pointer;
	}

	.invoice-editor__overflow-item:hover:not(:disabled) {
		background: var(--color-surface-alt);
	}

	.invoice-editor__overflow-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.invoice-editor__overflow-item--danger {
		color: var(--color-danger-emphasis, var(--color-danger));
	}

	.invoice-editor__overflow-dev {
		padding: var(--space-1) var(--space-2);
		border-top: 1px solid var(--color-border);
		margin-top: var(--space-1);
	}

	.invoice-editor__hidden-input {
		position: absolute;
		width: 0;
		height: 0;
		opacity: 0;
		pointer-events: none;
	}
</style>