<script lang="ts">
  import { enhance } from '$app/forms';
  import { USER } from '@counter/config';
  let { form } = $props();
</script>

<svelte:head><title>Sign up · Counter</title></svelte:head>

<div class="auth panel">
  <h1>Join Counter</h1>
  <p class="muted">Public by default. Insights from your first post. No tracking.</p>

  <form method="POST" use:enhance class="stack">
    <div>
      <label for="username">Username</label>
      <input
        id="username"
        name="username"
        value={form?.username ?? ''}
        minlength={USER.MIN_USERNAME_LENGTH}
        maxlength={USER.MAX_USERNAME_LENGTH}
        pattern="[a-zA-Z0-9_]+"
        autocomplete="username"
        required
      />
    </div>
    <div>
      <label for="displayName">Display name <span class="faint">(optional)</span></label>
      <input id="displayName" name="displayName" value={form?.displayName ?? ''} maxlength={USER.MAX_DISPLAY_NAME_LENGTH} />
    </div>
    <div>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value={form?.email ?? ''} autocomplete="email" required />
    </div>
    <div>
      <label for="password">Password <span class="faint">(min {USER.MIN_PASSWORD_LENGTH})</span></label>
      <input id="password" name="password" type="password" minlength={USER.MIN_PASSWORD_LENGTH} autocomplete="new-password" required />
    </div>
    {#if form?.error}<p class="error">{form.error}</p>{/if}
    <button class="btn btn-primary" type="submit">Create account</button>
  </form>

  <p class="muted alt">Already have an account? <a href="/login">Log in</a></p>
</div>

<style>
  .auth {
    padding: var(--space-5);
    max-width: 440px;
    margin: 6vh auto 0;
  }
  .alt {
    margin-top: var(--space-4);
  }
</style>
