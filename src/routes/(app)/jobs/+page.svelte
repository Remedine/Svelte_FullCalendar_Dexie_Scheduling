<!-- src/routes/(app)/jobs/+page.svelte -->
<script lang="ts">
  // line 1
  import { db, type Job } from '$lib/db';
  import { pullJobsFromServer, pb } from '$lib/db/pb';
  import { auth } from '$lib/stores/auth.svelte';
  import { goto } from '$app/navigation';

  // line 6
  let jobs = $state<Job[]>([]);
  let searchTerm = $state('');
  let statusFilter = $state<'all' | Job['status']>('all');
  let loading = $state(true);

  // line 11
  const filteredJobs = $derived(
    jobs
      .filter((job) => {
        const matchesSearch =
          job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.notes?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          job.assignedCrew.join(' ').toLowerCase().includes(searchTerm.toLowerCase());

        const matchesStatus =
          statusFilter === 'all' || job.status === statusFilter;

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => b.start.getTime() - a.start.getTime())
  );

  // line 27
  async function loadJobs() {
    loading = true;
    jobs = await db.jobs.toArray();
    loading = false;
  }

  // line 33
  async function refreshFromServer() {
    if (pb.authStore.isValid) {
      await pullJobsFromServer();
      await loadJobs();
    }
  }

  // )=- Replaced onMount with $effect for Svelte 5 runes + auth consistency.
  // Added defensive check so the page itself enforces login (defense in depth).
  let jobsLoaded = $state(false);

  $effect(() => {
    if (!auth.loading && (!auth.isAuthenticated || !auth.currentUser)) {
      goto('/login', { replaceState: true });
      return;
    }
  });

  $effect(() => {
    if (!auth.loading && auth.isAuthenticated && !jobsLoaded) {
      jobsLoaded = true;
      loadJobs().then(() => {
        if (navigator.onLine) {
          refreshFromServer();
        }
      });
    }
  });

  // line 46
  function editJob(job: Job) {
    alert(`Edit job ${job.id} — we will connect this to the Calendar modal next`);
  }
</script>

<div class="job-page">
  <header class="job-page__header">
    <div>
      <h1 class="job-page__title">All Jobs</h1>
      <p class="job-page__subtitle">
        {filteredJobs.length} of {jobs.length} jobs
        {#if auth.currentUser?.role === 'crew'}
          • Your assigned jobs only
        {/if}
      </p>
    </div>

    <button 
      class="job-page__btn job-page__btn--primary"
      onclick={refreshFromServer}
      disabled={loading}
    >
      🔄 Sync with Server
    </button>
  </header>

  <div class="job-page__filters">
    <input
      type="text"
      class="job-page__search"
      placeholder="Search title, notes, or crew..."
      bind:value={searchTerm}
    />

    <select 
      class="job-page__select"
      bind:value={statusFilter}
    >
      <option value="all">All Statuses</option>
      <option value="scheduled">Scheduled</option>
      <option value="confirmed">Confirmed</option>
      <option value="completed">Completed</option>
      <option value="cancelled">Cancelled</option>
    </select>
  </div>

  {#if loading}
    <div class="job-page__loading">Loading jobs…</div>
  {:else if filteredJobs.length === 0}
    <div class="job-page__empty">No jobs found</div>
  {:else}
    <div class="job-page__list">
      {#each filteredJobs as job (job.id)}
        <div 
          class="job-page__card"
          onclick={() => editJob(job)}
        >
          <div class="job-page__card-header">
            <span class="job-page__status job-page__status--{job.status}">
              {job.status}
            </span>
            <span class="job-page__total">${job.totalAmount.toFixed(2)}</span>
          </div>

          <h3 class="job-page__card-title">{job.title}</h3>
          
          <div class="job-page__meta">
            <span>{new Date(job.start).toLocaleDateString()} • {new Date(job.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span class="job-page__crew">{job.assignedCrew.join(', ')}</span>
          </div>

          {#if job.notes}
            <p class="job-page__notes">{job.notes}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .job-page { padding: 1.5rem; max-width: 1200px; margin: 0 auto; }
  .job-page__header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; }
  .job-page__title { font-size: 1.75rem; font-weight: 700; color: #0f172a; margin: 0; }
  .job-page__subtitle { color: #64748b; margin: 0.25rem 0 0; }
  .job-page__filters { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .job-page__search, .job-page__select { padding: 0.75rem 1rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 1rem; }
  .job-page__search { flex: 1; min-width: 260px; }
  .job-page__list { display: grid; gap: 1rem; }
  .job-page__card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; cursor: pointer; transition: box-shadow 0.1s ease, transform 0.1s ease; }
  .job-page__card:hover { box-shadow: 0 4px 12px rgb(15 23 42 / 0.08); transform: translateY(-1px); }
  .job-page__card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .job-page__status { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
  .job-page__status--scheduled { background: #dbeafe; color: #1e40af; }
  .job-page__status--confirmed { background: #d1fae5; color: #166534; }
  .job-page__status--completed { background: #a7f3d0; color: #065f46; }
  .job-page__status--cancelled { background: #fee2e2; color: #991b1b; }
  .job-page__total { font-weight: 700; color: #0f172a; }
  .job-page__card-title { margin: 0 0 0.5rem; font-size: 1.1rem; font-weight: 600; }
  .job-page__meta { display: flex; gap: 1rem; font-size: 0.9rem; color: #64748b; }
  .job-page__crew { font-weight: 500; }
  .job-page__notes { margin-top: 0.75rem; font-size: 0.9rem; color: #475569; line-height: 1.4; }
  .job-page__btn { padding: 0.6rem 1.25rem; border-radius: 8px; font-weight: 600; cursor: pointer; border: none; }
  .job-page__btn--primary { background: #3b82f6; color: white; }
  .job-page__loading, .job-page__empty { text-align: center; padding: 3rem; color: #64748b; }
</style>