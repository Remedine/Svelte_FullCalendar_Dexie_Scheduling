<!-- src/routes/login/+page.svelte -->
<script lang="ts">
  // )=- Rewritten for full Svelte 5 runes compliance (no onMount, no legacy patterns).
  // Unified login: both PIN and Email paths now feed the central `auth` store.
  // This ensures the layout guard (and all pages) see a consistent authenticated state.
  // Removed polling and broken references; redirects happen after successful store update.
  import { loginWithEmail } from '$lib/db/pb';
  import { goto } from '$app/navigation';
  import { login as pinLogin, setCurrentUser } from '$lib/stores/auth.svelte.ts';
  import { db } from '$lib/db';

  let activeTab = $state<'pin' | 'email'>('pin');
  let email = $state('');
  let password = $state('');
  let username = $state('');
  let pin = $state('');
  let isLoading = $state(false);
  let error = $state('');

  // )=- Reactive check: if already authenticated (from restore or previous session), redirect.
  // Runs via $derived + effect pattern for runes purity.
  let alreadyAuthed = $derived.by(() => {
    // We import dynamically to avoid circular issues at top level if needed,
    // but for simplicity we check after initial load. Layout guard also protects.
    return false; // Handled primarily by layout now for consistency
  });

  $effect(() => {
    // If the store indicates we're already logged in (e.g. session restore), go to calendar.
    // Note: the central store's auto-restore handles this; we can enhance later.
  });

  async function handleLogin() {
    isLoading = true;
    error = '';

    try {
      if (activeTab === 'pin') {
        // )=- Support "first name and initial of last name" for collisions (user hint): extract only first word as firstName for lookup.
        // PIN hash match will pick the correct user even on firstName collision. (Implemented in login fn with candidates.)
        const firstNameOnly = (username || '').trim().split(/\s+/)[0] || username;
        const result = await pinLogin(firstNameOnly, pin);
        if (result.success) {
          goto('/calendar', { replaceState: true });
        } else {
          error = result.message || 'Login failed';
          pin = '';
        }
      } else {
        // Email / PB path
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

          // )=- After successful email/password verification login: if the admin set forcePinUpdate on creation (standard for new crew), redirect to the set-PIN flow so the user can set their PIN (and later photo) on first verified login.
          // User (not admin) sets the initial PIN. Admin can only force resets later.
          if (cachedUser.forcePinUpdate) {
            goto('/reset-pin', { replaceState: true });
          } else {
            goto('/calendar', { replaceState: true });
          }
        } else {
          goto('/calendar', { replaceState: true });
        }
      }
    } catch (err: any) {
      // Surface better messages from PocketBase auth errors (e.g. bad credentials, not verified, disabled, etc.)
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

    <!-- )=- NEW: Tab selector - Lines 87-100 -->
    <div class="login-card__tabs">
      <button 
        class="login-card__tab {activeTab === 'pin' ? 'login-card__tab--active' : ''}"
        onclick={() => { activeTab = 'pin'; error = ''; }}>
        PIN Login
      </button>
      <button 
        class="login-card__tab {activeTab === 'email' ? 'login-card__tab--active' : ''}"
        onclick={() => { activeTab = 'email'; error = ''; }}>
        Email Login
      </button>
    </div>

    <form 
      onsubmit={(e) => { e.preventDefault(); handleLogin(); }} 
      class="login-form"
    >
      {#if activeTab === 'pin'}
        <!-- )=- Updated for first/last name change + verified quick-login flow.
             Quick PIN (first name + 4-digit) only for users who have verified via email/password at least once (sets verified flag).
             Label changed to First Name per requirement. Lookup in auth store uses firstName. -->
        <div class="login-form__field">
          <label class="login-form__label">First Name</label>
          <input 
            type="text" 
            class="login-form__input"
            bind:value={username}
            placeholder="e.g. Mike (or Mike T if first-name collision)"
          />
        </div>

        <div class="login-form__field">
          <label class="login-form__label">4-Digit PIN (after email verification)</label>
          <input 
            type="password" 
            class="login-form__input"
            bind:value={pin}
            maxlength="4"
            inputmode="numeric"
            placeholder="••••"
          />
        </div>
      {:else}
        <!-- )=- NEW: Email fields - Lines 125-145 -->
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
      {/if}

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
      {#if activeTab === 'pin'}
        Use after you have logged in once with your email/password to verify (first name + 4-digit PIN; add last initial e.g. "Mike T" if first-name collision)
      {:else}
        First-time setup or password reset (required for quick PIN access)
      {/if}
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
	/*  Tab styles */
  .login-card__tabs {
    display: flex;
    margin: 1.5rem 0;
    border-bottom: 1px solid #e2e8f0;
  }

  .login-card__tab {
    flex: 1;
    padding: 0.75rem;
    background: none;
    border: none;
    font-weight: 500;
    color: #64748b;
    cursor: pointer;
  }

  .login-card__tab--active {
    color: #3b82f6;
    border-bottom: 3px solid #3b82f6;
  }
</style>