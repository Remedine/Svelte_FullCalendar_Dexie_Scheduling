<!-- src/routes/login/+page.svelte -->
<script lang="ts">
  import { loginWithEmail, loginWithPin, isAuthenticated } from '$lib/db/pb';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { db } from '$lib/db';   

  let activeTab = $state<'pin' | 'email'>('pin');
  let email = $state('');
  let password = $state('');
  let username = $state('');
  let pin = $state('');
  let isLoading = $state(false);
  let error = $state('');
  let authModule: any = null;

  // Line 22
  onMount(async () => {
    // )=- Keep your original auth module loading
    authModule = await import('$lib/stores/auth.svelte.ts');

    const checkAuth = () => {
      if (authModule.auth?.isAuthenticated) {
        if (authModule.auth.currentUser) {
          goto('/calendar', { replaceState: true });
        }
      } else {
        setTimeout(checkAuth, 50);
      }
    };

    checkAuth();

    // )=- NEW: Also check PocketBase (for email login)
    if (isAuthenticated()) {
      goto('/calendar', { replaceState: true });
    }
  });

  // Line 45
  async function handleLogin() {
    isLoading = true;
    error = '';

    try {
      if (activeTab === 'email') {
        await loginWithEmail(email, password);

        const userNameGuess = email.split('@')[0]; // "Tim"
        let cachedUser = await db.users.where('name').equalsIgnoreCase(userNameGuess).first();

        if (!cachedUser) {
          // fallback to the seeded Admin (PIN 1234) so you get full admin rights
          cachedUser = await db.users.where('name').equalsIgnoreCase('admin').first();
        }

        if (cachedUser && authModule?.setCurrentUser) {
          authModule.setCurrentUser(cachedUser);
          console.log('✅ Dexie admin session activated for super admin login');
			  }
			    goto('/calendar', { replaceState: true });
		  } else {
          error = result.message || 'Login failed';
          pin = '';
        }
    } catch (err: any) {
      error = err.message || 'Login failed';
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
        <!-- Your original PIN fields - unchanged -->
        <div class="login-form__field">
          <label class="login-form__label">Name</label>
          <input 
            type="text" 
            class="login-form__input"
            bind:value={username}
            placeholder="e.g. Mike Thompson"
          />
        </div>

        <div class="login-form__field">
          <label class="login-form__label">4-Digit PIN</label>
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
        Ask admin for your PIN
      {:else}
        First-time setup or password reset
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