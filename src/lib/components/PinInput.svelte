<script lang="ts">
	import { PIN_LENGTH } from '$lib/auth/deviceUnlock';

	type Props = {
		value?: string;
		disabled?: boolean;
		hasError?: boolean;
		autofocus?: boolean;
		/** Bump to clear all cells (e.g. after wrong PIN). */
		resetKey?: number;
		onComplete?: (pin: string) => void;
	};

	let {
		value = $bindable(''),
		disabled = false,
		hasError = false,
		autofocus = true,
		resetKey = 0,
		onComplete
	}: Props = $props();

	let cells: HTMLInputElement[] = $state([]);
	let digits = $state<string[]>(Array(PIN_LENGTH).fill(''));
	let prevResetKey = -1;
	let lastEmitted = '';

	function syncFromValue(pin: string) {
		const chars = pin.replace(/\D/g, '').slice(0, PIN_LENGTH).split('');
		digits = Array.from({ length: PIN_LENGTH }, (_, i) => chars[i] ?? '');
		for (let i = 0; i < PIN_LENGTH; i++) {
			if (cells[i]) cells[i].value = digits[i];
		}
	}

	function emitValue() {
		const next = digits.join('');
		lastEmitted = next;
		if (value !== next) value = next;
	}

	function focusCell(index: number) {
		requestAnimationFrame(() => cells[index]?.focus());
	}

	function clearAll(focusFirst = true) {
		digits = Array(PIN_LENGTH).fill('');
		for (const el of cells) {
			if (el) el.value = '';
		}
		emitValue();
		if (focusFirst && autofocus && !disabled) focusCell(0);
	}

	$effect(() => {
		if (resetKey === prevResetKey) return;
		prevResetKey = resetKey;
		clearAll(true);
	});

	$effect(() => {
		if (value === lastEmitted) return;
		lastEmitted = value;
		syncFromValue(value);
	});

	function tryComplete() {
		const pin = digits.join('');
		if (pin.length === PIN_LENGTH && digits.every((d) => d !== '')) {
			onComplete?.(pin);
		}
	}

	function handleInput(index: number, event: Event) {
		const el = event.target as HTMLInputElement;
		const digit = el.value.replace(/\D/g, '').slice(-1);
		el.value = digit;
		digits[index] = digit;
		digits = [...digits];
		emitValue();

		if (digit && index < PIN_LENGTH - 1) {
			focusCell(index + 1);
		}
		tryComplete();
	}

	function handleKeyDown(index: number, event: KeyboardEvent) {
		if (event.key === 'Backspace') {
			if (digits[index]) {
				digits[index] = '';
				digits = [...digits];
				emitValue();
				const el = cells[index];
				if (el) el.value = '';
			} else if (index > 0) {
				digits[index - 1] = '';
				digits = [...digits];
				emitValue();
				const el = cells[index - 1];
				if (el) el.value = '';
				focusCell(index - 1);
			}
			event.preventDefault();
		}
	}

	function handlePaste(event: ClipboardEvent) {
		event.preventDefault();
		const pasted = (event.clipboardData?.getData('text') ?? '').replace(/\D/g, '').slice(0, PIN_LENGTH);
		if (!pasted) return;

		const chars = pasted.split('');
		digits = Array.from({ length: PIN_LENGTH }, (_, i) => chars[i] ?? '');
		for (let i = 0; i < PIN_LENGTH; i++) {
			if (cells[i]) cells[i].value = digits[i];
		}
		emitValue();

		if (pasted.length === PIN_LENGTH) {
			onComplete?.(pasted);
		} else {
			focusCell(Math.min(pasted.length, PIN_LENGTH - 1));
		}
	}
</script>

<div class="pin-input" class:pin-input--error={hasError}>
	{#each Array(PIN_LENGTH) as _, index (index)}
		<input
			bind:this={cells[index]}
			class="pin-input__cell"
			type="tel"
			inputmode="numeric"
			pattern="[0-9]*"
			maxlength="1"
			autocomplete="one-time-code"
			aria-label="PIN digit {index + 1} of {PIN_LENGTH}"
			disabled={disabled}
			value={digits[index]}
			oninput={(e) => handleInput(index, e)}
			onkeydown={(e) => handleKeyDown(index, e)}
			onpaste={handlePaste}
		/>
	{/each}
</div>

<style>
	.pin-input {
		display: flex;
		justify-content: center;
		gap: var(--space-2);
		max-width: 100%;
	}

	.pin-input__cell {
		flex: 1 1 0;
		min-width: 0;
		max-width: 3rem;
		height: 2.75rem;
		padding: 0;
		border: 2px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		text-align: center;
		caret-color: var(--color-primary);
		-webkit-text-security: disc;
	}

	.pin-input__cell:focus {
		outline: none;
		border-color: var(--color-primary);
		box-shadow: var(--focus-ring);
	}

	.pin-input__cell:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.pin-input--error .pin-input__cell {
		border-color: var(--color-danger);
	}

	@media (max-width: 380px) {
		.pin-input__cell {
			max-width: 2.75rem;
		}
	}
</style>