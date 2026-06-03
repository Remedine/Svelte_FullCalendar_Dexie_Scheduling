<!-- src/lib/components/Toast.svelte -->
<script>
	import { toast } from '$lib/stores/toast.svelte.ts';

	let toastContainer;
</script>

<div class="toast-container" bind:this={toastContainer}>
	{#each toast.toasts as t (t.id)}
		<div class="toast toast--{t.type}">
			<span class="toast__message">{t.message}</span>
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
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10000;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 92%;
		max-width: 420px;
	}

	.toast {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.1rem 1.25rem;
		border-radius: 12px;
		box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.15);
		animation: slideIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
		font-size: 1rem;
		line-height: 1.4;
	}

	.toast--success { background: #10b981; color: white; }
	.toast--error   { background: #ef4444; color: white; }
	.toast--info    { background: #3b82f6; color: white; }

	.toast__message {
		flex: 1;
		margin-right: 1rem;
	}

	.toast__close {
		background: none;
		border: none;
		color: inherit;
		font-size: 1.45rem;
		padding: 0.25rem 0.5rem;
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
			transform: translate(-50%, -30px) scale(0.95);
			opacity: 0;
		}
		to {
			transform: translate(-50%, 0) scale(1);
			opacity: 1;
		}
	}

	/* Mobile-first enhancements */
	@media (max-width: 640px) {
		.toast-container {
			top: 0.85rem;
			width: 94%;
			max-width: none;
		}

		.toast {
			padding: 1.25rem 1.35rem;
			border-radius: 14px;
			font-size: 1.05rem;
		}
	}
</style>