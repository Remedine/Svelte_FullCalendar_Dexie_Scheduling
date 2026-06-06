<!-- src/lib/calendar/MonthPicker.svelte -->
<script lang="ts">
	import { optionsStore } from '$lib/stores/options.svelte';

	let {
		jobs = [],
		selectedDate = $bindable(new Date().toISOString().split('T')[0]),
		onDateSelect
	}: {
		jobs?: any[];
		selectedDate?: string;
		onDateSelect?: (dateStr: string) => void;
	} = $props();

	let currentMonth = $state(new Date().getMonth());
	let currentYear = $state(new Date().getFullYear());

	const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
	const weekdays = ['Su','Mo','Tu','We','Th','Fr','Sa'];

	function toDateString(d: any): string {
		if (!d) return '';
		const date = d instanceof Date ? d : new Date(d);
		return date.toISOString().split('T')[0];
	}

	function getDaysInMonth(year: number, month: number) {
		const firstDay = new Date(year, month, 1).getDay();
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const days = [];

		for (let i = 0; i < firstDay; i++) {
			days.push({ date: new Date(year, month, -firstDay + i + 1), isCurrent: false });
		}
		for (let d = 1; d <= daysInMonth; d++) {
			days.push({ date: new Date(year, month, d), isCurrent: true });
		}
		return days;
	}

	function getJobColor(job: any) {
		if (!job?.areaOfTown || !optionsStore.data?.areasOfTown) return '#6b7280';
		const area = optionsStore.data.areasOfTown.find((a: any) => a.id === job.areaOfTown);
		return area?.color || '#6b7280';
	}

	function getJobsForDay(date: Date) {
		const dateStr = toDateString(date);
		return jobs.filter((j: any) => toDateString(j.start) === dateStr);
	}

	function selectDay(day: any) {
		if (!day.isCurrent) return;
		const dateStr = toDateString(day.date);
		selectedDate = dateStr;
		onDateSelect?.(dateStr);
	}

	function changeMonth(delta: number) {
		currentMonth += delta;
		if (currentMonth > 11) { currentMonth = 0; currentYear++; }
		if (currentMonth < 0) { currentMonth = 11; currentYear--; }
	}

	const days = $derived(getDaysInMonth(currentYear, currentMonth));
</script>

<div class="month-picker">
	<div class="month-picker__header">
		<button class="month-picker__nav" onclick={() => changeMonth(-1)}>←</button>
		<div class="month-picker__title">{monthNames[currentMonth]} {currentYear}</div>
		<button class="month-picker__nav" onclick={() => changeMonth(1)}>→</button>
	</div>

	<div class="month-picker__weekdays">
		{#each weekdays as d}<div class="month-picker__weekday">{d}</div>{/each}
	</div>

	<div class="month-picker__grid">
		{#each days as day}
			<button 
				class="month-picker__day"
				class:month-picker__day--other={!day.isCurrent}
				class:month-picker__day--selected={toDateString(day.date) === selectedDate}
				onclick={() => selectDay(day)}
			>
				<span class="month-picker__number">{day.date.getDate()}</span>
				
				{#if getJobsForDay(day.date).length > 0}
					<div class="month-picker__dots">
						{#each getJobsForDay(day.date) as job}
							<span class="month-picker__dot" style="background-color: {getJobColor(job)}"></span>
						{/each}
					</div>
				{/if}
			</button>
		{/each}
	</div>
</div>

<style>
	.month-picker {
		container-type: inline-size;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 0.6rem;
	}

	.month-picker__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.4rem;
	}

	.month-picker__nav {
		width: 32px;
		height: 32px;
		border: none;
		background: #f1f5f9;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1.1rem;
	}

	.month-picker__title {
		font-weight: 600;
		font-size: 1rem;
	}

	.month-picker__weekdays,
	.month-picker__grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 3px;
	}

	.month-picker__weekday {
		text-align: center;
		font-size: 0.7rem;
		color: #64748b;
		padding: 2px 0;
	}

	.month-picker__day {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 4px 2px;
		min-height: 44px;
		border: none;
		background: transparent;
		border-radius: 6px;
		cursor: pointer;
	}

	.month-picker__day:hover { background: #f8fafc; }
	.month-picker__day--other { color: #94a3b8; }
	.month-picker__day--selected { background: #dbeafe; font-weight: 600; }

	.month-picker__number {
		font-size: 0.9rem;
	}

	.month-picker__dots {
		display: flex;
		gap: 2px;
		margin-top: 2px;
	}

	.month-picker__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1px solid #111;
	}

	@container (min-width: 480px) {
		.month-picker__day { min-height: 52px; }
		.month-picker__dot { width: 8px; height: 8px; }
	}
</style>