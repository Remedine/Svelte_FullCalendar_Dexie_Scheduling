<script lang="ts">
	import { onMount } from 'svelte';
	import { Calendar } from '@fullcalendar/core';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import multiMonthPlugin from '@fullcalendar/multimonth';
	import { getJobsForRange, updateJobDates, createJob } from '$lib/db/index';
	import { seedSampleData } from '$lib/db/seed';
	import { BUSINESS_CONFIG } from '$lib/config';
	import type { AreaOfTown } from '$lib/config';
	import ClientPicker from '$lib/components/ClientPicker.svelte';

	let calendarEl: HTMLDivElement;
	let calendarInstance: Calendar | null = $state(null);

	// )=- New job form state
	let showNewJobForm = $state(false);
	let newJob = $state({
		title: 'Full Exterior Window Cleaning',
		start: new Date(),
		end: new Date(),
		clientId: 1 as number,
		assignedCrew: ['Mike'] as string[],
		areaOfTown: 'thane' as AreaOfTown
	});

	const crewOptions = BUSINESS_CONFIG.crewMembers;
	const areaOptions = Object.entries(BUSINESS_CONFIG.areasOfTown).map(([key, value]) => ({
		value: key,
		label: value.label
	}));

	// Convert Date → datetime-local string (YYYY-MM-DDTHH:mm)
	function toDatetimeLocal(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}
	// Add Hours Helper
	function addHours(date: Date, hours: number): Date {
		const result = new Date(date);
		result.setHours(result.getHours() + hours);
		return result;
	}

	onMount(async () => {
		await seedSampleData(false);

		calendarInstance = new Calendar(calendarEl, {
			plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin, multiMonthPlugin],
			initialView: 'timeGridWeek',
			editable: true,
			selectable: true,
			height: '100%',
			expandRows: true,

			headerToolbar: {
				left: 'prev,next today',
				center: 'title',
				right: 'dayGridMonth,timeGridWeek,timeGridDay'
			},

			select: (info) => {
				newJob.start = info.start;
				newJob.end = addHours(info.start, 2);

				newJob.title = "Full Comercial Window Cleaning"
				newJob.clientId = null;
				newJob.assignedCrew = ['Mike'];
				newJob.areaOfTown = 'than';
				showNewJobForm = true;
			},

			eventDrop: async (info) => {
				const jobId = parseInt(info.event.id);
				if (!jobId) return;

				try {
					await updateJobDates(jobId, info.event.start!, info.event.end!);
					calendarInstance?.refetchEvents();
				} catch (err) {
					console.error('❌ Update failed', err);
					info.revert();
				}
			},

			eventClick: (info) => {
				const props = info.event.extendedProps;
				const message = `🪟 ${info.event.title}\n📍 ${props.areaOfTown}\n👥 ${props.assignedCrew?.join(', ') || 'None'}\n🕒 ${info.event.start?.toLocaleString() || ''}`;
				confirm(message);
			},

			events: async (fetchInfo, successCallback) => {
				const jobs = await getJobsForRange(fetchInfo.start, fetchInfo.end);
				console.log(`📅 Loaded ${jobs.length} jobs`);

				const events = jobs.map((job: any) => ({
					id: job.id?.toString() || '',
					title: `${job.title} — ${job.assignedCrew.join(', ')}`,
					start: job.start,
					end: job.end,
					backgroundColor: getEventColor(job.areaOfTown),
					extendedProps: job
				}));

				successCallback(events);
			}
		});

		calendarInstance.render();
	});

	function getEventColor(area: string): string {
		return BUSINESS_CONFIG.areasOfTown?.[area as keyof typeof BUSINESS_CONFIG.areasOfTown]?.color || '#6b7280';
	}

		// )=- Updated createNewJob
	async function createNewJob() {
		try {
			await createJob({
				clientId: newJob.clientId,
				title: newJob.title,
				start: newJob.start,
				end: newJob.end,
				assignedCrew: newJob.assignedCrew,
				areaOfTown: newJob.areaOfTown
			});

			showNewJobForm = false;
			calendarInstance?.refetchEvents();
			alert('✅ Job saved successfully!');
		} catch (err) {
			console.error('Failed to create job', err);
			alert('❌ Error saving job - check console');
		}
	}

	$effect(() => {
		return () => calendarInstance?.destroy();
	});
</script>

<div class="calendar-wrapper">
	<div bind:this={calendarEl} class="calendar-container"></div>
</div>

<!-- )=- New Job Modal -->
{#if showNewJobForm}
	<div class="new-job-modal">
		<div class="new-job-modal__content">
			<h2 class="new-job-modal__title">Create New Job</h2>

			<div class="new-job-modal__form">
				<div class="new-job-modal__field">
					<label for="job-title" class="new-job-modal__label">Title</label>
					<input id="job-title" class="new-job-modal__input" bind:value={newJob.title} />
				</div>

				<!-- Added client picker component -->
				<div class="new-job-modal__field">
					<label for="client-picker" class="new-job-modal__lable" >Client</label>
					<ClientPicker 
						bind:value={newJob.clientId}
						placeholder="Select client..."
						/>
				</div>

				<div class="new-job-modal__field-group">
					<div class="new-job-modal__field">
						<label for="job-start" class="new-job-modal__label">Start</label>
						<input 
							id="job-start" 
							type="datetime-local" 
							class="new-job-modal__input"
							value={toDatetimeLocal(newJob.start)}
							oninput={(e) => newJob.start = new Date((e.target as HTMLInputElement).value)} 
						/>
					</div>
					<div class="new-job-modal__field">
						<label for="job-end" class="new-job-modal__label">End</label>
						<input 
							id="job-end" 
							type="datetime-local" 
							class="new-job-modal__input" 
							value={toDatetimeLocal(newJob.end)}
							oninput={(e) => newJob.end = new Date((e.target as HTMLInputElement).value)}
							 />
					</div>
				</div>

				<div class="new-job-modal__field">
					<label for="job-area" class="new-job-modal__label">Area of Town</label>
					<select id="job-area" class="new-job-modal__input" bind:value={newJob.areaOfTown}>
						{#each areaOptions as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>

				<!-- )=- Crew section - using fieldset + legend for proper a11y -->
				<fieldset class="new-job-modal__field">
					<legend class="new-job-modal__label">Crew</legend>
					<div class="new-job-modal__crew-grid">
						{#each crewOptions as crew (crew)}
							<label class="new-job-modal__crew-option">
								<input 
									type="checkbox" 
									checked={newJob.assignedCrew.includes(crew)}
									onchange={(e) => {
										if ((e.currentTarget as HTMLInputElement).checked) {
											newJob.assignedCrew = [...newJob.assignedCrew, crew];
										} else {
											newJob.assignedCrew = newJob.assignedCrew.filter(c => c !== crew);
										}
									}}
								/>
								{crew}
							</label>
						{/each}
					</div>
				</fieldset>
			</div>

			<div class="new-job-modal__actions">
				<button class="new-job-modal__btn new-job-modal__btn--cancel" onclick={() => showNewJobForm = false}>
					Cancel
				</button>
				<button class="new-job-modal__btn new-job-modal__btn--primary" onclick={createNewJob}>
					Create Job
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.calendar-wrapper {
		height: 100vh;
		display: flex;
		flex-direction: column;
		padding: 1rem;
		background: #f8fafc;
	}

	.calendar-container {
		flex: 1;
		min-height: 0;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}

	/* BEM Modal Styles */
	.new-job-modal {
		position: fixed;
		top: 0; left: 0; right: 0; bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.new-job-modal__content {
		background: white;
		padding: 2rem;
		border-radius: 12px;
		min-width: 480px;
		max-width: 90%;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
	}

	.new-job-modal__title {
		margin: 0 0 1.5rem 0;
		font-size: 1.5rem;
		font-weight: 600;
		color: #1e2937;
	}

	.new-job-modal__form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin-bottom: 2rem;
	}

	.new-job-modal__field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.new-job-modal__field-group {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	.new-job-modal__label {
		font-weight: 500;
		font-size: 0.95rem;
		color: #334155;
	}

	.new-job-modal__input {
		padding: 0.75rem 1rem;
		border: 1px solid #cbd5e1;
		border-radius: 6px;
		font-size: 1rem;
	}

	.new-job-modal__crew-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		padding: 0.5rem 0;
	}

	.new-job-modal__crew-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
	}

	.new-job-modal__actions {
		display: flex;
		justify-content: flex-end;
		gap: 1rem;
	}

	.new-job-modal__btn {
		padding: 0.75rem 1.5rem;
		border-radius: 6px;
		font-weight: 500;
		cursor: pointer;
		border: none;
	}

	.new-job-modal__btn--cancel {
		background: #f1f5f9;
		color: #475569;
	}

	.new-job-modal__btn--primary {
		background: #3b82f6;
		color: white;
	}

	.new-job-modal__btn--primary:hover {
		background: #2563eb;
	}
</style>