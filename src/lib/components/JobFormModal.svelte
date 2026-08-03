<!-- src/lib/components/JobFormModal.svelte -->
<script module>
	import { type Job } from '$lib/db';

	let modalInstance: {
		open: (job?: any, onAfterSave?: () => void) => void;
	} | null = null;

	export function openJobModal(job?: Partial<any>, onAfterSave?: () => void) {
		if (modalInstance) {
			modalInstance.open(job, onAfterSave);
		} else {
			console.warn('JobFormModal not yet mounted');
		}
	}
</script>

<script lang="ts">
	import {
		createJob,
		updateJob,
		cancelJob,
		rescheduleCancelledJob,
		updateClient,
		ensureInvoiceForJob
	} from '$lib/db';
	import ClientPicker from './ClientPicker.svelte';
	import BillableItemRow from './BillableItemRow.svelte';
	import AreaSelect from './AreaSelect.svelte';
	import { optionsStore } from '$lib/stores/options.svelte';
	import { normalizeTaxRateToPercent } from '$lib/utils/tax';
	import { db, type Client, cleanupDuplicateUsers, getUserPhotoSrc } from '$lib/db';
	import { goto } from '$app/navigation';
	import { createBackdropDismiss } from '$lib/utils/modalBackdrop';

	let show = $state(false);
	let isEditing = $state(false);
	let editingJobId = $state<string | null>(null);
	let showCancelConfirm = $state(false);
	let isUpdatingCancelReason = $state(false);
	let showRescheduleHighlight = $state(false);
	let completingJob = $state(false);
	let selectedCancelReason = $state('');

	let currentJob = $state<any>({
		title: 'Full Exterior Window Cleaning',
		start: new Date(),
		end: new Date(),
		clientId: null,
		assignedCrew: [],
		areaOfTown: '',
		notes: '',
		cancelReason: '',
		cancelNotes: '',
		billableItems: [{ title: '', price: 0, quantity: 1, total: 0 }]
	});

	let crewOptions = $state<string[]>([]);
	let crewPhotoMap = $state<Record<string, string>>({});
	/** Selected client for contact fields under ClientPicker (phone / email / service address). */
	let selectedClient = $state<Client | null>(null);
	/** Editable contact form bound to the selected client; persisted via updateClient on job save. */
	let contactForm = $state({
		phone: '',
		email: '',
		serviceAddressStreet: '',
		serviceAddressCity: '',
		serviceAddressState: '',
		serviceAddressZip: ''
	});
	/** Tracks which client id the contact form was seeded from (avoids clobbering in-progress edits). */
	let contactFormClientId = $state<string | null>(null);
	let afterSaveCallback: (() => void) | null = null;

	const areaOptions = $derived(
		(optionsStore.data?.areasOfTown || []).map((area: any) => ({
			value: area.id,
			label: area.label,
			color: area.color
		}))
	);

	const cancelReasons = $derived(optionsStore.data?.cancelReasons || []);
	const defaultBillableItems = $derived(optionsStore.data?.defaultBillableItems || []);

	// Register this instance
	$effect(() => {
		modalInstance = {
			open: async (job?: any, callback?: () => void) => {
				afterSaveCallback = callback || null;

				if (!optionsStore.data) {
					await optionsStore.load?.();
				}
				// )=- Try to pull fresh options from PB when opening job modal (so areas, durations, billables from options page are up to date).
				// Guarded by auth in the store; falls back to local/default if not possible.
				if (navigator.onLine) {
					await optionsStore.pullFromPB?.();
				}

				if (job) {
					const startDate = job.start instanceof Date ? job.start : new Date(job.start);

					let endDate;

					if (job.end instanceof Date && !isNaN(job.end.getTime())) {
						endDate = job.end;
					} else {
						// Use the correct field name from options
						const durationHours = optionsStore.data?.defaultJobDurationHours ?? 2;
						endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);
					}

					currentJob = {
						...job,
						start: startDate,
						end: endDate,
						areaOfTown: job.areaOfTown ?? '',
						assignedCrew: job.assignedCrew || [],
						billableItems: job.billableItems?.length
							? job.billableItems.map((b: any) => {
								// Normalize legacy shape from options (uses 'hours' key for Per Hour) to form shape (quantity + unit)
								if (b.hours !== undefined) {
									return { ...b, quantity: b.hours, unit: 'hour' };
								}
								return { ...b, unit: b.unit || 'qty' };
							})
							: [{ title: '', price: 0, quantity: 1, total: 0, unit: 'qty' }]
					};

					isEditing = true;
					editingJobId = job.id || null;
				} else {
					// New job (when opened without passing a job object)
					const now = new Date();
					const durationHours = optionsStore.data?.defaultJobDurationHours ?? 2;

					currentJob = {
						title: 'Full Exterior Window Cleaning',
						start: now,
						end: new Date(now.getTime() + durationHours * 60 * 60 * 1000),
						clientId: null,
						assignedCrew: [],
						areaOfTown: areaOptions[0]?.value || '',
						notes: '',
						cancelReason: '',
						cancelNotes: '',
						billableItems: [{ title: '', price: 0, quantity: 1, total: 0, unit: 'qty' }]
					};

					isEditing = false;
					editingJobId = null;
				}

				showRescheduleHighlight = false;
				isUpdatingCancelReason = false;
				showCancelConfirm = false;
				selectedCancelReason = job?.cancelReason || '';

				show = true;
			}
		};
	});

	// Load crew members (with photos for avatars)
	$effect(() => {
		cleanupDuplicateUsers().then(() => {
			db.users.toArray().then((users: any[]) => {
				const active = users.filter((u) => u.active);
				crewOptions = Array.from(
					new Set(
						active.map((u) => u.name)
					)
				).sort();
				// Build photo map (name -> src) so we can render avatars without names
				crewPhotoMap = {};
				active.forEach((u: any) => {
					if (u.name) {
						crewPhotoMap[u.name] = getUserPhotoSrc(u.photo, u) || '';
					}
				});
			});
		});
	});

	// Area sync from client → job happens only in ClientPicker onSelect (user picks a client).
	// Do NOT auto-sync on clientId bind when opening edit — that overwrote the job's saved area
	// with the client's area (e.g. always showing Valley).

	// Load client for the editable contact block under ClientPicker (edit open + picker change).
	$effect(() => {
		const clientId = currentJob.clientId as string | null | undefined;
		if (!show || !clientId) {
			selectedClient = null;
			return;
		}
		let cancelled = false;
		void db.clients.get(clientId).then((c) => {
			if (!cancelled) selectedClient = c || null;
		});
		return () => {
			cancelled = true;
		};
	});

	// Seed contact form when the selected client identity changes (not on every field keystroke).
	$effect(() => {
		const client = selectedClient;
		const id = client?.id ?? null;
		if (id === contactFormClientId) return;
		contactFormClientId = id;
		if (client) {
			contactForm = {
				phone: client.phone || '',
				email: client.email || '',
				serviceAddressStreet: client.serviceAddressStreet || '',
				serviceAddressCity: client.serviceAddressCity || '',
				serviceAddressState: client.serviceAddressState || '',
				serviceAddressZip: client.serviceAddressZip || ''
			};
		} else {
			contactForm = {
				phone: '',
				email: '',
				serviceAddressStreet: '',
				serviceAddressCity: '',
				serviceAddressState: '',
				serviceAddressZip: ''
			};
		}
	});

	function formatPhone(value: string): string {
		const digits = value.replace(/\D/g, '');
		if (digits.length === 0) return '';
		if (digits.length <= 3) return `(${digits}`;
		if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
		return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
	}

	function isValidEmail(value: string): boolean {
		return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
	}

	/** Persist contact fields to the selected client (and area backfill when client has none). */
	async function saveClientContactFromForm(): Promise<boolean> {
		if (!currentJob.clientId) return true;

		const email = (contactForm.email || '').trim();
		if (email && !isValidEmail(email)) {
			alert('Please enter a valid email address for the client.');
			return false;
		}

		const client = await db.clients.get(currentJob.clientId);
		if (!client) return true;

		const phone = (contactForm.phone || '').trim();
		const serviceAddressStreet = (contactForm.serviceAddressStreet || '').trim();
		const serviceAddressCity = (contactForm.serviceAddressCity || '').trim();
		const serviceAddressState = (contactForm.serviceAddressState || '').trim().toUpperCase();
		const serviceAddressZip = (contactForm.serviceAddressZip || '').trim();
		const areaOfTown = client.areaOfTown || currentJob.areaOfTown || '';

		const unchanged =
			(client.phone || '') === phone &&
			(client.email || '') === email &&
			(client.serviceAddressStreet || '') === serviceAddressStreet &&
			(client.serviceAddressCity || '') === serviceAddressCity &&
			(client.serviceAddressState || '') === serviceAddressState &&
			(client.serviceAddressZip || '') === serviceAddressZip &&
			// Area backfill only when client had none and job has one
			!(!client.areaOfTown && currentJob.areaOfTown);

		if (unchanged) return true;

		await updateClient(currentJob.clientId, {
			...client,
			phone,
			email,
			serviceAddressStreet,
			serviceAddressCity,
			serviceAddressState,
			serviceAddressZip,
			areaOfTown,
			updatedAt: new Date()
		});

		// Keep local selection in sync for subsequent saves without reopening.
		selectedClient = {
			...client,
			phone,
			email,
			serviceAddressStreet,
			serviceAddressCity,
			serviceAddressState,
			serviceAddressZip,
			areaOfTown
		};
		return true;
	}

	// Scroll modal content to top when it opens
	$effect(() => {
		if (show) {
			setTimeout(() => {
				const content = document.querySelector('.new-job-modal__content');
				if (content) {
					content.scrollTop = 0;
				}
			}, 50);
		}
	});

	const subtotal = $derived(
		currentJob.billableItems.reduce((sum: number, item: any) => sum + (item.total || 0), 0)
	);

	const taxRatePercent = $derived(normalizeTaxRateToPercent(optionsStore.data?.taxRate, 8));
	const taxRateDecimal = $derived(taxRatePercent / 100);
	const taxAmount = $derived(Math.round(subtotal * taxRateDecimal * 100) / 100);
	const totalAmount = $derived(subtotal + taxAmount);

	function toDatetimeLocal(date: Date | null | undefined): string {
		if (!date) return '';
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}

	function addBillableItem() {
		currentJob.billableItems = [
			...currentJob.billableItems,
			{ title: '', price: 0, quantity: 1, total: 0, unit: 'qty' }
		];
	}

	function removeBillableItem(index: number) {
		if (currentJob.billableItems.length > 1) {
			currentJob.billableItems = currentJob.billableItems.filter((_: any, i: number) => i !== index);
		}
	}

	function parseJobDate(value: Date | string | undefined): Date | null {
		if (!value) return null;
		const date = value instanceof Date ? value : new Date(value);
		return isNaN(date.getTime()) ? null : date;
	}

	const jobEndDate = $derived(parseJobDate(currentJob.end));
	const canCompleteJob = $derived(
		isEditing &&
			!!editingJobId &&
			currentJob.status !== 'completed' &&
			currentJob.status !== 'cancelled' &&
			!!jobEndDate &&
			new Date() >= jobEndDate
	);

	function startReschedule() {
		showRescheduleHighlight = true;
		requestAnimationFrame(() => {
			document.getElementById('job-start')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		});
	}

	function openUpdateCancelReason() {
		selectedCancelReason = currentJob.cancelReason || '';
		isUpdatingCancelReason = true;
		showCancelConfirm = true;
	}

	function closeCancelConfirm() {
		showCancelConfirm = false;
		isUpdatingCancelReason = false;
	}

	async function saveJob() {
		if (!currentJob.clientId) {
			alert('Please select a client');
			return;
		}

		const startDate = parseJobDate(currentJob.start);
		const endDate = parseJobDate(currentJob.end);

		if (!startDate || !endDate) {
			alert('Please enter valid start and end times.');
			return;
		}

		if (showRescheduleHighlight) {
			const now = new Date();
			if (startDate <= now || endDate <= now) {
				alert('Start and end times must be in the future to reschedule a cancelled job.');
				return;
			}
			if (endDate <= startDate) {
				alert('End time must be after start time.');
				return;
			}
		}

		// Persist phone / email / service address edits to the client, and backfill areaOfTown
		// when the client has none but the job does.
		if (!(await saveClientContactFromForm())) return;

		const cleanPayload = {
			title: currentJob.title || 'Untitled Job',
			start: startDate,
			end: endDate,
			clientId: currentJob.clientId,
			assignedCrew: currentJob.assignedCrew || [],
			areaOfTown: currentJob.areaOfTown,
			notes: currentJob.notes || undefined,
			billableItems: currentJob.billableItems.map((item: any) => ({ ...item })),
			subtotal,
			taxRate: taxRatePercent,
			taxAmount,
			totalAmount,
			status: isEditing ? currentJob.status || 'scheduled' : 'scheduled'
		};

		try {
			if (isEditing && editingJobId) {
				if (showRescheduleHighlight && currentJob.status === 'cancelled') {
					await rescheduleCancelledJob(editingJobId, cleanPayload);
				} else {
					await updateJob(editingJobId, cleanPayload);
				}
			} else {
				await createJob(cleanPayload);
			}

			showRescheduleHighlight = false;
			show = false;

			if (afterSaveCallback) {
				setTimeout(() => afterSaveCallback(), 450);
			}
		} catch (err) {
			console.error('Failed to save job', err);
			alert('Error saving job - check console');
		}
	}

	async function confirmCancel() {
		if (!editingJobId || !selectedCancelReason) return;

		if (isUpdatingCancelReason) {
			if (currentJob.status !== 'cancelled') {
				closeCancelConfirm();
				return;
			}
			await cancelJob(editingJobId, selectedCancelReason, currentJob.cancelNotes);
			currentJob.cancelReason = selectedCancelReason;
			closeCancelConfirm();
			return;
		}

		// )=- Extra runtime guard: do not allow cancelling completed jobs even if UI button was somehow shown.
		if (currentJob.status === 'completed' || currentJob.status === 'cancelled') {
			alert('Cannot cancel a completed or already-cancelled job.');
			closeCancelConfirm();
			return;
		}
		await cancelJob(editingJobId, selectedCancelReason, currentJob.cancelNotes);
		show = false;
		closeCancelConfirm();
		if (afterSaveCallback) afterSaveCallback();
	}

	function closeModal() {
		show = false;
		showRescheduleHighlight = false;
		closeCancelConfirm();
	}

	// Only close when pointerdown + click both hit the overlay (not text-select drag-outs)
	const mainBackdrop = createBackdropDismiss(closeModal);
	const cancelBackdrop = createBackdropDismiss(closeCancelConfirm);

	async function completeJobAndGoToInvoice() {
		if (!editingJobId || !canCompleteJob || completingJob) return;

		if (!currentJob.clientId) {
			alert('Please select a client before completing the job.');
			return;
		}

		const startDate = parseJobDate(currentJob.start);
		const endDate = parseJobDate(currentJob.end);
		if (!startDate || !endDate) {
			alert('Please enter valid start and end times.');
			return;
		}

		completingJob = true;
		try {
			if (!(await saveClientContactFromForm())) return;

			const cleanPayload = {
				title: currentJob.title || 'Untitled Job',
				start: startDate,
				end: endDate,
				clientId: currentJob.clientId,
				assignedCrew: currentJob.assignedCrew || [],
				areaOfTown: currentJob.areaOfTown,
				notes: currentJob.notes || undefined,
				billableItems: currentJob.billableItems.map((item: any) => ({ ...item })),
				subtotal,
				taxRate: taxRatePercent,
				taxAmount,
				totalAmount,
				status: 'completed' as const
			};

			await updateJob(editingJobId, cleanPayload);

			const freshJob = await db.jobs.get(editingJobId);
			if (freshJob) {
				await ensureInvoiceForJob(freshJob, 'generated');
			}

			const jobId = editingJobId;
			show = false;
			showRescheduleHighlight = false;
			closeCancelConfirm();

			if (afterSaveCallback) {
				afterSaveCallback();
			}

			await goto(`/jobs?jobId=${encodeURIComponent(jobId)}&tab=invoice`);
		} catch (err) {
			console.error('Failed to complete job', err);
			alert('Error completing job — check console');
		} finally {
			completingJob = false;
		}
	}
</script>

<!-- Main Modal -->
{#if show}
	<div
		class="modal-overlay new-job-modal"
		role="presentation"
		onpointerdown={mainBackdrop.onpointerdown}
		onclick={mainBackdrop.onclick}
	>
		<div
			class="modal-content new-job-modal__content"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.stopPropagation();
					closeModal();
				}
			}}
		>
			<div class="new-job-modal__header">
				<h2 class="new-job-modal__title">
					{isEditing ? 'Edit Job' : 'Create New Job'}
				</h2>
				{#if isEditing && currentJob.status === 'cancelled'}
					<div class="new-job-modal__header-meta">
						<span class="new-job-modal__status new-job-modal__status--cancelled">Cancelled</span>
						{#if currentJob.cancelReason}
							<span class="new-job-modal__cancel-detail">{currentJob.cancelReason}</span>
						{/if}
					</div>
				{/if}
			</div>

			{#if canCompleteJob}
				<div class="new-job-modal__complete-banner">
					<button
						type="button"
						class="new-job-modal__complete-btn button"
						onclick={completeJobAndGoToInvoice}
						disabled={completingJob}
					>
						{completingJob ? 'Completing…' : 'Click to complete'}
					</button>
				</div>
			{/if}

			<div class="new-job-modal__form">
				<!-- Job Title -->
				<div class="new-job-modal__field">
					<label for="job-title" class="new-job-modal__label label">Job Title (optional)</label>
					<input id="job-title" class="new-job-modal__input input" bind:value={currentJob.title} />
				</div>

				<!-- Client -->
				<div class="new-job-modal__field">
					<label for="client-picker" class="new-job-modal__label label">Client</label>

					<ClientPicker
						bind:value={currentJob.clientId}
						allowCreate={true}
						placeholder="Select or create client..."
						onSelect={(client: Client) => {
							// )=- When client selected (existing or newly created inline), auto-set job area to client's area if present.
							// This enforces the common case that job and client share the same areaOfTown.
							if (client?.areaOfTown) {
								currentJob.areaOfTown = client.areaOfTown;
							}
							// Immediate contact card (also reloaded from Dexie when clientId changes).
							selectedClient = client || null;
							console.log('✅ Client selected:', client.name);
						}}
						onCreate={async (name: string) => {
							console.log('New client created inline:', name);
						}}
					/>

					{#if selectedClient}
						<div class="new-job-modal__client-contact" aria-live="polite">
							<span class="new-job-modal__client-contact-label">Contact</span>

							<div class="new-job-modal__client-contact-fields">
								<div class="new-job-modal__client-contact-field">
									<label for="job-client-street" class="new-job-modal__client-contact-field-label"
										>Service address</label
									>
									<input
										id="job-client-street"
										type="text"
										class="new-job-modal__input input"
										placeholder="Street"
										bind:value={contactForm.serviceAddressStreet}
										autocomplete="street-address"
									/>
								</div>

								<div class="new-job-modal__client-contact-address-row">
									<div class="new-job-modal__client-contact-field new-job-modal__client-contact-field--city">
										<label for="job-client-city" class="new-job-modal__client-contact-field-label"
											>City</label
										>
										<input
											id="job-client-city"
											type="text"
											class="new-job-modal__input input"
											placeholder="City"
											bind:value={contactForm.serviceAddressCity}
											autocomplete="address-level2"
										/>
									</div>
									<div class="new-job-modal__client-contact-field new-job-modal__client-contact-field--state">
										<label for="job-client-state" class="new-job-modal__client-contact-field-label"
											>State</label
										>
										<input
											id="job-client-state"
											type="text"
											class="new-job-modal__input input"
											placeholder="AK"
											maxlength="2"
											bind:value={contactForm.serviceAddressState}
											autocomplete="address-level1"
										/>
									</div>
									<div class="new-job-modal__client-contact-field new-job-modal__client-contact-field--zip">
										<label for="job-client-zip" class="new-job-modal__client-contact-field-label"
											>ZIP</label
										>
										<input
											id="job-client-zip"
											type="text"
											class="new-job-modal__input input"
											placeholder="ZIP"
											bind:value={contactForm.serviceAddressZip}
											autocomplete="postal-code"
										/>
									</div>
								</div>

								<div class="new-job-modal__client-contact-field">
									<label for="job-client-phone" class="new-job-modal__client-contact-field-label"
										>Phone</label
									>
									<input
										id="job-client-phone"
										type="tel"
										class="new-job-modal__input input"
										placeholder="(907) 555-1234"
										bind:value={contactForm.phone}
										oninput={(e) =>
											(contactForm.phone = formatPhone((e.target as HTMLInputElement).value))}
									/>
								</div>

								<div class="new-job-modal__client-contact-field">
									<label for="job-client-email" class="new-job-modal__client-contact-field-label"
										>Email</label
									>
									<input
										id="job-client-email"
										type="email"
										class="new-job-modal__input input"
										placeholder="client@example.com"
										bind:value={contactForm.email}
										autocomplete="email"
									/>
								</div>
							</div>
						</div>
					{/if}
				</div>

				<!-- )=- Area of Town moved immediately under the Client picker (as requested).
             We also added backfill: on job save, if the selected client has no areaOfTown
             but the job does, we update the client. This keeps the common "client == job area" invariant
             without forcing the user to set it twice. -->
				<div class="new-job-modal__field">
					<span id="job-area-label" class="new-job-modal__label label">Area of Town</span>
					<AreaSelect
						id="job-area"
						labelId="job-area-label"
						bind:value={currentJob.areaOfTown}
						options={areaOptions}
					/>
				</div>

				<!-- Dates -->
				<div
					class="new-job-modal__field-group"
					class:new-job-modal__field-group--reschedule-highlight={showRescheduleHighlight}
				>
					<div class="new-job-modal__field">
						<label for="job-start" class="new-job-modal__label label">Start</label>
						<input
							id="job-start"
							type="datetime-local"
							class="new-job-modal__input input"
							class:new-job-modal__input--reschedule-highlight={showRescheduleHighlight}
							value={toDatetimeLocal(currentJob?.start)}
							oninput={(e) => {
								const val = (e.target as HTMLInputElement).value;
								if (val) currentJob.start = new Date(val);
							}}
						/>
					</div>

					<div class="new-job-modal__field">
						<label for="job-end" class="new-job-modal__label label">End</label>
						<input
							id="job-end"
							type="datetime-local"
							class="new-job-modal__input input"
							class:new-job-modal__input--reschedule-highlight={showRescheduleHighlight}
							value={toDatetimeLocal(currentJob?.end)}
							oninput={(e) => {
								const val = (e.target as HTMLInputElement).value;
								if (val) currentJob.end = new Date(val);
							}}
						/>
					</div>
				</div>

				<!-- Crew: avatar multi-select. Selected = dual ring (surface gap + primary) + check badge
				     so selection still reads on blue/busy photos where a thin border alone fails. -->
				<fieldset class="new-job-modal__field">
					<legend class="new-job-modal__label label">
						Crew / Assigned Staff
						{#if currentJob.assignedCrew?.length}
							<span class="new-job-modal__crew-count">
								({currentJob.assignedCrew.length} assigned)
							</span>
						{/if}
					</legend>
					<div class="new-job-modal__crew-grid" role="group" aria-label="Assign crew">
						{#each crewOptions as crew (crew)}
							{@const isAssigned = currentJob.assignedCrew.includes(crew)}
							<label
								class="new-job-modal__crew-option"
								class:new-job-modal__crew-option--selected={isAssigned}
							>
								<input
									type="checkbox"
									checked={isAssigned}
									onchange={(e) => {
										const checked = (e.currentTarget as HTMLInputElement).checked;
										currentJob.assignedCrew = checked
											? [...currentJob.assignedCrew, crew]
											: currentJob.assignedCrew.filter((c: string) => c !== crew);
									}}
									aria-label={isAssigned ? `${crew}, assigned` : `${crew}, not assigned`}
								/>
								<span
									class="new-job-modal__crew-avatar"
									class:selected={isAssigned}
									title={crew}
								>
									<span class="new-job-modal__crew-avatar-face">
										{#if crewPhotoMap[crew]}
											<img src={crewPhotoMap[crew]} alt="" />
										{:else}
											<span class="initial">{crew?.charAt(0)?.toUpperCase() || '?'}</span>
										{/if}
									</span>
									{#if isAssigned}
										<span class="new-job-modal__crew-check" aria-hidden="true">
											<svg
												viewBox="0 0 16 16"
												width="10"
												height="10"
												fill="none"
												stroke="currentColor"
												stroke-width="2.4"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<path d="M3 8.5 6.5 12 13 4" />
											</svg>
										</span>
									{/if}
								</span>
							</label>
						{/each}
					</div>
				</fieldset>

				<!-- Notes -->
				<div class="new-job-modal__field">
					<label for="job-notes" class="new-job-modal__label label">Notes / Special Instructions</label>
					<textarea
						id="job-notes"
						class="new-job-modal__input input"
						rows="3"
						bind:value={currentJob.notes}
						placeholder="Gate code, dog in yard, ladder needed..."
					></textarea>
				</div>

				<!-- Billable Items -->
				<div class="new-job-modal__field">
					<label id="billable-label" class="new-job-modal__label label">Billable Items</label>
					<div class="billable-items" role="group" aria-labelledby="billable-label">
						{#each currentJob.billableItems as item, index (index)}
							<BillableItemRow
								bind:item={currentJob.billableItems[index]}
								onRemove={() => removeBillableItem(index)}
							/>
						{/each}

						<button
							type="button"
							class="new-job-modal__btn new-job-modal__btn-add button"
							onclick={addBillableItem}
						>
							+ Add another item
						</button>
					</div>
				</div>

				<!-- Totals -->
				<div class="totals-summary">
					<div class="totals-summary__line">Subtotal: <strong>${subtotal.toFixed(2)}</strong></div>
					<div class="totals-summary__line">Tax ({taxRatePercent.toFixed(1)}%):</div>
					<div class="totals-summary__total">Total: <strong>${totalAmount.toFixed(2)}</strong></div>
				</div>
			</div>

			<!-- Sticky Footer / Anchored actions.
			     Per request: Close + Save Changes on one line, right aligned.
			     Cancel Job on next line, right aligned, text-only red (de-emphasized).
			     Primary actions always visible at bottom of modal view. -->
			<div class="new-job-modal__footer sticky-footer">
				<div class="new-job-modal__footer-bar">
					<div class="new-job-modal__footer-main">
						<button class="new-job-modal__btn new-job-modal__btn--close button" onclick={closeModal}>
							{isEditing ? 'Close' : 'Cancel'}
						</button>

						<button
							class="new-job-modal__btn button button--primary"
							class:new-job-modal__btn--reschedule-highlight={showRescheduleHighlight}
							onclick={saveJob}
						>
							{showRescheduleHighlight
								? 'Save reschedule'
								: isEditing
									? 'Save Changes'
									: 'Create Job'}
						</button>
					</div>

					{#if isEditing && currentJob.status !== 'completed' && currentJob.status !== 'cancelled'}
						<div class="new-job-modal__footer-sub">
							<button class="cancel-job-text" onclick={() => (showCancelConfirm = true)}>
								Cancel Job
							</button>
						</div>
					{/if}

					{#if isEditing && currentJob.status === 'cancelled'}
						<div class="new-job-modal__footer-sub new-job-modal__cancelled-actions">
							<button
								type="button"
								class="new-job-modal__secondary-action"
								onclick={openUpdateCancelReason}
							>
								Update cancel reason
							</button>
							<button
								type="button"
								class="new-job-modal__secondary-action new-job-modal__secondary-action--reschedule"
								onclick={startReschedule}
							>
								Reschedule
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Cancel Confirmation (stacked above the job form modal) -->
{#if showCancelConfirm}
	<div
		class="modal-overlay cancel-confirm-modal"
		role="presentation"
		onpointerdown={cancelBackdrop.onpointerdown}
		onclick={cancelBackdrop.onclick}
	>
		<div
			class="modal-content cancel-confirm-modal__content"
			role="dialog"
			aria-modal="true"
			aria-labelledby="cancel-confirm-title"
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.stopPropagation();
					closeCancelConfirm();
				}
			}}
		>
			<div class="cancel-confirm-modal__body">
				<h3 id="cancel-confirm-title" class="cancel-confirm-modal__title">
					{isUpdatingCancelReason ? 'Update cancel reason' : 'Cancel Job?'}
				</h3>
				<p class="cancel-confirm-modal__subtitle">Please select a reason:</p>

				<div class="cancel-confirm-modal__reasons" role="radiogroup" aria-label="Cancellation reason">
					{#each cancelReasons as reason (reason)}
						<label class="cancel-confirm-modal__reason-option">
							<input
								type="radio"
								name="cancelReason"
								value={reason}
								bind:group={selectedCancelReason}
							/>
							<span class="cancel-confirm-modal__reason-label">{reason}</span>
						</label>
					{/each}
				</div>

				<div class="cancel-confirm-modal__notes-field">
					<label for="cancel-notes" class="label">Additional notes (optional)</label>
					<textarea
						id="cancel-notes"
						class="input cancel-confirm-modal__notes-input"
						rows="3"
						bind:value={currentJob.cancelNotes}
						placeholder="Any extra details..."
					></textarea>
				</div>
			</div>

			<div class="cancel-confirm-modal__footer">
				<button
					type="button"
					class="cancel-confirm-modal__btn cancel-confirm-modal__btn--dismiss button button--ghost"
					onclick={closeCancelConfirm}
				>
					Nevermind
				</button>
				<button
					type="button"
					class="cancel-confirm-modal__btn cancel-confirm-modal__btn--confirm button"
					onclick={confirmCancel}
					disabled={!selectedCancelReason}
				>
					{isUpdatingCancelReason ? 'Save reason' : 'Confirm Cancellation'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* JobFormModal now leans heavily on globals.css primitives (.input, .label, .button) + design tokens
	   for cohesion. BEM kept for specific structure and overrides. All colors/spacing/radii via vars. */

	/* Base .new-job-modal shell now uses global .modal-overlay + .modal-content for cohesion.
	   (global handles mobile bottom-sheet). Only prefixed BEM extensions here. */

	.new-job-modal__header {
		padding: var(--space-6) var(--space-4) 0;
	}

	.new-job-modal__title {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	/* Editable contact block under ClientPicker (address, phone, email). */
	.new-job-modal__client-contact {
		margin-top: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		background: var(--color-surface-muted, var(--color-bg-subtle, transparent));
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		/* Contain grid so address columns can shrink without overflow/overlap. */
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}

	.new-job-modal__client-contact-label {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}

	.new-job-modal__client-contact-fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.new-job-modal__client-contact-field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.new-job-modal__client-contact-field-label {
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		color: var(--color-text-muted);
	}

	/* City / State / ZIP — flexible fractions (not fixed rem caps) so padded .input
	   never overflows and overlaps neighbors on narrow modal widths. */
	.new-job-modal__client-contact-address-row {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 0.7fr) minmax(0, 1fr);
		gap: var(--space-2);
		align-items: end;
		min-width: 0;
		width: 100%;
	}

	.new-job-modal__client-contact-address-row .new-job-modal__input {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}

	/* Compact padding so 2-letter state and ZIP fit without colliding. */
	.new-job-modal__client-contact-field--state .new-job-modal__input,
	.new-job-modal__client-contact-field--zip .new-job-modal__input {
		padding-left: var(--space-2);
		padding-right: var(--space-2);
		text-align: center;
	}

	.new-job-modal__client-contact-field--state .new-job-modal__input {
		text-transform: uppercase;
	}

	.new-job-modal__header-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.new-job-modal__status {
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.6rem;
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-semibold);
		text-transform: uppercase;
	}

	.new-job-modal__status--cancelled {
		background: var(--color-danger-soft);
		color: var(--color-danger-emphasis);
	}

	.new-job-modal__cancel-detail {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.new-job-modal__complete-banner {
		padding: 0 var(--space-4) var(--space-2);
	}

	.new-job-modal__complete-btn {
		width: 100%;
		background: var(--color-success);
		border-color: var(--color-success);
		color: white;
		font-weight: var(--font-weight-semibold);
	}

	.new-job-modal__complete-btn:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-success) 88%, black);
		border-color: color-mix(in srgb, var(--color-success) 88%, black);
	}

	.new-job-modal__complete-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.new-job-modal__form {
		flex: 1;
		overflow-y: auto;
		margin-top: var(--space-6);
		padding: 0 var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.new-job-modal__field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.new-job-modal__field-group {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-4);
	}

	/* .new-job-modal__label now relies entirely on the .label primitive from globals.css */

	/* .new-job-modal__input relies on global .input primitive */

	.new-job-modal__crew-count {
		margin-left: 0.35em;
		font-weight: var(--font-weight-medium);
		text-transform: none;
		letter-spacing: normal;
		color: var(--color-primary);
		font-size: var(--font-size-sm);
	}

	.new-job-modal__crew-grid {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		padding: var(--space-2) 0;
	}

	.new-job-modal__crew-option {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.new-job-modal__crew-option input[type='checkbox'] {
		position: absolute;
		opacity: 0;
		pointer-events: none;
		width: 0;
		height: 0;
	}

	/* Outer shell: room for dual ring + check badge (overflow visible). */
	.new-job-modal__crew-avatar {
		position: relative;
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			opacity 0.15s ease;
	}

	/* Unassigned stay quieter so assigned faces read as the active set. */
	.new-job-modal__crew-option:not(.new-job-modal__crew-option--selected)
		.new-job-modal__crew-avatar {
		opacity: 0.72;
	}

	.new-job-modal__crew-option:hover .new-job-modal__crew-avatar {
		opacity: 1;
	}

	.new-job-modal__crew-avatar-face {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid var(--color-border);
		background: var(--color-surface-alt);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-muted);
		box-sizing: border-box;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			transform 0.15s ease;
	}

	/* Dual ring: surface gap + primary outer — never blends into photo blues. */
	.new-job-modal__crew-avatar.selected .new-job-modal__crew-avatar-face {
		border-color: var(--color-surface, #fff);
		box-shadow:
			0 0 0 2px var(--color-surface, #fff),
			0 0 0 4px var(--color-primary);
		transform: scale(1.04);
	}

	.new-job-modal__crew-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.new-job-modal__crew-avatar .initial {
		text-transform: uppercase;
	}

	/* Selection badge — high-signal affordance independent of photo colors. */
	.new-job-modal__crew-check {
		position: absolute;
		right: -1px;
		bottom: -1px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: var(--color-primary);
		color: #fff;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px solid var(--color-surface, #fff);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.22);
		pointer-events: none;
		z-index: 1;
	}

	.new-job-modal__crew-option input[type='checkbox']:focus-visible
		+ .new-job-modal__crew-avatar
		.new-job-modal__crew-avatar-face {
		outline: 2px solid var(--color-primary);
		outline-offset: 3px;
	}

	.billable-items {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		background: var(--color-surface-alt);
		/* Group the billable rows with consistent internal spacing */
	}


	.totals-summary {
		background: var(--color-surface-alt);
		padding: var(--space-4);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border);
		font-size: var(--font-size-base);
		margin-bottom: var(--space-3);
	}

	.totals-summary__line {
		color: var(--color-text-muted);
	}

	.totals-summary__total {
		font-size: var(--font-size-xl);
		border-top: 2px solid var(--color-border);
		padding-top: var(--space-3);
		margin-top: var(--space-3);
	}

	.new-job-modal__footer {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-1);
	}

	.new-job-modal__footer-bar {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 100%;
	}

	.new-job-modal__footer-main {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		width: 100%;
	}

	.new-job-modal__footer-sub {
		display: flex;
		justify-content: flex-end;
		width: 100%;
	}

	.new-job-modal__btn {
		/* base .button provides core button styles; these add modal-specific sizing */
		padding: var(--space-3) var(--space-6);
	}

	.new-job-modal__btn--close {
		background: var(--color-surface);
		border: 1px solid var(--color-border-strong);
		color: var(--color-text);
	}

	.new-job-modal__btn--close:hover:not(:disabled) {
		background: var(--color-surface-alt);
		border-color: var(--color-border-strong);
	}

	.new-job-modal__btn-add {
		width: 100%;
		margin-top: var(--space-3);
		background: var(--color-primary-soft);
		color: var(--color-primary);
	}

	/* Cancel confirmation — stacked above the job form modal (global shell + BEM extensions). */
	.cancel-confirm-modal {
		z-index: calc(var(--z-modal-backdrop) + 100);
	}

	.cancel-confirm-modal__content {
		max-width: 420px;
		padding: 0;
	}

	.cancel-confirm-modal__body {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.cancel-confirm-modal__title {
		margin: 0;
		font-size: var(--font-size-xl);
		font-weight: var(--font-weight-semibold);
		color: var(--color-text);
	}

	.cancel-confirm-modal__subtitle {
		margin: 0;
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.cancel-confirm-modal__reasons {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.cancel-confirm-modal__reason-option {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 48px;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		cursor: pointer;
		transition:
			border-color var(--transition-fast),
			background var(--transition-fast);
	}

	.cancel-confirm-modal__reason-option:has(input:checked) {
		border-color: var(--color-primary);
		background: var(--color-primary-soft);
	}

	.cancel-confirm-modal__reason-option input[type='radio'] {
		width: 1.125rem;
		height: 1.125rem;
		flex-shrink: 0;
		margin: 0;
		accent-color: var(--color-primary);
	}

	.cancel-confirm-modal__reason-label {
		font-size: var(--font-size-base);
		color: var(--color-text);
		line-height: 1.35;
	}

	.cancel-confirm-modal__notes-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.cancel-confirm-modal__notes-input {
		width: 100%;
		min-height: 5.5rem;
		resize: vertical;
	}

	.cancel-confirm-modal__footer {
		position: sticky;
		bottom: 0;
		background: var(--color-surface);
		padding: var(--space-4) var(--space-5);
		padding-bottom: max(var(--space-4), env(safe-area-inset-bottom, 0px));
		border-top: 1px solid var(--color-border);
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
		z-index: 10;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.08);
	}

	.cancel-confirm-modal__btn {
		padding: var(--space-3) var(--space-5);
		min-height: 44px;
	}

	.cancel-confirm-modal__btn--confirm {
		background: var(--color-danger);
		color: white;
		border-color: var(--color-danger);
	}

	.cancel-confirm-modal__btn--confirm:hover:not(:disabled) {
		background: var(--color-danger-emphasis);
		border-color: var(--color-danger-emphasis);
	}

	.cancel-confirm-modal__btn--confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cancel-job-text {
		color: var(--color-danger-emphasis);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		line-height: 1.2;
		text-align: right;
	}

	.new-job-modal__cancelled-actions {
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-1);
	}

	.new-job-modal__secondary-action {
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--font-size-xs);
		font-weight: var(--font-weight-medium);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}

	.new-job-modal__secondary-action--reschedule {
		border-color: var(--color-primary);
		color: var(--color-primary-emphasis);
		background: var(--color-primary-soft);
	}

	.new-job-modal__input--reschedule-highlight,
	.new-job-modal__field-group--reschedule-highlight {
		outline: 2px solid var(--color-warning);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}

	.new-job-modal__field-group--reschedule-highlight {
		padding: var(--space-2);
		animation: new-job-modal-reschedule-pulse 1.2s ease-in-out infinite;
	}

	.new-job-modal__btn--reschedule-highlight {
		animation: new-job-modal-reschedule-pulse 1.2s ease-in-out infinite;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 35%, transparent);
	}

	@keyframes new-job-modal-reschedule-pulse {
		0%,
		100% {
			outline-color: var(--color-warning);
			box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-warning) 35%, transparent);
		}
		50% {
			outline-color: var(--color-primary);
			box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 30%, transparent);
		}
	}

	/* Calendar picker icon color for dark mode (the native indicator is dark by default) */
	.new-job-modal__input[type="datetime-local"]::-webkit-calendar-picker-indicator {
		filter: invert(0.2);
	}
	.dark .new-job-modal__input[type="datetime-local"]::-webkit-calendar-picker-indicator {
		filter: invert(1); /* white/light for dark mode */
	}

	/* Mobile tweaks for job form modal title (per request): reduce height by minimizing margin/padding,
	   slightly smaller font. Keeps a few pixels for visual breathing room. Desktop unchanged. */
	@media (max-width: 768px) {
		.new-job-modal__header {
			padding: 2px var(--space-2) 0;
		}

		.new-job-modal__title {
			font-size: var(--font-size-lg);
		}

		.new-job-modal__complete-banner {
			padding: 0 var(--space-2) var(--space-2);
		}

		.new-job-modal__complete-btn {
			min-height: 38px;
			padding: var(--space-2) var(--space-3);
			font-size: var(--font-size-sm);
		}

		.new-job-modal__form {
			margin-top: var(--space-2);
			padding: 0 var(--space-2);
			gap: var(--space-3);
		}

		.new-job-modal__field-group {
			gap: var(--space-2);
		}

		.new-job-modal__crew-grid {
			gap: var(--space-2);
		}

		.billable-items {
			padding: var(--space-1);
		}

		.totals-summary {
			padding: var(--space-2) var(--space-3);
			margin-bottom: var(--space-2);
		}

		.new-job-modal__footer {
			padding: var(--space-2);
			padding-bottom: max(var(--space-2), env(safe-area-inset-bottom, 0px));
			gap: 0;
		}

		.new-job-modal__footer-main .new-job-modal__btn {
			padding: var(--space-2) var(--space-3);
			min-height: 38px;
			font-size: var(--font-size-sm);
			white-space: nowrap;
		}

		.new-job-modal__secondary-action {
			padding: var(--space-1) var(--space-2);
			font-size: var(--font-size-xs);
		}

		.cancel-confirm-modal__content {
			max-width: 100%;
			max-height: 90vh;
		}

		.cancel-confirm-modal__body {
			padding: var(--space-3) var(--space-2) var(--space-2);
			gap: var(--space-3);
		}

		.cancel-confirm-modal__title {
			font-size: var(--font-size-lg);
		}

		.cancel-confirm-modal__reason-option {
			min-height: 52px;
			padding: var(--space-3);
		}

		.cancel-confirm-modal__footer {
			flex-direction: column-reverse;
			align-items: stretch;
			padding: var(--space-2);
			padding-bottom: max(var(--space-2), env(safe-area-inset-bottom, 0px));
			gap: var(--space-2);
		}

		.cancel-confirm-modal__btn {
			width: 100%;
			text-align: center;
			min-height: 48px;
		}
	}
</style>
