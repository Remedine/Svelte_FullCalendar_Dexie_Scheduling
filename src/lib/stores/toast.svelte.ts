// src/lib/stores/toast.svelte.ts
import { browser } from '$app/environment';

export interface ToastItem {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
}

export const toast = $state({
	toasts: [] as ToastItem[],

	show(message: string, type: 'success' | 'error' | 'info' = 'success', duration = 4500) {
		if (!browser) return;

		const id = Date.now() + Math.random();

		this.toasts = [
			...this.toasts,
			{
				id,
				message,
				type
			}
		];

		if (duration > 0) {
			setTimeout(() => {
				this.dismiss(id);
			}, duration);
		}

		return id;
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
