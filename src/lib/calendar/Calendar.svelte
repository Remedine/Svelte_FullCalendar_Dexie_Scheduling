<script lang="ts">
	import { onMount } from 'svelte';
	import { Calendar } from '@fullcalendar/core';
	import dayGridPlugin from '@fullcalendar/daygrid';
	import timeGridPlugin from '@fullcalendar/timegrid';
	import interactionPlugin from '@fullcalendar/interaction';
	import multiMonthPlugin from '@fullcalendar/multimonth';
	import { getJobsForRange, updateJobDates, createJob, updateJob, cancelJob } from '$lib/db/index';
	import { seedSampleData } from '$lib/db/seed';
	import { BUSINESS_CONFIG } from '$lib/config';
	import type { AreaOfTown } from '$lib/config';
	import ClientPicker from '$lib/components/ClientPicker.svelte';

	let calendarEl: HTMLDivElement;
	let calendarInstance: Calendar | null = $state(null);

	//  New Job form state
	let showJobForm = $state(false);
	let currentJob = $state({
		title: 'Full Exterior Window Cleaning',
		start: new Date(),
		end: new Date(),
		clientId: null as number | null,
		assignedCrew: ['Mike'] as string[],
		areaOfTown: 'thane' as AreaOfTown,
		notes: '' as string,
		cancelReason: '' as string,
		cancelNotes: '' as string
	});

	// Edit mode state
	let isEditing = $state(false);
	let editingJobId = $state<number | null>(null);

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
				//reset for new job
				isEditing = false;
				editingJobId = null;

				currentJob.start = info.start;
				currentJob.end = addHours(info.start, 2);
				currentJob.title = "Window Cleaning"
				currentJob.clientId = null;
				currentJob.assignedCrew = ['Mike'];
				currentJob.areaOfTown = 'thane';
				currentJob.notes = '';
				currentJob.cancelReason = '';
				currentJob.cancelNotes = '';

				showJobForm = true;
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

			eventClick: async (info) => {
				const job = info.event.extendedProps as any;
				if (!job?.id) return;
				

				isEditing = true;
				editingJobId = job.id;

				currentJob.title = job.title;
				currentJob.start = new Date(job.start);
				currentJob.end = new Date(job.end);
				currentJob.clientId = job.clientId;
				currentJob.assignedCrew = [...(job.assignedCrew || [])];
				currentJob.areaOfTown = job.areaOfTown;
				currentJob.notes = job.notes || '';
				currentJob.cancelReason = job.cancelReason || '';
				currentJob.cancelNotes = job.cancelNotes || '';

				showJobForm = true;
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

	// Save or update job
	async function saveJob() {
		if (currentJob.end <= currentJob.start) {
			alert('End time must be after start time');
			return;
		}

		if (!currentJob.clientId) {
			alert('Please select a client');
			return;
		}

		try {
			if (isEditing && editingJobId) {
				await updateJob(editingJobId, {
					title: currentJob.title,
					start: currentJob.start,
					end: currentJob.end,
					clientId: currentJob.clientId,
					assignedCrew: [...currentJob.assignedCrew],
					areaOfTown: currentJob.areaOfTown,
					notes: currentJob.notes || undefined
				});
				alert('✅ Job updated successfully!');
			} else {
				await createJob({
					clientId: currentJob.clientId,
					title: currentJob.title,
					start: currentJob.start,
					end: currentJob.end,
					assignedCrew: [...currentJob.assignedCrew],
					areaOfTown: currentJob.areaOfTown
			});
				alert('✅ Job created successfully!');
			}

			showJobForm = false;
			calendarInstance?.refetchEvents();
		} catch (err) {
			console.error('Failed to save job', err);
			alert('❌ Error saving job - check console');
		}
	}

	//  Cancel confirmation dialog state
	let showCancelConfirm = $state(false);
	let selectedCancelReason = $state('');

	const cancelReasons = BUSINESS_CONFIG.cancelReasons;

	//  Handle job cancellation
	async function confirmCancel() {
		if (!editingJobId || !selectedCancelReason) {
			alert('Please select a reason');
			return;
		}

		try {
			await cancelJob(editingJobId, selectedCancelReason, currentJob.cancelNotes || undefined);
			showCancelConfirm = false;
			showJobForm = false;
			calendarInstance?.refetchEvents();
			alert('❌ Job cancelled successfully');
		} catch (err) {
			console.error('Failed to cancel job', err);
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
{#if showJobForm}
	<div class="new-job-modal">
		<div class="new-job-modal__content">
			<h2 class="new-job-modal__title">
				{isEditing ? 'Edit Job' : 'Create New Job'}
			</h2>

			<div class="new-job-modal__form">
				<div class="new-job-modal__field">
					<label for="job-title" class="new-job-modal__label">Title</label>
					<input id="job-title" class="new-job-modal__input" bind:value={currentJob.title} />
				</div>

				<!-- Added client picker component -->
				<div class="new-job-modal__field">
					<label for="client-picker" class="new-job-modal__label" >Client</label>
					<ClientPicker 
						bind:value={currentJob.clientId}
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
							value={toDatetimeLocal(currentJob.start)}
							oninput={(e) => currentJob.start = new Date((e.target as HTMLInputElement).value)} 
						/>
					</div>
					<div class="new-job-modal__field">
						<label for="job-end" class="new-job-modal__label">End</label>
						<input 
							id="job-end" 
							type="datetime-local" 
							class="new-job-modal__input" 
							value={toDatetimeLocal(currentJob.end)}
							oninput={(e) => currentJob.end = new Date((e.target as HTMLInputElement).value)}
							 />
					</div>
				</div>

				<div class="new-job-modal__field">
					<label for="job-area" class="new-job-modal__label">Area of Town</label>
					<select id="job-area" class="new-job-modal__input" bind:value={currentJob.areaOfTown}>
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
									checked={currentJob.assignedCrew.includes(crew)}
									onchange={(e) => {
										if ((e.currentTarget as HTMLInputElement).checked) {
											currentJob.assignedCrew = [...currentJob.assignedCrew, crew];
										} else {
											currentJob.assignedCrew = currentJob.assignedCrew.filter(c => c !== crew);
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
				{#if isEditing}
					<button 
						class="cancel-job-text"
						onclick={() => showCancelConfirm = true}
					>
						Cancel Job
					</button>
				{/if}

				<div class="actions-right">
					<button class="new-job-modal__btn new-job-modal__btn--cancel" onclick={() => { 
						showJobForm = false; 
						showCancelConfirm = false;
					}}>
						{isEditing ? 'Close' : 'Cancel'}
					</button>
					
					<button class="new-job-modal__btn new-job-modal__btn--primary" onclick={saveJob}>
						{isEditing ? 'Save Changes' : 'Create Job'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Cancel Confirmation Dialog -->
{#if showCancelConfirm}
	<div class="cancel-confirm-modal">
		<div class="cancel-confirm-modal__content">
			<h3 class="cancel-confirm-modal__title">Cancel Job?</h3>
			<p class="cancel-confirm-modal__subtitle">Please select a reason:</p>

			<div class="cancel-reasons">
				{#each cancelReasons as reason}
					<label class="reason-option">
						<input 
							type="radio" 
							name="cancelReason"
							value={reason}
							bind:group={selectedCancelReason}
						/>
						{reason}
					</label>
				{/each}
			</div>

			<div class="new-job-modal__field">
				<label class="new-job-modal__label">Additional notes (optional)</label>
				<textarea 
					class="new-job-modal__input" 
					rows="3"
					bind:value={currentJob.cancelNotes}
					placeholder="Any extra details..."
				></textarea>
			</div>

			<div class="cancel-confirm-modal__actions">
				<button 
					class="new-job-modal__btn new-job-modal__btn--cancel"
					onclick={() => showCancelConfirm = false}
				>
					Nevermind
				</button>
				<button 
					class="new-job-modal__btn new-job-modal__btn--cancel-job"
					onclick={confirmCancel}
					disabled={!selectedCancelReason}
				>
					Confirm Cancellation
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
		.new-job-modal__btn--cancel-job {
		background: transparent;
		color: #ef4444;
		border: 1px solid #ef4444;
	}

	.new-job-modal__btn--cancel-job:hover {
		background: #fee2e2;
	}

	/* Cancel Confirmation Modal */
	.cancel-confirm-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1100;
	}

	.cancel-confirm-modal__content {
		background: white;
		padding: 2rem;
		border-radius: 12px;
		min-width: 420px;
		max-width: 90%;
	}

	.cancel-confirm-modal__title {
		margin: 0 0 0.5rem 0;
		color: #ef4444;
	}

	.cancel-reasons {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 1rem 0;
	}
	.actions-right {
		display: flex;
		gap: 1rem;
	}
	.new-job-modal__actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 1rem;
	}
	.reason-option {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
	}
	.cancel-job-text {
		background: none;
		border: none;
		color: #ef4444;
		font-size: 0.95rem;
		cursor: pointer;
		padding: 0.5rem 0;
		text-decoration: underline;
		text-underline-offset: 3px;
		font-weight: 500;
	}

	.cancel-job-text:hover {
		color: #dc2626;
		text-decoration-thickness: 2px;
	}
</style>