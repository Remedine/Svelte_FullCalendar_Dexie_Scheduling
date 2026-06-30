<script lang="ts">
	import { getDisplayAreaColor } from '$lib/utils/colors';

	type AreaOption = {
		value: string;
		label: string;
		color: string;
	};

	let {
		value = $bindable(''),
		options = [] as AreaOption[],
		id = 'area-select',
		labelId = '',
		placeholder = 'Select area...'
	} = $props<{
		value?: string;
		options?: AreaOption[];
		id?: string;
		labelId?: string;
		placeholder?: string;
	}>();

	let isOpen = $state(false);
	let activeIndex = $state(-1);
	let rootEl = $state<HTMLDivElement>();

	const selectedOption = $derived(options.find((o) => o.value === value));
	const selectedColor = $derived(
		selectedOption ? getDisplayAreaColor(selectedOption.color) : '#64748b'
	);
	const selectedLabel = $derived(selectedOption?.label ?? '');

	function selectOption(optionValue: string) {
		value = optionValue;
		isOpen = false;
		activeIndex = -1;
	}

	function close() {
		isOpen = false;
		activeIndex = -1;
	}

	function toggleOpen() {
		isOpen = !isOpen;
		if (isOpen) {
			const idx = options.findIndex((o) => o.value === value);
			activeIndex = idx >= 0 ? idx : 0;
		}
	}

	function handleTriggerKeydown(e: KeyboardEvent) {
		if (!isOpen) {
			if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				isOpen = true;
				activeIndex = Math.max(
					0,
					options.findIndex((o) => o.value === value)
				);
			}
			return;
		}

		if (e.key === 'Escape') {
			e.preventDefault();
			close();
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = Math.min(options.length - 1, activeIndex + 1);
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = Math.max(0, activeIndex - 1);
			return;
		}

		if (e.key === 'Enter' && activeIndex >= 0 && options[activeIndex]) {
			e.preventDefault();
			selectOption(options[activeIndex].value);
		}
	}

	function handleClickOutside(e: PointerEvent) {
		if (!isOpen || !rootEl) return;
		const path = e.composedPath();
		if (!path.includes(rootEl)) close();
	}

	$effect(() => {
		document.addEventListener('pointerdown', handleClickOutside);
		return () => document.removeEventListener('pointerdown', handleClickOutside);
	});
</script>

<div class="area-select" class:area-select--open={isOpen} bind:this={rootEl}>
	<button
		type="button"
		{id}
		class="area-select__trigger"
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		aria-labelledby={labelId || undefined}
		onclick={toggleOpen}
		onkeydown={handleTriggerKeydown}
		style={value
			? `--area-color: ${selectedColor}; border-left-color: ${selectedColor}; background-color: ${selectedColor}20; color: ${selectedColor}; border-color: ${selectedColor};`
			: undefined}
	>
		<span class="area-select__label">{selectedLabel || placeholder}</span>
		<span class="area-select__chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
	</button>

	{#if isOpen}
		<ul class="area-select__list" role="listbox" aria-labelledby={labelId || undefined}>
			{#each options as option, index (option.value)}
				{@const optionColor = getDisplayAreaColor(option.color)}
				<li role="presentation">
					<button
						type="button"
						role="option"
						aria-selected={value === option.value}
						class="area-select__option"
						class:area-select__option--selected={value === option.value}
						class:area-select__option--active={index === activeIndex}
						style="--area-color: {optionColor};"
						onmouseenter={() => (activeIndex = index)}
						onclick={() => selectOption(option.value)}
					>
						<span
							class="area-select__swatch"
							style="background-color: {optionColor};"
							aria-hidden="true"
						></span>
						<span class="area-select__option-label">{option.label}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.area-select {
		position: relative;
		width: 100%;
	}

	.area-select__trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
		min-height: 44px;
		padding: var(--space-2) var(--space-3);
		padding-left: var(--space-3);
		border: 1px solid var(--color-border-strong);
		border-left-width: 6px;
		border-left-color: var(--color-border-strong);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: var(--font-size-base);
		font-weight: var(--font-weight-medium);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast),
			background-color var(--transition-fast),
			color var(--transition-fast);
	}

	.area-select__trigger:hover {
		border-color: var(--color-text-subtle);
	}

	.area-select--open .area-select__trigger,
	.area-select__trigger:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}

	.area-select__label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.area-select__chevron {
		flex-shrink: 0;
		font-size: var(--font-size-xs);
		line-height: 1;
		color: var(--color-text-muted);
	}

	.area-select__list {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		max-height: 240px;
		overflow-y: auto;
		z-index: calc(var(--z-dropdown) + 1);
	}

	.area-select__option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: none;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--area-color) 12%, var(--color-surface));
		color: var(--area-color);
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-medium);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--transition-fast);
	}

	.area-select__option:hover,
	.area-select__option--active {
		background: color-mix(in srgb, var(--area-color) 28%, var(--color-surface));
		color: var(--area-color);
	}

	.area-select__option--selected {
		font-weight: var(--font-weight-semibold);
		background: color-mix(in srgb, var(--area-color) 22%, var(--color-surface));
	}

	.area-select__swatch {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-full);
		flex-shrink: 0;
	}

	.area-select__option-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>