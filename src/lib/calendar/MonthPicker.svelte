<!-- src/lib/calendar/MonthPicker.svelte -->
<script lang="ts">
	import { optionsStore } from '$lib/stores/options.svelte';
	import { createEventDispatcher } from 'svelte';
	import { getDisplayAreaColor } from '$lib/utils/colors';

	const dispatch = createEventDispatcher();

	let {
		jobs = [],
		selectedDate = $bindable(getLocalDateString()),
		onDateSelect,
		onRegisterNavigator,
		onVisibleMonthChange,
		dragHoverDateStr = null,
		appointmentDragActive = false
	}: {
		jobs?: any[];
		selectedDate?: string;
		onDateSelect?: (dateStr: string) => void;
		onRegisterNavigator?: (stepMonth: (delta: number) => void) => void;
		onVisibleMonthChange?: (year: number, month: number) => void;
		dragHoverDateStr?: string | null;
		appointmentDragActive?: boolean;
	} = $props();

	let currentMonth = $state(new Date().getMonth());
	let currentYear = $state(new Date().getFullYear());
	let dragOverDay: any = $state(null);

	const monthNames = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

	function getLocalDateString(date: Date = new Date()): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function toDateString(d: any): string {
		if (!d) return '';
		const date = d instanceof Date ? d : new Date(d);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getDaysInMonth(year: number, month: number) {
		const firstDay = new Date(year, month, 1).getDay();
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const days: { date: Date; isCurrent: boolean }[] = [];

		// Leading days from the previous month (grey)
		const prevMonthLastDate = new Date(year, month, 0).getDate();
		for (let i = 0; i < firstDay; i++) {
			const dayNum = prevMonthLastDate - firstDay + i + 1;
			days.push({ date: new Date(year, month - 1, dayNum), isCurrent: false });
		}

		for (let d = 1; d <= daysInMonth; d++) {
			days.push({ date: new Date(year, month, d), isCurrent: true });
		}

		// Trailing days from the next month — complete the final week (e.g. Jul 1–4 after June)
		let nextMonthDay = 1;
		while (days.length % 7 !== 0) {
			days.push({ date: new Date(year, month + 1, nextMonthDay), isCurrent: false });
			nextMonthDay++;
		}

		return days;
	}

	function getJobColor(job: any) {
		if (!job?.areaOfTown || !optionsStore.data?.areasOfTown) return '#64748b';
		const area = optionsStore.data.areasOfTown.find((a: any) => a.id === job.areaOfTown);
		return getDisplayAreaColor(area?.color);
	}

	// Efficient lookup: build once when jobs change instead of filtering all jobs on every day render.
	// Previously getJobsForDay did a full scan for each of the ~42 days on every render of the picker.
	const jobsByDate = $derived.by(() => {
		const map = new Map<string, any[]>();
		for (const j of jobs || []) {
			const d = toDateString(j.start);
			if (!map.has(d)) map.set(d, []);
			map.get(d)!.push(j);
		}
		return map;
	});

	function getJobsForDay(date: Date) {
		const dateStr = toDateString(date);
		return jobsByDate.get(dateStr) || [];
	}

	function selectDay(day: { date: Date; isCurrent: boolean }) {
		const dateStr = toDateString(day.date);
		selectedDate = dateStr;
		currentYear = day.date.getFullYear();
		currentMonth = day.date.getMonth();
		onDateSelect?.(dateStr);
		dragOverDay = null;
	}

	function goToToday() {
		const today = new Date();
		currentMonth = today.getMonth();
		currentYear = today.getFullYear();
		const todayStr = getLocalDateString(today);
		selectedDate = todayStr;
		onDateSelect?.(todayStr);
	}

	function changeMonth(delta: number) {
		currentMonth += delta;
		if (currentMonth > 11) {
			currentMonth = 0;
			currentYear++;
		}
		if (currentMonth < 0) {
			currentMonth = 11;
			currentYear--;
		}
		dragOverDay = null;
	}

	function isToday(date: Date): boolean {
		return toDateString(date) === getLocalDateString();
	}

	const days = $derived(getDaysInMonth(currentYear, currentMonth));
	const weekRowCount = $derived(days.length / 7);

	$effect(() => {
		onRegisterNavigator?.(changeMonth);
	});

	// Notify parent when the user browses months (nav buttons, edge-dwell, grey-day select) so job dots can prefetch.
	$effect(() => {
		onVisibleMonthChange?.(currentYear, currentMonth);
	});

	$effect(() => {
		if (!appointmentDragActive) dragOverDay = null;
	});

	function formatShortDragDate(date: Date): string {
		return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	const dragContextDateLabel = $derived.by(() => {
		if (dragOverDay?.date) return formatShortDragDate(dragOverDay.date);
		if (!dragHoverDateStr) return null;
		const d = new Date(dragHoverDateStr + 'T12:00:00');
		if (isNaN(d.getTime())) return null;
		return formatShortDragDate(d);
	});

	// Keep the visible month in sync when the parent sets selectedDate (e.g. jump from job details).
	$effect(() => {
		const dateStr = selectedDate;
		if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
		const [y, m] = dateStr.split('-').map(Number);
		if (!y || !m) return;
		currentYear = y;
		currentMonth = m - 1;
	});
</script>

<div
	class="month-picker"
	class:month-picker--drag-active={appointmentDragActive}
>
	<div class="month-picker__header">
		<div class="month-picker__title">
			{monthNames[currentMonth]}
			{currentYear}
		</div>

		<button class="month-picker__today-btn" onclick={goToToday}>Today</button>
	</div>

	<div class="month-picker__weekdays">
		{#each weekdays as d}<div class="month-picker__weekday">{d}</div>{/each}
	</div>

	<div class="month-picker__grid" style="--month-grid-rows: {weekRowCount}">
		{#each days as day}
			{@const dayJobs = getJobsForDay(day.date)}

			<button
				class="month-picker__day"
				class:month-picker__day--other={!day.isCurrent}
				class:month-picker__day--selected={toDateString(day.date) === selectedDate}
				class:month-picker__day--today={isToday(day.date)}
				class:month-picker__day--drag-over={dragOverDay === day}
				data-date={toDateString(day.date)}
				onclick={() => selectDay(day)}
				ondragover={(e) => {
					e.preventDefault();
					dragOverDay = day;
				}}
				ondragleave={() => {
					dragOverDay = null;
				}}
			>
				<span class="month-picker__number">{day.date.getDate()}</span>

				{#if dayJobs.length > 0}
					<div class="month-picker__dots">
						{#each dayJobs.slice(0, 7) as job}
							<span class="month-picker__dot" style="background-color: {getJobColor(job)}"></span>
						{/each}
					</div>
				{/if}
			</button>
		{/each}
	</div>

	{#if appointmentDragActive}
		<div class="month-picker__drag-context" aria-live="polite">
			<span class="month-picker__drag-context-month">
				{monthNames[currentMonth]}
				{currentYear}
			</span>
			{#if dragContextDateLabel}
				<span class="month-picker__drag-context-date">{dragContextDateLabel}</span>
			{/if}
		</div>
	{/if}

	<div class="month-picker__footer">
		<button
			class="month-picker__nav month-picker__nav--prev"
			onclick={() => changeMonth(-1)}
			aria-label="Previous month"
		>
			←
		</button>
		<button
			class="month-picker__nav month-picker__nav--next"
			onclick={() => changeMonth(1)}
			aria-label="Next month"
		>
			→
		</button>
	</div>
</div>

<style>
	/* MonthPicker — full tokens + BEM for cohesion with app look & feel (dark mode, spacing scale, etc.) */
	.month-picker {
		container-type: inline-size;
		/* Fixed grid slot: 6-row months shrink cells instead of shifting the footer. */
		--month-picker-grid-height: 252px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-2);
	}

	.month-picker__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-2);
	}

	.month-picker__drag-context {
		display: none;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		margin-top: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		background: var(--color-primary-soft);
		border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
		text-align: center;
	}

	.month-picker--drag-active .month-picker__drag-context {
		display: flex;
	}

	.month-picker__drag-context-month {
		font-size: var(--font-size-sm);
		font-weight: var(--font-weight-semibold);
		color: var(--color-primary-emphasis);
		line-height: 1.2;
	}

	.month-picker__drag-context-date {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text);
		line-height: 1.2;
	}

	.month-picker__footer {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.month-picker__nav {
		flex: 1;
		min-height: 40px;
		border: 1px solid var(--color-border);
		background: var(--color-surface-alt);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-size-lg);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text);
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.month-picker__nav:hover {
		background: var(--color-border);
	}

	.month-picker__nav--prev {
		padding-right: var(--space-1);
	}

	.month-picker__nav--next {
		padding-left: var(--space-1);
	}

	.month-picker__today-btn {
		font-size: var(--font-size-xs);
		padding: var(--space-1) var(--space-2);
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
		border: 1px solid var(--color-primary);
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-weight: var(--font-weight-medium);
		transition: background var(--transition-fast);
	}

	.month-picker__today-btn:hover {
		background: var(--color-primary);
		color: white;
	}

	.month-picker__title {
		font-weight: var(--font-weight-semibold);
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.month-picker__weekdays,
	.month-picker__grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.month-picker__grid {
		height: var(--month-picker-grid-height);
		grid-template-rows: repeat(var(--month-grid-rows, 5), minmax(0, 1fr));
	}

	.month-picker__weekday {
		text-align: center;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		padding: 1px 0;
		font-weight: var(--font-weight-medium);
	}

	.month-picker__day {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: var(--space-1);
		min-height: 0;
		border: 1px solid transparent;
		background: transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		font-size: var(--font-size-sm);
		color: var(--color-text);
		transition: background var(--transition-fast), border-color var(--transition-fast);
	}

	.month-picker__day:hover {
		background: var(--color-surface-alt);
	}

	.month-picker__day--other {
		color: var(--color-text-subtle);
	}

	.month-picker__day--other:hover,
	.month-picker__day--other.month-picker__day--drag-over {
		background: var(--color-surface-alt);
	}

	.month-picker--drag-active .month-picker__day--other {
		cursor: copy;
	}

	.month-picker__day--selected {
		background: var(--color-primary-soft);
		border-color: var(--color-primary);
		font-weight: var(--font-weight-semibold);
	}

	.month-picker__day--today {
		border-color: var(--color-primary);
		font-weight: var(--font-weight-bold);
		box-shadow: 0 0 0 1px var(--color-primary);
	}

	.month-picker__number {
		font-size: var(--font-size-sm);
		line-height: 1;
	}

	.month-picker__dots {
		display: flex;
		gap: 2px;
		margin-top: 2px;
		align-items: center;
	}

	.month-picker__dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		/* subtle border for visibility on any bg; color comes from inline area color */
		border: 1px solid var(--color-border);
	}

	@media (max-width: 768px) {
		.month-picker {
			/* Midpoint between the prior compact (~1/3) and original (~2/3) mobile picker. */
			--month-picker-grid-height: 112px;
			--month-picker-nav-height: 39px;
			padding: 3px 5px;
		}

		.month-picker__header {
			margin-bottom: 2px;
		}

		.month-picker__weekdays {
			gap: 2px;
			margin-bottom: 2px;
		}

		.month-picker__weekday {
			font-size: 10px;
			padding: 0;
			line-height: 1.1;
		}

		.month-picker__grid {
			gap: 2px;
		}

		.month-picker__day {
			min-height: 0;
			padding: 1px;
			font-size: 11px;
			line-height: 1.1;
		}

		.month-picker__number {
			font-size: 11px;
		}

		.month-picker__dots {
			gap: 1px;
			margin-top: 1px;
		}

		.month-picker__dot {
			width: 3px;
			height: 3px;
		}

		.month-picker__footer {
			margin-top: 3px;
			gap: 4px;
		}

		.month-picker__nav {
			min-height: var(--month-picker-nav-height);
			font-size: var(--font-size-lg);
		}

		.month-picker__today-btn {
			padding: 2px 6px;
			font-size: 10px;
		}

		.month-picker--drag-active .month-picker__header {
			position: sticky;
			top: 0;
			z-index: 2;
			margin: -4px -6px var(--space-1);
			padding: 4px 6px;
			background: var(--color-surface);
			box-shadow: 0 1px 0 var(--color-border);
		}

		.month-picker--drag-active .month-picker__title {
			font-size: var(--font-size-sm);
			font-weight: var(--font-weight-bold);
			color: var(--color-primary-emphasis);
		}

		.month-picker__drag-context {
			margin-top: 2px;
			padding: 4px 6px;
		}

		.month-picker__drag-context-month {
			font-size: var(--font-size-xs);
		}
	}
</style>
