<!-- src/lib/components/Toast.svelte -->
<script>
	import { toast } from '$lib/stores/toast.svelte.ts';

	function handleAction(t) {
		t.onAction?.();
		toast.dismiss(t.id);
	}
</script>

<div class="toast-container">
	{#each toast.toasts as t (t.id)}
		<div class="toast toast--{t.type}">
			<div class="toast__message">
				{#if t.actionLabel}
					<button type="button" class="toast__action" onclick={() => handleAction(t)}>
						{t.actionLabel}
					</button>
				{:else}
					{t.message}
				{/if}
			</div>
			<button
				class="toast__close"
				onclick={() => toast.dismiss(t.id)}
				aria-label="Close notification"
			>
				✕
			</button>
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		top: var(--space-4);
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		z-index: var(--z-toast);
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
		animation: slideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
		font-size: var(--font-size-base);
		line-height: var(--line-height-normal);
		min-width: 280px;
		max-width: 92vw;
		pointer-events: auto;
		background: var(--color-primary);
		color: white;
	}

	.toast--success {
		background: var(--color-success);
	}
	.toast--error {
		background: var(--color-danger);
	}
	.toast--info {
		background: var(--color-primary);
	}

	.toast__message {
		flex: 1;
		margin-right: var(--space-4);
	}

	.toast__action {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		font-weight: var(--font-weight-semibold);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
		padding: 0;
		text-align: left;
	}

	.toast__action:hover {
		opacity: 0.92;
	}

	.toast__close {
		background: none;
		border: none;
		color: inherit;
		font-size: 1.45rem;
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
		opacity: 0.85;
		min-width: 36px;
		min-height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.toast__close:hover {
		opacity: 1;
	}

	@keyframes slideIn {
		from {
			transform: translateY(-20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@media (max-width: 640px) {
		.toast {
			padding: var(--space-5) var(--space-5);
			font-size: var(--font-size-lg);
			min-width: 260px;
		}
	}
</style>