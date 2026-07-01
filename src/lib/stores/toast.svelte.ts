// src/lib/stores/toast.svelte.ts
import { browser } from '$app/environment';

export const RESTORE_COUNTDOWN_KEY = 'ccw-restore-countdown';

export interface ToastCountdown {
	baseMessage: string;
	doneMessage: string;
	endsAt: number;
	dismissAt: number;
}

export interface ToastItem {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
	actionLabel?: string;
	onAction?: () => void;
	countdown?: ToastCountdown;
}

type CountdownHandles = {
	interval?: ReturnType<typeof setInterval>;
	timeout?: ReturnType<typeof setTimeout>;
};

const countdownHandles = new Map<number, CountdownHandles>();

function countdownMessage(c: ToastCountdown): string {
	const remaining = Math.max(0, Math.ceil((c.endsAt - Date.now()) / 1000));
	if (remaining <= 0) return c.doneMessage;
	return `${c.baseMessage} (${remaining}s remaining)`;
}

function persistRestoreCountdown(
	id: number,
	type: ToastItem['type'],
	countdown: ToastCountdown
) {
	try {
		sessionStorage.setItem(
			RESTORE_COUNTDOWN_KEY,
			JSON.stringify({ id, type, countdown })
		);
	} catch {
		/* ignore quota / private mode */
	}
}

function clearRestoreCountdownPersistence() {
	try {
		sessionStorage.removeItem(RESTORE_COUNTDOWN_KEY);
	} catch {
		/* ignore */
	}
}

export function isRestoreCountdownActive(): boolean {
	if (!browser) return false;
	try {
		const raw = sessionStorage.getItem(RESTORE_COUNTDOWN_KEY);
		if (!raw) return false;
		const data = JSON.parse(raw) as { countdown?: ToastCountdown };
		return Boolean(data.countdown && Date.now() < data.countdown.dismissAt);
	} catch {
		return false;
	}
}

export const toast = $state({
	toasts: [] as ToastItem[],

	show(
		message: string,
		type: 'success' | 'error' | 'info' = 'success',
		duration = 4500,
		opts?: { actionLabel?: string; onAction?: () => void }
	): number | undefined {
		if (!browser) return undefined;

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

	attachCountdown(id: number, countdown: ToastCountdown) {
		this.toasts = this.toasts.map((t) =>
			t.id === id ? { ...t, countdown, message: countdownMessage(countdown) } : t
		);
	},

	startCountdownTicker(id: number) {
		if (countdownHandles.has(id)) return;

		const tick = () => {
			const item = this.toasts.find((t) => t.id === id);
			const c = item?.countdown;
			if (!item || !c) {
				this.stopCountdownTicker(id);
				return;
			}

			if (Date.now() >= c.dismissAt) {
				this.dismiss(id);
				return;
			}

			const next = countdownMessage(c);
			if (item.message !== next) {
				this.update(id, next);
			}
		};

		tick();
		const interval = setInterval(tick, 1000);
		countdownHandles.set(id, { interval });
	},

	stopCountdownTicker(id: number) {
		const handles = countdownHandles.get(id);
		if (handles?.interval) clearInterval(handles.interval);
		if (handles?.timeout) clearTimeout(handles.timeout);
		countdownHandles.delete(id);
	},

	/** Long-running notice with a live seconds countdown; survives PB restart page reloads. */
	showCountdown(
		message: string,
		totalSeconds: number,
		opts?: {
			type?: 'success' | 'error' | 'info';
			doneMessage?: string;
			persistKey?: string;
		}
	): number | undefined {
		if (!browser) return undefined;

		const type = opts?.type ?? 'info';
		const doneMessage = opts?.doneMessage ?? `${message} — ready now.`;
		const now = Date.now();
		const countdown: ToastCountdown = {
			baseMessage: message,
			doneMessage,
			endsAt: now + totalSeconds * 1000,
			dismissAt: now + totalSeconds * 1000 + 5000
		};

		const id = this.show(countdownMessage(countdown), type, 0);
		if (id == null) return undefined;

		this.attachCountdown(id, countdown);
		this.startCountdownTicker(id);

		if (opts?.persistKey === RESTORE_COUNTDOWN_KEY) {
			persistRestoreCountdown(id, type, countdown);
		}

		return id;
	},

	restorePersistedCountdown(): void {
		if (!browser) return;
		try {
			const raw = sessionStorage.getItem(RESTORE_COUNTDOWN_KEY);
			if (!raw) return;

			const data = JSON.parse(raw) as {
				id?: number;
				type?: ToastItem['type'];
				countdown?: ToastCountdown;
			};

			if (!data.countdown || Date.now() >= data.countdown.dismissAt) {
				clearRestoreCountdownPersistence();
				return;
			}

			if (this.toasts.some((t) => t.countdown?.endsAt === data.countdown!.endsAt)) {
				return;
			}

			const id = this.show(countdownMessage(data.countdown), data.type ?? 'info', 0);
			if (id == null) return;

			this.attachCountdown(id, data.countdown);
			this.startCountdownTicker(id);
		} catch {
			clearRestoreCountdownPersistence();
		}
	},

	dismiss(id: number) {
		const item = this.toasts.find((t) => t.id === id);
		if (item?.countdown) {
			clearRestoreCountdownPersistence();
		}
		this.stopCountdownTicker(id);
		this.toasts = this.toasts.filter((t) => t.id !== id);
	},

	clearAll() {
		for (const id of [...countdownHandles.keys()]) {
			this.stopCountdownTicker(id);
		}
		clearRestoreCountdownPersistence();
		this.toasts = [];
	}
});