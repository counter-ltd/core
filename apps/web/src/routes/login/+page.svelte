<script lang="ts">
  import { enhance } from '$app/forms';
  let { form } = $props();
</script>

<svelte:head><title>Log in · Counter</title></svelte:head>

<div class="auth panel">
  <h1>Welcome back</h1>
  <p class="muted">Log in to post, follow, and see your feed.</p>

  <form method="POST" use:enhance class="stack">
    <div>
      <label for="identifier">Username or email</label>
      <input id="identifier" name="identifier" value={form?.identifier ?? ''} autocomplete="username" required />
    </div>
    <div>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
    </div>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <button class="btn btn-primary" type="submit">Log in</button>
  </form>

  <p class="muted alt">No account? <a href="/register">Create one</a></p>
</div>

<style>
  .auth {
    padding: var(--space-5);
    max-width: 420px;
    margin: 8vh auto 0;
  }
  .alt {
    margin-top: var(--space-4);
  }
</style>
