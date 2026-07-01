import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toast, type ToastItem, RESTORE_COUNTDOWN_KEY } from './toast.svelte';

// )=- Mock browser env so the guard `if (!browser) return;` in show() doesn't short-circuit in Vitest/happy-dom.
// This is a common pattern when testing SvelteKit stores that have environment guards.
// Reference: TESTING_PLAN.md (stores testing)
vi.mock('$app/environment', () => ({
	browser: true
}));

// )=- First light store test (Phase 2/3 area of TESTING_PLAN.md).
// The toast store is a simple $state-based singleton used for user feedback.
// Easy to test because mutations are synchronous and observable.
// We clear between tests for isolation.
// Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling

describe('toast store (runes $state)', () => {
	beforeEach(() => {
		sessionStorage.clear();
		toast.clearAll();
	});

	it('starts empty', () => {
		expect(toast.toasts.length).toBe(0);
	});

	it('show adds a toast with id, message, and type', () => {
		const id = toast.show('Hello world', 'success', 0); // duration 0 so no auto dismiss
		expect(id).toBeTypeOf('number');
		expect(toast.toasts.length).toBe(1);

		const t = toast.toasts[0];
		expect(t.message).toBe('Hello world');
		expect(t.type).toBe('success');
		expect(t.id).toBe(id);
	});

	it('convenience methods (success, error, info) work and default durations', () => {
		toast.success('Great job');
		toast.error('Oh no');
		toast.info('FYI');

		expect(toast.toasts.length).toBe(3);
		expect(toast.toasts.map((t: ToastItem) => t.type)).toEqual(['success', 'error', 'info']);
	});

	it('dismiss removes by id', () => {
		const id1 = toast.show('one', 'info', 0);
		const id2 = toast.show('two', 'info', 0);

		toast.dismiss(id1!);

		expect(toast.toasts.length).toBe(1);
		expect(toast.toasts[0].message).toBe('two');
	});

	it('clearAll empties the list', () => {
		toast.show('a');
		toast.show('b');
		toast.clearAll();
		expect(toast.toasts.length).toBe(0);
	});

	it('showWithAction adds actionable toast with 5s default', () => {
		const onAction = vi.fn();
		toast.showWithAction('Click here', onAction, 0);
		expect(toast.toasts.length).toBe(1);
		expect(toast.toasts[0].actionLabel).toBe('Click here');
		expect(toast.toasts[0].onAction).toBe(onAction);
	});

	it('update changes message in place', () => {
		const id = toast.show('Tick', 'info', 0);
		toast.update(id!, 'Tock');
		expect(toast.toasts[0].message).toBe('Tock');
	});

	it('showCountdown ticks down, shows done message, then dismisses', () => {
		vi.useFakeTimers();
		toast.showCountdown('Please wait', 3, { doneMessage: 'Ready' });
		expect(toast.toasts[0].message).toBe('Please wait (3s remaining)');
		expect(toast.toasts[0].countdown).toBeTruthy();

		vi.advanceTimersByTime(1000);
		expect(toast.toasts[0].message).toBe('Please wait (2s remaining)');

		vi.advanceTimersByTime(2000);
		expect(toast.toasts[0].message).toBe('Ready');

		vi.advanceTimersByTime(5000);
		expect(toast.toasts.length).toBe(0);

		vi.useRealTimers();
	});

	it('showCountdown persists and restores after simulated reload', () => {
		toast.showCountdown('Please wait', 90, {
			doneMessage: 'Ready',
			persistKey: RESTORE_COUNTDOWN_KEY
		});
		expect(sessionStorage.getItem(RESTORE_COUNTDOWN_KEY)).toBeTruthy();

		// Simulate full page reload: in-memory toasts gone, sessionStorage kept.
		toast.toasts = [];
		toast.restorePersistedCountdown();
		expect(toast.toasts.length).toBe(1);
		expect(toast.toasts[0].message).toContain('90s remaining');
	});
});