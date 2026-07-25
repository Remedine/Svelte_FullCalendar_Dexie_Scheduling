import { describe, it, expect, vi } from 'vitest';
import { createBackdropDismiss } from './modalBackdrop';

function makeEvent(target: EventTarget, currentTarget: EventTarget) {
	return { target, currentTarget } as unknown as PointerEvent & MouseEvent;
}

describe('createBackdropDismiss', () => {
	it('dismisses when pointerdown and click both land on the overlay', () => {
		const onDismiss = vi.fn();
		const handlers = createBackdropDismiss(onDismiss);
		const overlay = document.createElement('div');

		handlers.onpointerdown(makeEvent(overlay, overlay));
		handlers.onclick(makeEvent(overlay, overlay));

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it('does not dismiss when pointerdown started inside dialog content', () => {
		const onDismiss = vi.fn();
		const handlers = createBackdropDismiss(onDismiss);
		const overlay = document.createElement('div');
		const content = document.createElement('div');

		// Simulate text-select drag: down inside input/content, up on overlay
		handlers.onpointerdown(makeEvent(content, overlay));
		handlers.onclick(makeEvent(overlay, overlay));

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it('does not dismiss when click is on content (bubbled)', () => {
		const onDismiss = vi.fn();
		const handlers = createBackdropDismiss(onDismiss);
		const overlay = document.createElement('div');
		const content = document.createElement('div');

		handlers.onpointerdown(makeEvent(content, content));
		handlers.onclick(makeEvent(content, overlay));

		expect(onDismiss).not.toHaveBeenCalled();
	});

	it('requires a fresh pointerdown for each dismiss', () => {
		const onDismiss = vi.fn();
		const handlers = createBackdropDismiss(onDismiss);
		const overlay = document.createElement('div');

		handlers.onpointerdown(makeEvent(overlay, overlay));
		handlers.onclick(makeEvent(overlay, overlay));
		// Second click without a new pointerdown on backdrop
		handlers.onclick(makeEvent(overlay, overlay));

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
