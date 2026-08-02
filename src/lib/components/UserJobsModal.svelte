<!-- src/lib/components/UserJobsModal.svelte -->
<script lang="ts">
	import { getJobsForCrewMember, type Job } from '$lib/db';
	import { startOfLocalWeek } from '$lib/utils/dates';
	import { goto } from '$app/navigation';

	interface Props {
		// userId here is actually the value stored in job.assignedCrew (the crew member's name string)
		// not the DB id. Passed from CrewManagement using the user's .name
		userId: string;
		userName: string;
		onClose: () => void;
	}

	const { userId, userName, onClose }: Props = $props();

	let jobs = $state<Job[]>([]);

	const scheduleCutoff = startOfLocalWeek();

	const visibleJobs = $derived.by(() => {
		return jobs
			.filter((job) => {
				if (job.status === 'cancelled') return false;
				const start = new Date(job.start);
				return !isNaN(start.getTime()) && start >= scheduleCutoff;
			})
			.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
	});

	$effect(() => {
		loadJobs();
	});

	async function loadJobs() {
		// Use the safe helper (prefers the *assignedCrew multiEntry index; falls back gracefully on SchemaError
		// for any browser whose local DB upgrade to v21 hasn't run yet). The helper already dedups.
		jobs = await getJobsForCrewMember(userId);
	}

	function stopProp(e: Event) {
		e.stopPropagation();
	}

	function formatJobWhen(job: Job): string {
		const start = new Date(job.start);
		const end = job.end ? new Date(job.end) : null;
		const dateOpts: Intl.DateTimeFormatOptions = {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		};
		const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

		const startDate = start.toLocaleDateString('en-US', dateOpts);
		const startTime = start.toLocaleTimeString('en-US', timeOpts);

		if (!end || isNaN(end.getTime())) {
			return `${startDate} · ${startTime}`;
		}

		const sameDay = start.toDateString() === end.toDateString();
		if (sameDay) {
			return `${startDate} · ${startTime} – ${end.toLocaleTimeString('en-US', timeOpts)}`;
		}

		return `${start.toLocaleDateString('en-US', dateOpts)} – ${end.toLocaleDateString('en-US', dateOpts)}`;
	}

	function jobHref(job: Job): string {
		const id = job.id || job.pbId;
		if (!id) return '/jobs';
		return `/jobs?jobId=${encodeURIComponent(id)}`;
	}

	function openJob(job: Job) {
		const href = jobHref(job);
		onClose();
		void goto(href);
	}
</script>

<div class="modal-overlay" role="presentation" onclick={onClose}>
	<div
		class="modal-content user-jobs-modal"
		role="dialog"
		aria-modal="true"
		aria-labelledby="user-jobs-modal-title"
		onclick={stopProp}
	>
		<h2 id="user-jobs-modal-title" class="modal__title user-jobs-modal__heading">
			Jobs for {userName}
		</h2>
		<p class="user-jobs-modal__subtitle">This week and upcoming assignments</p>

		<div class="user-jobs-modal__list">
			{#each visibleJobs as job (job.id || job.pbId)}
				<a
					class="user-jobs-modal__item"
					href={jobHref(job)}
					onclick={(e) => {
						e.preventDefault();
						openJob(job);
					}}
				>
					<div class="user-jobs-modal__item-main">
						<strong class="user-jobs-modal__title">{job.title || 'Untitled Job'}</strong>
						<span class="user-jobs-modal__when">{formatJobWhen(job)}</span>
					</div>
					{#if job.status}
						<span class="user-jobs-modal__status user-jobs-modal__status--{job.status}">
							{job.status}
						</span>
					{/if}
				</a>
			{:else}
				<p class="user-jobs-modal__empty">No jobs scheduled this week or upcoming.</p>
			{/each}
		</div>

		<button type="button" onclick={onClose} class="modal__btn modal__btn--close button">
			Close
		</button>
	</div>
</div>

<style>
	/* Base .modal-overlay and .modal-content come from globals.css (no internal padding).
	   Add mobile-friendly padding + safe-area for bottom-sheet on phones. */
	.user-jobs-modal {
		padding: var(--space-5) var(--space-4)
			calc(var(--space-5) + env(safe-area-inset-bottom, 0px));
		box-sizing: border-box;
	}

	.user-jobs-modal__heading {
		margin: 0 0 var(--space-2) 0;
	}

	.user-jobs-modal__subtitle {
		margin: 0 0 var(--space-4);
		font-size: var(--font-size-sm);
		color: var(--color-text-muted);
	}

	.user-jobs-modal__list {
		margin: 0 0 var(--space-4);
		max-height: min(60vh, 28rem);
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		-webkit-overflow-scrolling: touch;
	}

	.user-jobs-modal__item {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		transition: background var(--transition-fast);
		min-height: 44px; /* comfortable tap target on mobile */
		box-sizing: border-box;
	}

	.user-jobs-modal__item:hover,
	.user-jobs-modal__item:focus-visible {
		background: var(--color-surface-alt);
		outline: none;
	}

	.user-jobs-modal__item:active {
		background: var(--color-primary-soft);
	}

	.user-jobs-modal__item:last-child {
		border-bottom: none;
	}

	.user-jobs-modal__item-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.user-jobs-modal__title {
		font-size: var(--font-size-sm);
		color: var(--color-text);
	}

	.user-jobs-modal__when {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.user-jobs-modal__status {
		flex-shrink: 0;
		font-size: var(--font-size-xs);
		padding: 0.15rem 0.5rem;
		border-radius: var(--radius-full);
		font-weight: var(--font-weight-semibold);
		text-transform: capitalize;
	}

	.user-jobs-modal__status--scheduled {
		background: var(--color-primary-soft);
		color: var(--color-primary-emphasis);
	}

	.user-jobs-modal__status--confirmed {
		background: var(--color-success-soft);
		color: var(--color-success);
	}

	.user-jobs-modal__status--completed {
		background: var(--color-surface-alt);
		color: var(--color-text-muted);
	}

	.user-jobs-modal__empty {
		padding: var(--space-5) var(--space-4);
		margin: 0;
		text-align: center;
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
	}

	.modal__btn--close {
		padding: var(--space-3) var(--space-6);
		width: 100%;
	}

	@media (max-width: 768px) {
		.user-jobs-modal {
			/* Comfortable horizontal inset + home-indicator clearance on bottom sheets */
			padding: var(--space-4) var(--space-4)
				calc(var(--space-6) + env(safe-area-inset-bottom, 0px));
		}

		.user-jobs-modal__item {
			padding: var(--space-4);
		}

		.user-jobs-modal__list {
			max-height: min(55vh, 24rem);
		}
	}
</style>
