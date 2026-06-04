<script lang="ts">
  import { enhance } from '$app/forms';
  import { setMode } from '$lib/theme';
  let { data, form } = $props();
  const p = $derived(data.profile);
</script>

<svelte:head><title>Settings · Counter</title></svelte:head>

<h1 class="title">Settings</h1>

<section class="panel card">
  <h2>Profile</h2>
  {#if form?.saved}<p class="ok">Saved.</p>{/if}
  {#if form?.error}<p class="error">{form.error}</p>{/if}
  <form method="POST" action="?/profile" use:enhance class="stack">
    <div>
      <label for="displayName">Display name</label>
      <input id="displayName" name="displayName" value={p.displayName ?? ''} maxlength="60" />
    </div>
    <div>
      <label for="bio">Bio</label>
      <textarea id="bio" name="bio" maxlength="300">{p.bio ?? ''}</textarea>
    </div>
    <div>
      <label for="avatarUrl">Avatar URL</label>
      <input id="avatarUrl" name="avatarUrl" type="url" value={p.avatarUrl ?? ''} placeholder="https://…" />
    </div>
    <button class="btn btn-primary" type="submit">Save profile</button>
  </form>
</section>

<section class="panel card">
  <h2>Appearance</h2>
  <p class="muted">Dark by default. Light is a theme choice. Browse more in <a href="/themes">Themes</a>.</p>
  <div class="row">
    <button class="btn" onclick={() => setMode('dark')}>Dark</button>
    <button class="btn" onclick={() => setMode('light')}>Light</button>
  </div>
</section>

<section class="panel card">
  <h2>Account</h2>
  <p class="muted">Email: {p.email}</p>
  <hr />
  <h3 class="danger-h">Delete account</h3>
  <p class="muted">
    This hard-deletes everything you own — posts, likes, follows, sessions. It cannot be undone.
    Anonymous view counts on your posts remain as aggregate numbers with no link to you.
  </p>
  <form method="POST" action="?/deleteAccount" class="stack del">
    <input name="confirm" placeholder="Type DELETE to confirm" autocomplete="off" />
    <button class="btn danger" type="submit">Delete my account</button>
  </form>
</section>

<style>
  .title { margin-bottom: var(--space-4); }
  .card { padding: var(--space-5); margin-bottom: var(--space-4); }
  .card h2 { font-size: 1.1rem; }
  .ok { color: var(--color-repost); }
  .danger-h { color: var(--color-danger); font-size: 1rem; }
  .del { max-width: 360px; }
  .btn.danger { border-color: var(--color-danger); color: var(--color-danger); }
  .btn.danger:hover { background: var(--color-danger); color: #fff; }
</style>
