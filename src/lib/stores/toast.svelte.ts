// src/lib/stores/toast.svelte.ts 
import { browser } from '$app/environment';

export const toast = $state({
	toasts: [],

	show(message, type = 'success', duration = 4500) {
		if (!browser) return;

		const id = Date.now() + Math.random();

		this.toasts = [...this.toasts, {
			id,
			message,
			type
		}];

		if (duration > 0) {
			setTimeout(() => {
				this.dismiss(id);
			}, duration);
		}
	},

	success(message, duration = 4000) {
		this.show(message, 'success', duration);
	},

	error(message, duration = 6000) {
		this.show(message, 'error', duration);
	},

	info(message, duration = 4500) {
		this.show(message, 'info', duration);
	},

	dismiss(id) {
		this.toasts = this.toasts.filter(t => t.id !== id);
	},

	clearAll() {
		this.toasts = [];
	}
});