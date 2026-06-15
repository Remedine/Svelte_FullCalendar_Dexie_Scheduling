<!-- src/lib/components/UserJobsModal.svelte -->
<script lang="ts">
	import { getJobsForCrewMember } from '$lib/db';

	interface Props {
		// userId here is actually the value stored in job.assignedCrew (the crew member's name string)
		// not the DB id. Passed from CrewManagement using the user's .name
		userId: string;
		userName: string;
		onClose: () => void;
	}

	const { userId, userName, onClose }: Props = $props();

	let jobs = $state<any[]>([]);

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
</script>

<div class="modal-overlay" onclick={onClose}>
	<div class="modal-content" onclick={stopProp}>
		<h2 class="modal__title">Jobs for {userName}</h2>

		<div class="jobs-list">
			{#each jobs as job (job.id || job.pbId)}
				<div class="job-item">
					<strong>{job.title}</strong><br />
					{new Date(job.start).toLocaleDateString()} – {new Date(job.end).toLocaleDateString()}
				</div>
			{:else}
				<p>No jobs assigned yet.</p>
			{/each}
		</div>

		<button onclick={onClose} class="modal__btn modal__btn--close button">Close</button>
	</div>
</div>

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: var(--z-modal-backdrop);
	}
	.modal-content {
		background: var(--color-surface);
		border-radius: var(--radius-md);
		width: 90%;
		max-width: 500px;
		padding: var(--space-6);
		max-height: 90vh;
		overflow-y: auto;
	}
	.jobs-list {
		margin: var(--space-4) 0;
	}
	.job-item {
		padding: var(--space-3);
		border-bottom: 1px solid var(--color-border);
	}
	.modal__btn--close {
		/* uses base .button */
		padding: var(--space-3) var(--space-6);
	}
</style>
