// src/lib/stores/toast.svelte.ts
import { browser } from '$app/environment';

export interface ToastItem {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
	actionLabel?: string;
	onAction?: () => void;
}

export const toast = $state({
	toasts: [] as ToastItem[],

	show(
		message: string,
		type: 'success' | 'error' | 'info' = 'success',
		duration = 4500,
		opts?: { actionLabel?: string; onAction?: () => void }
	) {
		if (!browser) return;

		const id = Date.now() + Math.random();

		this.toasts = [
			...this.toasts,
			{
				id,
				message,
				type,
				actionLabel: opts?.actionLabel,
				onAction: opts?.onAction
			}
		];

		if (duration > 0) {
			setTimeout(() => {
				this.dismiss(id);
			}, duration);
		}

		return id;
	},

	/** Actionable toast (e.g. post-login quick PIN prompt). Default 5s auto-dismiss. */
	showWithAction(
		actionLabel: string,
		onAction: () => void,
		duration = 5000,
		type: 'success' | 'error' | 'info' = 'info'
	) {
		return this.show('', type, duration, { actionLabel, onAction });
	},

	success(message: string, duration = 4000) {
		this.show(message, 'success', duration);
	},

	error(message: string, duration = 6000) {
		this.show(message, 'error', duration);
	},

	info(message: string, duration = 4500) {
		this.show(message, 'info', duration);
	},

	dismiss(id: number) {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	},

	clearAll() {
		this.toasts = [];
	}
});
