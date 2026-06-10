<!-- src/routes/login/+page.svelte -->
<script lang="ts">
  // )=- Completely removed PIN login option (per user request). Now ONLY email/password via PocketBase authWithPassword.
  // No tabs, no PIN fields, no activeTab, no pinLogin import or forcePin redirects.
  // handleLogin does email path + Dexie lookup + setCurrentUser + goto('/calendar').
  // Layout + auth store provide the single source of truth (no more dual auth paths).
  // BEM classes preserved on the form (login-card, login-form__*).
  // )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling
  import { loginWithEmail } from '$lib/db/pb';
  import { goto } from '$app/navigation';
  import { setCurrentUser } from '$lib/stores/auth.svelte';
  import { db } from '$lib/db';

  let email = $state('');
  let password = $state('');
  let isLoading = $state(false);
  let error = $state('');

  $effect(() => {
    // Auto-redirect if already authenticated via layout/store restore.
  });

  async function handleLogin() {
    isLoading = true;
    error = '';

    try {
      // Email / PB path only
      await loginWithEmail(email, password);

      // Sync the PB-authenticated user into the central Dexie-backed store
      // so the UI (nav, guards, role checks) sees a consistent user object.
      // Prefer email lookup (unique). Fallback to firstName or legacy name.
      let cachedUser = await db.users.where('email').equalsIgnoreCase(email).first();

      if (!cachedUser) {
        const guess = email.split('@')[0];
        cachedUser = await db.users.where('firstName').equalsIgnoreCase(guess).first()
          || await db.users.where('name').equalsIgnoreCase(guess).first();
      }

      if (!cachedUser) {
        // Fallback to a seeded admin for development if email user not yet in Dexie
        cachedUser = await db.users.where('name').equalsIgnoreCase('admin').first();
      }

      if (cachedUser) {
        setCurrentUser(cachedUser);
        console.log('✅ User synced to central auth store after PB email login');
      }

      goto('/calendar', { replaceState: true });
    } catch (err: any) {
      // Surface better messages from PocketBase auth errors (e.g. bad credentials, disabled, etc.)
      const pbData = err?.response?.data;
      error = pbData?.password?.message 
        || pbData?.email?.message 
        || err?.message 
        || 'Login failed';
      console.error('Login attempt failed:', err);
    } finally {
      isLoading = false;
    }
  }
</script>



<div class="login-page">
  <div class="login-card">
    <h1 class="login-card__title">CapitalCity Windows</h1>
    <p class="login-card__subtitle">Crew Login</p>

    <!-- )=- PIN login completely removed. This page is now email/password ONLY.
         No tabs, no activeTab, no pinLogin path, no forcePinUpdate redirects.
         All auth goes through PocketBase authWithPassword (loginWithEmail).
         Layout guards + central auth store handle post-login state.
         )=- Reference: Remedine/Svelte_FullCalendar_Dexie_Scheduling -->
    <form 
      onsubmit={(e) => { e.preventDefault(); handleLogin(); }} 
      class="login-form"
    >
      <div class="login-form__field">
        <label class="login-form__label">Email</label>
        <input 
          type="email" 
          class="login-form__input"
          bind:value={email}
          placeholder="you@company.com"
          required
        />
      </div>

      <div class="login-form__field">
        <label class="login-form__label">Password</label>
        <input 
          type="password" 
          class="login-form__input"
          bind:value={password}
          placeholder="••••••••"
          required
        />
      </div>

      {#if error}
        <p class="login-form__error">{error}</p>
      {/if}

      <button 
        type="submit"
        class="login-form__btn"
        disabled={isLoading}>
        {isLoading ? 'Logging in...' : 'Login'}
      </button>
    </form>

    <p class="login-card__help">
      Sign in with your email and password.
    </p>
  </div>
</div>

<style>
	/* (your existing styles can stay the same) */
	.login-page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #1e3a8a, #3b82f6);
		padding: 1rem;
	}

	.login-card {
		background: white;
		width: 100%;
		max-width: 380px;
		border-radius: 16px;
		padding: 2rem 1.5rem;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
		text-align: center;
	}

	.login-card__title {
		font-size: 1.75rem;
		font-weight: 700;
		color: #1e3a8a;
		margin: 0 0 0.25rem;
	}

	.login-card__subtitle {
		color: #64748b;
		margin-bottom: 2rem;
	}

	.login-form__field {
		margin-bottom: 1.25rem;
		text-align: left;
	}

	.login-form__label {
		display: block;
		margin-bottom: 0.35rem;
		font-weight: 500;
		color: #334155;
	}

	.login-form__input {
		width: 100%;
		padding: 0.85rem 1rem;
		border: 2px solid #e2e8f0;
		border-radius: 8px;
		font-size: 1.1rem;
	}

	.login-form__btn {
		width: 100%;
		padding: 1rem;
		background: #3b82f6;
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 1.1rem;
		cursor: pointer;
		margin-top: 0.5rem;
	}

	.login-form__error {
		color: #ef4444;
		font-size: 0.95rem;
		margin: 0.75rem 0;
		text-align: center;
	}

	.login-card__help {
		margin-top: 1.5rem;
		color: #64748b;
		font-size: 0.9rem;
	}
</style>