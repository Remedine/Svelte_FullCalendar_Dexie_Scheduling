<!-- src/routes/+page.svelte (or your main Calendar component) -->
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
	import BillableItemRow from '$lib/components/BillableItemRow.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { db } from '$lib/db';	

	let calendarEl: HTMLDivElement;
	let calendarInstance: Calendar | null = $state(null);

	// currentJob with billableItems (unchanged)
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
		cancelNotes: '' as string,
		billableItems: [{
			title: 'Full Exterior Window Cleaning',
			price: 100,
			quantity: 1,
			total: 100
		}] as Array<{
			title: string;
			price: number;
			quantity: number;
			total: number;
		}>
	});

	let isEditing = $state(false);
	let editingJobId = $state<number | null>(null);
	
	// Escape key support for both modals
	$effect(() => {
		if (showJobForm || showCancelConfirm) {
			const handleEscape = (e: KeyboardEvent) => {
				if (e.key === 'Escape') {
					if (showCancelConfirm) {
						showCancelConfirm = false;
					} else {
						showJobForm = false;
					}
				}
			};
			document.addEventListener('keydown', handleEscape);
			return () => document.removeEventListener('keydown', handleEscape);
		}
	})



	let crewOptions = $state<string[]>([]);

	//load active crew members
	$effect(() => {
		db.users
			.toArray()
			.then(users => {
				crewOptions = users
					.filter(u => u.active === true)
					.map(u => u.name)
					.sort();
			})
			.catch(err => {
				console.error('Failed to load crew:', err);
				crewOptions = [];
			});
	});

	const areaOptions = Object.entries(BUSINESS_CONFIG.areasOfTown).map(([key, value]) => ({
		value: key,
		label: value.label
	}));

	let subtotal = $derived.by(() => 
		currentJob.billableItems.reduce((sum, item) => sum + (item.total || 0), 0)
	);
	let taxAmount = $derived.by(() => Math.round(subtotal * BUSINESS_CONFIG.defaultTaxRate * 100) / 100);
	let totalAmount = $derived.by(() => subtotal + taxAmount); 

	function toDatetimeLocal(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}

	function addHours(date: Date, hours: number): Date {
		const result = new Date(date);
		result.setHours(result.getHours() + hours);
		return result;
	}

	function resetJobForm() {
		currentJob = {
			title: 'Full Exterior Window Cleaning',
			start: new Date(),
			end: new Date(),
			clientId: null,
			assignedCrew: ['Mike'],
			areaOfTown: 'thane',
			notes: '',
			cancelReason: '',
			cancelNotes: '',
			billableItems: [{
				title: 'Full Exterior Window Cleaning',
				price: 100,
				quantity: 1,
				total: 100
			}]
		};
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
				isEditing = false;
				editingJobId = null;
				resetJobForm();

				currentJob.start = info.start;
				currentJob.end = addHours(info.start, BUSINESS_CONFIG.defaultJobDurationHours || 4);
				currentJob.title = "Window Cleaning";

				showJobForm = true;
			},

			eventDrop: async (info) => {
				const jobId = info.event.id;
				if (!jobId) return;

				try {
					await updateJobDates(jobId, info.event.start!, info.event.end!);
					calendarInstance?.refetchEvents();
				} catch (err) {
					console.error('❌ Update failed', err);
					info.revert();
				}
			},

			eventResize: async (info) => {
				const jobId = info.event.id;
				if (!jobId) return;

				try {
					await updateJobDates(jobId, info.event.start!, info.event.end!);
					console.log(`✅ Job ${jobId} resized successfully`);
				} catch (err) {
					console.error('❌ Resize failed', err);
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
				currentJob.billableItems = job.billableItems?.length 
					? [...job.billableItems] 
					: [{
						title: job.title,
						price: 100,
						quantity: 1,
						total: 100
					}];

				showJobForm = true;
			},

			events: async (fetchInfo, successCallback) => {
				let jobs = await getJobsForRange(fetchInfo.start, fetchInfo.end);

				if (auth.currentUser?.role === 'crew') {
					jobs = jobs.filter((job: any) => 
						job.assignedCrew?.some((crewName: string) => 
							crewName === auth.currentUser!.name
						)
					);
				}

				const events = jobs.map((job: any) => ({
					id: job.id,                    // )=- Now string ID (was Number)
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

	function addBillableItem() {
		currentJob.billableItems = [
			...currentJob.billableItems,
			{ title: '', price: 0, quantity: 1, total: 0 }
		];
	}

	function removeBillableItem(index: number) {
		if (currentJob.billableItems.length <= 1) return;
		currentJob.billableItems = currentJob.billableItems.filter((_, i) => i !== index);
	}

	async function saveJob() {
	if (currentJob.end <= currentJob.start) {
		alert('End time must be after start time');
		return;
	}
	if (!currentJob.clientId) {
		alert('Please select a client');
		return;
	}

	const jobTitle = currentJob.billableItems[0]?.title || currentJob.title;

	try {
		const jobPayload = {
			title: jobTitle,
			start: currentJob.start,
			end: currentJob.end,
			clientId: currentJob.clientId,
			assignedCrew: [...currentJob.assignedCrew],
			areaOfTown: currentJob.areaOfTown,
			notes: currentJob.notes || undefined,
			billableItems: currentJob.billableItems.map(item => ({ ...item })),
			subtotal,
			taxRate: BUSINESS_CONFIG.defaultTaxRate,
			taxAmount,
			totalAmount
		};

		if (isEditing && editingJobId) {
			await updateJob(editingJobId, jobPayload);
			alert('✅ Job updated successfully!');
		} else {
			await createJob(jobPayload);           // )=- Now passes full payload
			alert('✅ Job created successfully!');
		}

		showJobForm = false;
		calendarInstance?.refetchEvents();
	} catch (err) {
		console.error('Failed to save job', err);
		alert('❌ Error saving job - check console');
	}
}

	let showCancelConfirm = $state(false);
	let selectedCancelReason = $state('');
	const cancelReasons = BUSINESS_CONFIG.cancelReasons;

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
	<!-- )=- Role indicator -->
		<div class="calendar-header__role">
			{#if auth.currentUser}
				<span class="calendar-header__role-badge {auth.currentUser.role}">
					{auth.currentUser.role === 'admin' ? '👑 Admin - All Jobs' : `👷 Crew View - ${auth.currentUser.name}`}
				</span>
			{/if}
		</div>

		<div bind:this={calendarEl} class="calendar-container"></div>
	
</div>

<!--  MOBILE-FIRST + CONTAINER-QUERY ENHANCED New Job Modal -->
{#if showJobForm}
	<div 
		class="new-job-modal"
		onclick={() => showJobForm = false}
	>
		<div 
			class="new-job-modal__content"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 class="new-job-modal__title">
				{isEditing ? 'Edit Job' : 'Create New Job'}
			</h2>

			<div class="new-job-modal__form">
				<div class="new-job-modal__field">
					<label for="job-title" class="new-job-modal__label">Job Title (optional)</label>
					<input id="job-title" class="new-job-modal__input" bind:value={currentJob.title} />
				</div>

				<div class="new-job-modal__field">
					<label for="client-picker" class="new-job-modal__label">Client</label>
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

				<fieldset class="new-job-modal__field">
					<legend class="new-job-modal__label">Crew / Assigned Staff</legend>
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

				<div class="new-job-modal__field">
					<label for="job-notes" class="new-job-modal__label">Notes / Special Instructions</label>
					<textarea
						id="job-notes"
						class="new-job-modal__input"
						rows="3"
						bind:value={currentJob.notes}
						placeholder="Gate code, dog in yard, ladder needed, etc..."
					></textarea>
				</div>

				<!-- Billable Items Section -->
				<div class="new-job-modal__field">
					<label class="new-job-modal__label">Billable Items</label>
					<div class="billable-items" style="container-type: inline-size; container-name: billable-row;">
						{#each currentJob.billableItems as item, index (index)}
							<BillableItemRow
								bind:item={currentJob.billableItems[index]}
								onRemove={() => removeBillableItem(index)}
								autofocusPrice={index === currentJob.billableItems.length - 1}
							/>
						{/each}
 
						<button
							type="button"
							class="new-job-modal__btn new-job-modal__btn-add"
							onclick={addBillableItem}
						>
							+ Add another item
						</button>
					</div>
				</div>

				<div class="totals-summary">
					<div>Subtotal: <strong>${subtotal.toFixed(2)}</strong></div>
					<div>Tax (5%): <strong>${taxAmount.toFixed(2)}</strong></div>
					<div class="totals-summary__total">Total: <strong>${totalAmount.toFixed(2)}</strong></div>
				</div>
			</div>

			<div class="new-job-modal__footer">
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

<!-- Cancel Confirmation Dialog (unchanged) -->
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

			<div class="cancel-confirm-modal__footer">
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

	/* ======================== MOBILE-FIRST MODAL ======================== */
	.new-job-modal {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1000;
	}

	.new-job-modal__content {
		background: white;
		width: 100%;
		max-width: 560px;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
		max-height: 95vh;
		overflow-y: auto;
		padding: 1.5rem 1rem;
		container-type: inline-size;
		container-name: job-modal;
	}

	.new-job-modal__title {
		margin: 0 0 1.5rem 0;
		font-size: 1.35rem;
		font-weight: 600;
		color: #1e2937;
	}

	.new-job-modal__form {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.new-job-modal__field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.new-job-modal__field-group {
		display: grid;
		grid-template-columns: 1fr;
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

	.billable-items {
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 1rem;
		background: #fafafa;
	}

	.totals-summary {
		background: #f8fafc;
		padding: 1rem;
		border-radius: 8px;
		border: 1px solid #e2e8f0;
		font-size: 1.05rem;
	}

	.totals-summary__total {
		font-size: 1.25rem;
		border-top: 2px solid #e2e8f0;
		padding-top: 0.75rem;
		margin-top: 0.75rem;
	}

	.new-job-modal__actions {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 2rem;
	}

	.actions-right {
		display: flex;
		gap: 1rem;
	}

	.new-job-modal__btn {
		padding: 0.85rem 1.5rem;
		border-radius: 8px;
		font-weight: 500;
		cursor: pointer;
		border: none;
		width: 100%;
	}

	.new-job-modal__btn--cancel {
		background: #f1f5f9;
		color: #475569;
	}

	.new-job-modal__btn--primary {
		background: #3b82f6;
		color: white;
	}

	.new-job-modal__btn-add {
		background: #e0f2fe;
		color: #0369a1;
		width: 100%;
		margin-top: 0.5rem;
	}

	/* Container Queries - much better than media queries for this modal */
	@container job-modal (min-width: 520px) {
		.new-job-modal__content {
			border-radius: 16px;
			padding: 2rem;
		}

		.new-job-modal__field-group {
			grid-template-columns: 1fr 1fr;
		}

		.new-job-modal__actions {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}

		.new-job-modal__btn {
			width: auto;
		}
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
		max-width: 420px;
		width: 90%;
	}
	.new-job-modal__footer {
		position: sticky;
		bottom: 0;
		background: white;
		padding: 1rem 1.25rem;
		border-top: 1px solid #e5e7eb;
		display: flex;
		gap: 0.75rem;
		justify-content: space-between;
		align-items: center;
		z-index: 10;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
	}
	.cancel-confirm-modal__footer {
		position: sticky;
		bottom: 0;
		background: white;
		padding: 1rem 1.25rem;
		border-top: 1px solid #e5e7eb;
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		z-index: 10;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
	}
			/* )=- Role badge (BEM) */
	.calendar-header__role {
		padding: 0.75rem 1rem;
		text-align: right;
		background: white;
		border-bottom: 1px solid #e2e8f0;
	}

	.calendar-header__role-badge {
		display: inline-block;
		padding: 0.4rem 1rem;
		border-radius: 9999px;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.calendar-header__role-badge.admin {
		background: #1e40af;
		color: white;
	}

	.calendar-header__role-badge.crew {
		background: #166534;
		color: white;
	}
</style>