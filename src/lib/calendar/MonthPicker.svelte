<!-- src/lib/calendar/MonthPicker.svelte -->
<script lang="ts">
	import { optionsStore } from '$lib/stores/options.svelte';

	let {
		jobs = [],
		selectedDate = $bindable(getLocalDateString()),
		onDateSelect
	}: {
		jobs?: any[];
		selectedDate?: string;
		onDateSelect?: (dateStr: string) => void;
	} = $props();

	let currentMonth = $state(new Date().getMonth());
	let currentYear = $state(new Date().getFullYear());
	let hoveredDay: any = $state(null);

	const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
	const weekdays = ['Su','Mo','Tu','We','Th','Fr','Sa'];

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
		hoveredDay = null;
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
		if (currentMonth > 11) { currentMonth = 0; currentYear++; }
		if (currentMonth < 0) { currentMonth = 11; currentYear--; }
		hoveredDay = null;
	}

	function isToday(date: Date): boolean {
		return toDateString(date) === getLocalDateString();
	}

	const days = $derived(getDaysInMonth(currentYear, currentMonth));
</script>

<div class="month-picker">
	<div class="month-picker__header">
		<button class="month-picker__nav" onclick={() => changeMonth(-1)}>←</button>
		
		<div class="month-picker__title">
			{monthNames[currentMonth]} {currentYear}
		</div>
		
		<div class="month-picker__header-actions">
			<button class="month-picker__today-btn" onclick={goToToday}>Today</button>
			<button class="month-picker__nav" onclick={() => changeMonth(1)}>→</button>
		</div>
	</div>

	<div class="month-picker__weekdays">
		{#each weekdays as d}<div class="month-picker__weekday">{d}</div>{/each}
	</div>

	<div class="month-picker__grid">
		{#each days as day}
			{@const dayJobs = getJobsForDay(day.date)}
			
			<button 
				class="month-picker__day"
				class:month-picker__day--other={!day.isCurrent}
				class:month-picker__day--selected={toDateString(day.date) === selectedDate}
				class:month-picker__day--today={isToday(day.date)}
				onclick={() => selectDay(day)}
				onmouseenter={() => hoveredDay = day}
				onmouseleave={() => hoveredDay = null}
			>
				<span class="month-picker__number">{day.date.getDate()}</span>
				
				{#if dayJobs.length > 0}
					<div class="month-picker__dots">
						{#each dayJobs.slice(0, 7) as job}   <!-- Cap at 7 dots max -->
							<span 
								class="month-picker__dot" 
								style="background-color: {getJobColor(job)}"
							></span>
						{/each}
					</div>
				{/if}

				<!-- Hover Popup -->
				{#if hoveredDay === day && dayJobs.length > 0}
					<div class="month-picker__tooltip">
						<div class="tooltip__header">
							{day.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
						</div>
						<div class="tooltip__jobs">
							{#each dayJobs as job}
								<div class="tooltip__job">
									<div class="tooltip__job-title">{job.title}</div>
									<div class="tooltip__job-meta">
										{new Date(job.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – 
										{new Date(job.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
										{#if job.areaOfTown}
											• {optionsStore.data?.areasOfTown?.find((a: any) => a.id === job.areaOfTown)?.label || ''}
										{/if}
									</div>
									{#if job.assignedCrew?.length}
										<div class="tooltip__crew">{job.assignedCrew.join(', ')}</div>
									{/if}
								</div>
							{/each}
						</div>
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
		padding: 0.5rem;
	}

	.month-picker__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.35rem;
	}

	.month-picker__header-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.month-picker__nav {
		width: 28px;
		height: 28px;
		border: none;
		background: #f1f5f9;
		border-radius: 6px;
		cursor: pointer;
		font-size: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.month-picker__today-btn {
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		background: #e0f2fe;
		color: #0369a1;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 500;
	}

	.month-picker__title {
		font-weight: 600;
		font-size: 0.95rem;
	}

	.month-picker__weekdays,
	.month-picker__grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.month-picker__weekday {
		text-align: center;
		font-size: 0.65rem;
		color: #64748b;
		padding: 1px 0;
	}

	.month-picker__day {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 3px 1px;
		min-height: 42px;
		border: none;
		background: transparent;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.month-picker__day:hover { background: #f8fafc; }
	.month-picker__day--other { color: #94a3b8; }
	.month-picker__day--selected { background: #dbeafe; font-weight: 600; }
	.month-picker__day--today {
		border: 2px solid #3b82f6;
		font-weight: 700;
	}

	.month-picker__number {
		font-size: 0.85rem;
	}

	.month-picker__dots {
    display: flex;
    margin-top: 3px;
    padding-left: 1px;
	}

	.month-picker__dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		border: 1px solid #111;
		margin-left: -2.5px;           /* Negative margin = overlap */
		box-shadow: 0 0 0 0.5px white; /* Optional: helps visibility when overlapping */
	}

	.month-picker__dot:first-child {
		margin-left: 0;
	}

	/* Slightly larger on bigger containers */
	@container (min-width: 480px) {
		.month-picker__day { 
			min-height: 48px; 
		}
		.month-picker__dot { 
			width: 8px; 
			height: 8px; 
			margin-left: -3px;
		}
	}

	/* Hover Tooltip */
	.month-picker__tooltip {
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-top: 6px;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 0.6rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 100;
		min-width: 220px;
		max-width: 280px;
	}

	.tooltip__header {
		font-weight: 600;
		font-size: 0.85rem;
		margin-bottom: 0.4rem;
		color: #1e2937;
	}

	.tooltip__jobs {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.tooltip__job {
		font-size: 0.8rem;
	}

	.tooltip__job-title {
		font-weight: 500;
		color: #1e2937;
	}

	.tooltip__job-meta {
		font-size: 0.75rem;
		color: #64748b;
	}

	.tooltip__crew {
		font-size: 0.7rem;
		color: #475569;
		margin-top: 1px;
	}
</style>