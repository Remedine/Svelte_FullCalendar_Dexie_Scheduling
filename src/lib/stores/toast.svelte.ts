// src/lib/stores/toast.svelte.ts
import { browser } from '$app/environment';

export interface ToastItem {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
	actionLabel?: string;
	onAction?: () => void;
}

type CountdownHandles = {
	interval?: ReturnType<typeof setInterval>;
	timeout?: ReturnType<typeof setTimeout>;
};

const countdownHandles = new Map<number, CountdownHandles>();

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

	update(id: number, message: string) {
		this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, message } : t));
	},

	/** Long-running notice with a live seconds countdown; auto-dismisses after totalSeconds. */
	showCountdown(
		message: string,
		totalSeconds: number,
		opts?: {
			type?: 'success' | 'error' | 'info';
			doneMessage?: string;
		}
	) {
		if (!browser) return;

		const type = opts?.type ?? 'info';
		const doneMessage = opts?.doneMessage ?? `${message} — ready now.`;
		let remaining = totalSeconds;

		const id = this.show(`${message} (${remaining}s remaining)`, type, 0);

		const interval = setInterval(() => {
			remaining -= 1;
			if (remaining <= 0) {
				clearInterval(interval);
				this.update(id, doneMessage);
				const timeout = setTimeout(() => this.dismiss(id), 5000);
				countdownHandles.set(id, { timeout });
				return;
			}
			this.update(id, `${message} (${remaining}s remaining)`);
		}, 1000);

		countdownHandles.set(id, { interval });
		return id;
	},

	dismiss(id: number) {
		const handles = countdownHandles.get(id);
		if (handles) {
			if (handles.interval) clearInterval(handles.interval);
			if (handles.timeout) clearTimeout(handles.timeout);
			countdownHandles.delete(id);
		}
		this.toasts = this.toasts.filter((t) => t.id !== id);
	},

	clearAll() {
		for (const id of countdownHandles.keys()) {
			this.dismiss(id);
		}
		this.toasts = [];
	}
});
