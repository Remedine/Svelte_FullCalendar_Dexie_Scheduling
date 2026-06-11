<!-- src/lib/components/UserJobsModal.svelte -->
<script lang="ts">
	import { db } from '$lib/db';

	interface Props {
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
		jobs = await db.jobs.where('assignedCrew').equals(userId).toArray();
	}

	function stopProp(e: Event) {
		e.stopPropagation();
	}
</script>

<div class="modal-overlay" onclick={onClose}>
	<div class="modal-content" onclick={stopProp}>
		<h2 class="modal__title">Jobs for {userName}</h2>

		<div class="jobs-list">
			{#each jobs as job}
				<div class="job-item">
					<strong>{job.title}</strong><br />
					{new Date(job.start).toLocaleDateString()} – {new Date(job.end).toLocaleDateString()}
				</div>
			{:else}
				<p>No jobs assigned yet.</p>
			{/each}
		</div>

		<button onclick={onClose} class="modal__btn modal__btn--close">Close</button>
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
		z-index: 1000;
	}
	.modal-content {
		background: white;
		border-radius: 8px;
		width: 90%;
		max-width: 500px;
		padding: 2rem;
		max-height: 90vh;
		overflow-y: auto;
	}
	.jobs-list {
		margin: 1rem 0;
	}
	.job-item {
		padding: 0.75rem;
		border-bottom: 1px solid #eee;
	}
	.modal__btn--close {
		padding: 0.75rem 1.5rem;
		background: #2196f3;
		color: white;
		border: none;
		border-radius: 6px;
		cursor: pointer;
	}
</style>
