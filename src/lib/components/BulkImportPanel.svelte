<!-- Bulk import dry-run panel (Options → Import tab). -->
<script lang="ts">
	import { pb } from '$lib/db/pb';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		BULK_TEMPLATES,
		csvToBulkPayload,
		parseJsonToBulkPayload,
		runBulkDryRun,
		type BulkDryRunResult,
		type BulkEntity,
		type BulkTemplateId
	} from '$lib/bulk';

	type InputMode = 'paste' | 'file';
	type PackageMode = 'full' | BulkEntity;

	let inputMode = $state<InputMode>('paste');
	let packageMode = $state<PackageMode>('full');
	let pasteText = $state('');
	let fileName = $state('');
	let fileText = $state('');
	let fileIsCsv = $state(false);
	let loading = $state(false);
	let result = $state<BulkDryRunResult | null>(null);
	let apiError = $state('');
	let filterErrorsOnly = $state(false);

	const templateIds = Object.keys(BULK_TEMPLATES) as BulkTemplateId[];

	const displayRows = $derived.by(() => {
		if (!result) return [];
		if (filterErrorsOnly) return result.rows.filter((r) => r.action === 'error');
		return result.rows;
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

	/** Local dry-run (instant) — same logic as the API. */
	function runLocalPreview() {
		apiError = '';
		const built = buildPayloadFromLocal();
		if (!built.ok) {
			apiError = built.error;
			result = null;
			toast.error(built.error);
			return;
		}
		result = runBulkDryRun(built.payload);
		if (result.payloadErrors.length) {
			toast.error(result.payloadErrors[0]);
		} else if (result.summary.totalError > 0) {
			toast.error(`${result.summary.totalError} row(s) with errors`);
		} else {
			toast.success(`Preview OK — ${result.summary.totalValid} valid row(s)`);
		}
	}

	/** Server dry-run (auth + same validator as production will use). */
	async function runServerPreview() {
		apiError = '';
		loading = true;
		result = null;
		try {
			const built = buildPayloadFromLocal();
			if (!built.ok) {
				apiError = built.error;
				toast.error(built.error);
				return;
			}

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
				toast.success(`Server preview OK — ${result.summary.totalValid} valid row(s)`);
			}
		} catch (err) {
			apiError = err instanceof Error ? err.message : 'Preview failed';
			toast.error(apiError);
		} finally {
			loading = false;
		}
	}

	function actionLabel(action: string): string {
		if (action === 'would_create') return 'Would create';
		if (action === 'error') return 'Error';
		return action;
	}
</script>

<div class="bulk-import">
		<header class="bulk-import__header">
			<h2 class="bulk-import__title">Bulk import</h2>
			<p class="bulk-import__lede">
				Validate a CSV or JSON package before any data is written. Commit (write to the database)
				is not available yet — this page is <strong>dry-run only</strong>.
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
					disabled={loading}
				>
					Preview locally
				</button>
				<button
					type="button"
					class="bulk-import__btn bulk-import__btn--primary"
					onclick={runServerPreview}
					disabled={loading}
				>
					{loading ? 'Running…' : 'Preview via API'}
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
					Commit not available yet (slice 1). When enabled, valid rows will write to PocketBase.
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
									class:bulk-import__row--ok={row.action === 'would_create'}
								>
									<td>{row.entity}</td>
									<td>{row.index}</td>
									<td>
										<span
											class="bulk-import__badge"
											class:bulk-import__badge--ok={row.action === 'would_create'}
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
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 10px;
		background: var(--color-surface, #fff);
	}

	.bulk-import__template-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.bulk-import__template-btn {
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
		border-radius: 6px;
		border: 1px solid var(--color-border, #cbd5e1);
		background: var(--color-surface-2, #f8fafc);
		cursor: pointer;
	}

	.bulk-import__template-btn:hover {
		border-color: var(--color-primary, #2563eb);
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
		border: 1px solid var(--color-border, #cbd5e1);
		background: var(--color-surface, #fff);
	}

	.bulk-import__textarea {
		padding: 0.65rem 0.75rem;
		border-radius: 8px;
		border: 1px solid var(--color-border, #cbd5e1);
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.82rem;
		line-height: 1.45;
		resize: vertical;
		background: var(--color-surface, #fff);
		color: inherit;
	}

	.bulk-import__mode-tabs {
		display: flex;
		gap: 0.35rem;
		margin-bottom: 0.75rem;
	}

	.bulk-import__mode-tab {
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		border: 1px solid var(--color-border, #cbd5e1);
		background: transparent;
		cursor: pointer;
		font-size: 0.9rem;
	}

	.bulk-import__mode-tab--active {
		background: var(--color-primary, #2563eb);
		border-color: var(--color-primary, #2563eb);
		color: #fff;
	}

	.bulk-import__file-name {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
		color: var(--color-text-muted, #64748b);
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
		cursor: pointer;
		border: 1px solid transparent;
	}

	.bulk-import__btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.bulk-import__btn--primary {
		background: var(--color-primary, #2563eb);
		color: #fff;
	}

	.bulk-import__btn--secondary {
		background: var(--color-surface-2, #f1f5f9);
		border-color: var(--color-border, #cbd5e1);
		color: inherit;
	}

	.bulk-import__error {
		margin: 0.75rem 0 0;
		color: var(--color-danger, #b91c1c);
		font-size: 0.9rem;
	}

	.bulk-import__payload-errors {
		margin: 0 0 1rem;
		padding: 0.65rem 0.85rem;
		background: #fef2f2;
		border-radius: 8px;
		color: #991b1b;
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
		background: var(--color-surface-2, #f8fafc);
		border: 1px solid var(--color-border, #e2e8f0);
	}

	.bulk-import__stat-label {
		display: block;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted, #64748b);
	}

	.bulk-import__stat-value {
		font-size: 1.15rem;
		font-weight: 700;
	}

	.bulk-import__stat-value--ok {
		color: #15803d;
	}

	.bulk-import__stat-value--err {
		color: #b91c1c;
	}

	.bulk-import__commit-note {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
		color: var(--color-text-muted, #64748b);
	}

	.bulk-import__filter {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		margin-bottom: 0.65rem;
		cursor: pointer;
	}

	.bulk-import__table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 8px;
	}

	.bulk-import__table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.bulk-import__table th,
	.bulk-import__table td {
		padding: 0.5rem 0.65rem;
		text-align: left;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
		vertical-align: top;
	}

	.bulk-import__table th {
		background: var(--color-surface-2, #f8fafc);
		font-weight: 600;
		white-space: nowrap;
	}

	.bulk-import__row--error {
		background: #fff7f7;
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
		background: #e2e8f0;
	}

	.bulk-import__badge--ok {
		background: #dcfce7;
		color: #166534;
	}

	.bulk-import__badge--err {
		background: #fee2e2;
		color: #991b1b;
	}

	.bulk-import__row-errors {
		margin: 0;
		padding-left: 1.1rem;
		color: #991b1b;
	}

	.bulk-import__empty {
		text-align: center;
		color: var(--color-text-muted, #64748b);
		padding: 1rem !important;
	}

	:global([data-theme='dark']) .bulk-import__templates,
	:global([data-theme='dark']) .bulk-import__input,
	:global([data-theme='dark']) .bulk-import__results {
		background: var(--color-surface, #1e293b);
		border-color: var(--color-border, #334155);
	}

	:global([data-theme='dark']) .bulk-import__row--error {
		background: rgba(185, 28, 28, 0.15);
	}
</style>
