<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · Counter</title></svelte:head>

<div class="err panel">
  <h1>{page.status}</h1>
  <p class="muted">{page.error?.message ?? 'Something went wrong.'}</p>
  <a class="btn btn-primary" href="/">Back to the public square</a>
</div>

<style>
  .err {
    padding: var(--space-6);
    text-align: center;
    margin: 10vh auto 0;
    max-width: 420px;
  }
  .err h1 {
    font-size: 3rem;
    margin: 0;
  }
  .btn {
    margin-top: var(--space-4);
  }
</style>
