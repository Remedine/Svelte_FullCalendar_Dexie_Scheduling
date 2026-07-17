<!-- Bulk import dry-run panel (Options → Import tab). -->
<script lang="ts">
	import { pb } from '$lib/db/pb';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		BULK_TEMPLATES,
		csvToBulkPayload,
		parseJsonToBulkPayload,
		runBulkDryRun,
		type BulkCommitResult,
		type BulkDryRunResult,
		type BulkEntity,
		type BulkTemplateId
	} from '$lib/bulk';
	import { auth } from '$lib/stores/auth.svelte';
	import { scheduleAppDataSync } from '$lib/db/pb';
	import { optionsStore } from '$lib/stores/options.svelte';

	type InputMode = 'paste' | 'file';
	type PackageMode = 'full' | BulkEntity;

	let inputMode = $state<InputMode>('paste');
	let packageMode = $state<PackageMode>('full');
	let pasteText = $state('');
	let fileName = $state('');
	let fileText = $state('');
	let fileIsCsv = $state(false);
	let loading = $state(false);
	let committing = $state(false);
	let result = $state<BulkDryRunResult | null>(null);
	let lastPayload = $state<Parameters<typeof runBulkDryRun>[0] | null>(null);
	let apiError = $state('');
	let filterErrorsOnly = $state(false);

	const templateIds = Object.keys(BULK_TEMPLATES) as BulkTemplateId[];

	const displayRows = $derived.by(() => {
		if (!result) return [];
		if (filterErrorsOnly) return result.rows.filter((r) => r.action === 'error');
		return result.rows;
	});

	const canCommit = $derived.by(() => {
		if (!result || !lastPayload) return false;
		if (result.dryRun === false) return false;
		const total =
			(lastPayload.clients?.length ?? 0) +
			(lastPayload.jobs?.length ?? 0) +
			(lastPayload.invoices?.length ?? 0);
		if (total === 0) return false;
		// Block commit if any entity has validation errors
		if (result.summary.totalError > 0) return false;
		return result.rows.some(
			(r) => r.action === 'would_create' || r.action === 'would_update'
		);
	});

	function downloadTemplate(id: BulkTemplateId) {
		const t = BULK_TEMPLATES[id];
		const blob = new Blob([t.content], { type: t.mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = t.filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		result = null;
		apiError = '';
		if (!file) {
			fileName = '';
			fileText = '';
			fileIsCsv = false;
			return;
		}
		fileName = file.name;
		fileIsCsv = file.name.toLowerCase().endsWith('.csv') || file.type.includes('csv');
		fileText = await file.text();
	}

	function buildPayloadFromLocal():
		| { ok: true; payload: Parameters<typeof runBulkDryRun>[0] }
		| { ok: false; error: string } {
		const text = inputMode === 'paste' ? pasteText : fileText;
		if (!text.trim()) {
			return { ok: false, error: 'Paste JSON or choose a file first' };
		}

		const entity: BulkEntity | undefined =
			packageMode === 'full' ? undefined : packageMode;

		if (inputMode === 'file' && fileIsCsv) {
			if (!entity) {
				return {
					ok: false,
					error: 'CSV files need a single entity selected (Clients, Jobs, or Invoices)'
				};
			}
			return { ok: true, payload: csvToBulkPayload(entity, text) };
		}

		const parsed = parseJsonToBulkPayload(text, entity);
		if (!parsed.ok) return { ok: false, error: parsed.error };
		return { ok: true, payload: parsed.payload };
	}

	/** Local dry-run (instant schema checks; no PocketBase match). */
	function runLocalPreview() {
		apiError = '';
		const built = buildPayloadFromLocal();
		if (!built.ok) {
			apiError = built.error;
			result = null;
			lastPayload = null;
			toast.error(built.error);
			return;
		}
		lastPayload = built.payload;
		result = runBulkDryRun(built.payload);
		if (result.payloadErrors.length) {
			toast.error(result.payloadErrors[0]);
		} else if (result.summary.totalError > 0) {
			toast.error(`${result.summary.totalError} row(s) with errors`);
		} else {
			toast.success(`Preview OK — ${result.summary.totalValid} valid row(s)`);
		}
	}

	/** Server dry-run (matches existing clients for create vs update). */
	async function runServerPreview() {
		apiError = '';
		loading = true;
		result = null;
		try {
			const built = buildPayloadFromLocal();
			if (!built.ok) {
				apiError = built.error;
				lastPayload = null;
				toast.error(built.error);
				return;
			}
			lastPayload = built.payload;

			const token = pb.authStore.token;
			if (!token) {
				apiError = 'Not signed in';
				toast.error('Not signed in');
				return;
			}

			const res = await fetch('/api/admin/bulk', {
				method: 'POST',
				headers: {
					Authorization: token,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ dryRun: true, ...built.payload })
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				apiError = data.error || `Request failed (${res.status})`;
				toast.error(apiError);
				return;
			}

			result = data as BulkDryRunResult;
			if (result.payloadErrors?.length) {
				toast.error(result.payloadErrors[0]);
			} else if (result.summary.totalError > 0) {
				toast.error(`${result.summary.totalError} row(s) with errors`);
			} else {
				const { clients: c, jobs: j, invoices: inv } = result.summary;
				toast.success(
					`Preview — C ${c.wouldCreate}/${c.wouldUpdate}, J ${j.wouldCreate}/${j.wouldUpdate}, I ${inv.wouldCreate}/${inv.wouldUpdate} (create/update)`
				);
			}
		} catch (err) {
			apiError = err instanceof Error ? err.message : 'Preview failed';
			toast.error(apiError);
		} finally {
			loading = false;
		}
	}

	/** Write clients → jobs → invoices to PocketBase. */
	async function commitAll() {
		apiError = '';
		if (!lastPayload) {
			toast.error('Nothing to commit');
			return;
		}
		if (!canCommit) {
			toast.error('Run a successful API preview first and fix any errors');
			return;
		}

		const nc = lastPayload.clients?.length ?? 0;
		const nj = lastPayload.jobs?.length ?? 0;
		const ni = lastPayload.invoices?.length ?? 0;
		const ok = confirm(
			`Commit to the live database?\n\n` +
				`• Clients: ${nc}\n• Jobs: ${nj}\n• Invoices: ${ni}\n\n` +
				`Matching externalId / email / invoiceNumber will update existing records.`
		);
		if (!ok) return;

		committing = true;
		try {
			const token = pb.authStore.token;
			if (!token) {
				apiError = 'Not signed in';
				toast.error('Not signed in');
				return;
			}

			const res = await fetch('/api/admin/bulk', {
				method: 'POST',
				headers: {
					Authorization: token,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ dryRun: false, ...lastPayload })
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				apiError = data.error || `Commit failed (${res.status})`;
				toast.error(apiError);
				return;
			}

			result = data as BulkDryRunResult;
			const commit = data as BulkCommitResult;
			const { clients: c, jobs: j, invoices: inv } = result.summary;
			const errTotal = c.error + j.error + inv.error;
			let msg =
				`Committed — clients ${c.created}/${c.updated}, ` +
				`jobs ${j.created}/${j.updated}, invoices ${inv.created}/${inv.updated} (created/updated)`;
			if (commit.invoiceCounter?.applied) {
				msg += ` · next invoice # set to ${commit.invoiceCounter.nextInvoiceNumber}`;
			}
			if (errTotal > 0) toast.error(`${msg}; ${errTotal} error(s)`);
			else toast.success(msg);

			// Refresh local Dexie + options so imported rows appear without a full reload
			try {
				scheduleAppDataSync(auth.currentUser, 'bulk-import', true);
				void optionsStore.pullFromPB();
			} catch {
				/* non-fatal */
			}
		} catch (err) {
			apiError = err instanceof Error ? err.message : 'Commit failed';
			toast.error(apiError);
		} finally {
			committing = false;
		}
	}

	function actionLabel(action: string): string {
		switch (action) {
			case 'would_create':
				return 'Would create';
			case 'would_update':
				return 'Would update';
			case 'created':
				return 'Created';
			case 'updated':
				return 'Updated';
			case 'deferred':
				return 'Deferred';
			case 'error':
				return 'Error';
			default:
				return action;
		}
	}
</script>

<div class="bulk-import">
		<header class="bulk-import__header">
			<h2 class="bulk-import__title">Bulk import</h2>
			<p class="bulk-import__lede">
				Upload CSV or JSON, preview against the database, then <strong>commit</strong> clients,
				jobs, and invoices (in that order). Re-uploads with the same
				<code>externalId</code> / invoice number update existing rows.
			</p>
		</header>

		<section class="bulk-import__templates" aria-label="Templates">
			<h2 class="bulk-import__section-title">Templates</h2>
			<p class="bulk-import__hint">
				Download a template, fill in your rows, then paste or upload here.
			</p>
			<div class="bulk-import__template-list">
				{#each templateIds as id (id)}
					<button
						type="button"
						class="bulk-import__template-btn"
						onclick={() => downloadTemplate(id)}
					>
						{BULK_TEMPLATES[id].label}
					</button>
				{/each}
			</div>
		</section>

		<section class="bulk-import__input" aria-label="Input">
			<h2 class="bulk-import__section-title">Input</h2>

			<div class="bulk-import__field-row">
				<label class="bulk-import__label" for="bulk-package-mode">Package type</label>
				<select
					id="bulk-package-mode"
					class="bulk-import__select"
					bind:value={packageMode}
				>
					<option value="full">Full JSON package (clients + jobs + invoices)</option>
					<option value="clients">Clients only</option>
					<option value="jobs">Jobs only</option>
					<option value="invoices">Invoices only</option>
				</select>
			</div>

			<div class="bulk-import__mode-tabs" role="tablist">
				<button
					type="button"
					role="tab"
					class="bulk-import__mode-tab"
					class:bulk-import__mode-tab--active={inputMode === 'paste'}
					aria-selected={inputMode === 'paste'}
					onclick={() => (inputMode = 'paste')}
				>
					Paste JSON
				</button>
				<button
					type="button"
					role="tab"
					class="bulk-import__mode-tab"
					class:bulk-import__mode-tab--active={inputMode === 'file'}
					aria-selected={inputMode === 'file'}
					onclick={() => (inputMode = 'file')}
				>
					Upload file
				</button>
			</div>

			{#if inputMode === 'paste'}
				<label class="bulk-import__label" for="bulk-paste">JSON</label>
				<textarea
					id="bulk-paste"
					class="bulk-import__textarea"
					rows="14"
					placeholder={'{\n  "clients": [ ... ]\n}'}
					bind:value={pasteText}
				></textarea>
			{:else}
				<label class="bulk-import__label" for="bulk-file">CSV or JSON file</label>
				<input
					id="bulk-file"
					class="bulk-import__file"
					type="file"
					accept=".json,.csv,application/json,text/csv"
					onchange={onFileChange}
				/>
				{#if fileName}
					<p class="bulk-import__file-name">
						{fileName}{fileIsCsv ? ' (CSV)' : ' (JSON)'}
					</p>
				{/if}
			{/if}

			<div class="bulk-import__actions">
				<button
					type="button"
					class="bulk-import__btn bulk-import__btn--secondary"
					onclick={runLocalPreview}
					disabled={loading || committing}
				>
					Preview locally
				</button>
				<button
					type="button"
					class="bulk-import__btn bulk-import__btn--primary"
					onclick={runServerPreview}
					disabled={loading || committing}
				>
					{loading ? 'Running…' : 'Preview via API'}
				</button>
				<button
					type="button"
					class="bulk-import__btn bulk-import__btn--primary"
					onclick={commitAll}
					disabled={!canCommit || loading || committing}
					title={canCommit
						? 'Write clients, jobs, and invoices to PocketBase'
						: 'Run Preview via API first and fix errors'}
				>
					{committing ? 'Committing…' : 'Commit'}
				</button>
			</div>

			{#if apiError}
				<p class="bulk-import__error" role="alert">{apiError}</p>
			{/if}
		</section>

		{#if result}
			<section class="bulk-import__results" aria-label="Dry-run results">
				<h2 class="bulk-import__section-title">Dry-run results</h2>

				{#if result.payloadErrors.length}
					<ul class="bulk-import__payload-errors">
						{#each result.payloadErrors as err (err)}
							<li>{err}</li>
						{/each}
					</ul>
				{/if}

				<div class="bulk-import__summary">
					<div class="bulk-import__stat">
						<span class="bulk-import__stat-label">Valid</span>
						<span class="bulk-import__stat-value bulk-import__stat-value--ok"
							>{result.summary.totalValid}</span
						>
					</div>
					<div class="bulk-import__stat">
						<span class="bulk-import__stat-label">Errors</span>
						<span class="bulk-import__stat-value bulk-import__stat-value--err"
							>{result.summary.totalError}</span
						>
					</div>
					<div class="bulk-import__stat">
						<span class="bulk-import__stat-label">Clients</span>
						<span class="bulk-import__stat-value"
							>{result.summary.clients.valid}/{result.summary.clients.total}</span
						>
					</div>
					<div class="bulk-import__stat">
						<span class="bulk-import__stat-label">Jobs</span>
						<span class="bulk-import__stat-value"
							>{result.summary.jobs.valid}/{result.summary.jobs.total}</span
						>
					</div>
					<div class="bulk-import__stat">
						<span class="bulk-import__stat-label">Invoices</span>
						<span class="bulk-import__stat-value"
							>{result.summary.invoices.valid}/{result.summary.invoices.total}</span
						>
					</div>
				</div>

				<p class="bulk-import__commit-note">
					{#if result.dryRun === false}
						Commit finished. This device is refreshing data from the server; other devices will
						pick up changes on their next sync.
						{#if 'invoiceCounter' in result && result.invoiceCounter?.applied}
							Invoice counter advanced to
							<strong>{result.invoiceCounter.nextInvoiceNumber}</strong>
							for {result.invoiceCounter.invoiceNumberYear}.
						{/if}
					{:else}
						Use <strong>Commit</strong> after a clean API preview. Writes clients, then jobs, then
						invoices. Matching <code>externalId</code>, email, or invoice number updates existing
						records. Imported <code>PREFIX-YEAR-####</code> numbers bump the next-invoice counter.
					{/if}
				</p>

				<label class="bulk-import__filter">
					<input type="checkbox" bind:checked={filterErrorsOnly} />
					Show errors only
				</label>

				<div class="bulk-import__table-wrap">
					<table class="bulk-import__table">
						<thead>
							<tr>
								<th>Entity</th>
								<th>#</th>
								<th>Action</th>
								<th>Key</th>
								<th>Summary</th>
								<th>Errors</th>
							</tr>
						</thead>
						<tbody>
							{#each displayRows as row (`${row.entity}-${row.index}`)}
								<tr
									class:bulk-import__row--error={row.action === 'error'}
									class:bulk-import__row--ok={row.action === 'would_create' ||
										row.action === 'would_update' ||
										row.action === 'created' ||
										row.action === 'updated'}
									class:bulk-import__row--deferred={row.action === 'deferred'}
								>
									<td>{row.entity}</td>
									<td>{row.index}</td>
									<td>
										<span
											class="bulk-import__badge"
											class:bulk-import__badge--ok={row.action === 'would_create' ||
												row.action === 'created'}
											class:bulk-import__badge--upd={row.action === 'would_update' ||
												row.action === 'updated'}
											class:bulk-import__badge--def={row.action === 'deferred'}
											class:bulk-import__badge--err={row.action === 'error'}
										>
											{actionLabel(row.action)}
										</span>
									</td>
									<td class="bulk-import__mono">{row.key}</td>
									<td>{row.summary}</td>
									<td>
										{#if row.errors?.length}
											<ul class="bulk-import__row-errors">
												{#each row.errors as e (e)}
													<li>{e}</li>
												{/each}
											</ul>
										{:else}
											—
										{/if}
									</td>
								</tr>
							{:else}
								<tr>
									<td colspan="6" class="bulk-import__empty">No rows to show</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}
</div>

<style>
	.bulk-import {
		max-width: 1100px;
		margin: 0;
		padding: 0 0 1rem;
	}

	.bulk-import__header {
		margin-bottom: 1.5rem;
	}

	.bulk-import__title {
		margin: 0 0 0.35rem;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.bulk-import__lede {
		margin: 0;
		color: var(--color-text-muted, #64748b);
		line-height: 1.5;
		max-width: 52rem;
	}

	.bulk-import__section-title {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
		font-weight: 600;
	}

	.bulk-import__hint {
		margin: 0 0 0.75rem;
		font-size: 0.9rem;
		color: var(--color-text-muted, #64748b);
	}

	.bulk-import__templates,
	.bulk-import__input,
	.bulk-import__results {
		margin-bottom: 1.75rem;
		padding: 1rem 1.1rem;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
		color: var(--color-text);
	}

	.bulk-import__template-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* Shared interactive chrome — all tokens flip with light/dark theme */
	.bulk-import__template-btn,
	.bulk-import__mode-tab,
	.bulk-import__btn {
		font: inherit;
		cursor: pointer;
		transition:
			background var(--transition-fast, 0.15s ease),
			border-color var(--transition-fast, 0.15s ease),
			color var(--transition-fast, 0.15s ease);
	}

	.bulk-import__template-btn {
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
		border-radius: 6px;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface-alt);
		color: var(--color-text);
	}

	.bulk-import__template-btn:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.bulk-import__field-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 0.85rem;
	}

	.bulk-import__label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.bulk-import__select,
	.bulk-import__textarea,
	.bulk-import__file {
		width: 100%;
		font: inherit;
	}

	.bulk-import__select {
		padding: 0.45rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.bulk-import__textarea {
		padding: 0.65rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--color-border-strong);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.82rem;
		line-height: 1.45;
		resize: vertical;
		background: var(--color-surface);
		color: var(--color-text);
	}

	.bulk-import__mode-tabs {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}

	.bulk-import__mode-tab {
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		border: 1px solid var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 0.9rem;
	}

	.bulk-import__mode-tab:hover:not(:disabled) {
		background: var(--color-surface-alt);
		border-color: var(--color-primary);
	}

	.bulk-import__mode-tab--active {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
	}

	.bulk-import__mode-tab--active:hover:not(:disabled) {
		background: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		color: #fff;
	}

	.bulk-import__file-name {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.bulk-import__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 1rem;
	}

	.bulk-import__btn {
		padding: 0.55rem 1rem;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.9rem;
		border: 1px solid transparent;
		min-height: 40px;
	}

	.bulk-import__btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.bulk-import__btn--primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: #fff;
	}

	.bulk-import__btn--primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		color: #fff;
	}

	.bulk-import__btn--secondary {
		background: var(--color-surface-alt);
		border-color: var(--color-border-strong);
		color: var(--color-text);
	}

	.bulk-import__btn--secondary:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.bulk-import__error {
		margin: 0.75rem 0 0;
		color: var(--color-danger-emphasis);
		font-size: 0.9rem;
	}

	.bulk-import__payload-errors {
		margin: 0 0 1rem;
		padding: 0.65rem 0.85rem;
		background: var(--color-danger-soft);
		border-radius: 8px;
		color: var(--color-danger-emphasis);
		font-size: 0.9rem;
	}

	.bulk-import__summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.85rem;
	}

	.bulk-import__stat {
		min-width: 5.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: 8px;
		background: var(--color-surface-alt);
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.bulk-import__stat-label {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.bulk-import__stat-value {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--color-text-strong);
	}

	.bulk-import__stat-value--ok {
		color: var(--color-success);
	}

	.bulk-import__stat-value--err {
		color: var(--color-danger-emphasis);
	}

	.bulk-import__commit-note {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.bulk-import__filter {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		margin-bottom: 0.65rem;
		cursor: pointer;
		color: var(--color-text);
	}

	.bulk-import__table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
	}

	.bulk-import__table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.bulk-import__table th,
	.bulk-import__table td {
		padding: 0.5rem 0.65rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}

	.bulk-import__table th {
		background: var(--color-surface-alt);
		color: var(--color-text);
		font-weight: 600;
		white-space: nowrap;
	}

	.bulk-import__row--error {
		background: var(--color-danger-soft);
	}

	.bulk-import__mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.8rem;
	}

	.bulk-import__badge {
		display: inline-block;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--color-surface-alt);
		color: var(--color-text);
		border: 1px solid var(--color-border);
	}

	.bulk-import__badge--ok {
		background: var(--color-success-soft);
		color: var(--color-success);
		border-color: transparent;
	}

	.bulk-import__badge--upd {
		background: var(--color-primary-soft);
		color: var(--color-primary);
		border-color: transparent;
	}

	.bulk-import__badge--def {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}

	.bulk-import__badge--err {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
		border-color: transparent;
	}

	.bulk-import__row--deferred {
		opacity: 0.85;
	}

	.bulk-import__row-errors {
		margin: 0;
		padding-left: 1.1rem;
		color: var(--color-danger-emphasis);
	}

	.bulk-import__empty {
		text-align: center;
		color: var(--color-text-muted);
		padding: 1rem !important;
	}

	.bulk-import__title,
	.bulk-import__section-title {
		color: var(--color-text-strong);
	}

	.bulk-import__lede,
	.bulk-import__hint {
		color: var(--color-text-muted);
	}
</style>
