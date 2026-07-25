/**
 * Backdrop dismiss that ignores text-selection drags.
 *
 * Browsers fire `click` on the common ancestor of mousedown + mouseup. Selecting
 * text in a modal input, dragging outside the dialog, and releasing on the
 * overlay therefore looks like a backdrop click and closes the modal.
 *
 * Fix: only dismiss when pointerdown *and* click both target the overlay itself.
 */

export type BackdropDismissHandlers = {
	onpointerdown: (e: PointerEvent) => void;
	onclick: (e: MouseEvent) => void;
};

/**
 * Returns overlay event handlers that call `onDismiss` only for a true
 * backdrop press (down + up both on the overlay).
 */
export function createBackdropDismiss(onDismiss: () => void): BackdropDismissHandlers {
	let downOnBackdrop = false;

	return {
		onpointerdown(e: PointerEvent) {
			downOnBackdrop = e.target === e.currentTarget;
		},
		onclick(e: MouseEvent) {
			const shouldDismiss = downOnBackdrop && e.target === e.currentTarget;
			downOnBackdrop = false;
			if (shouldDismiss) onDismiss();
		}
	};
}
