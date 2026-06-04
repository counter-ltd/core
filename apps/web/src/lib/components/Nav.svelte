<script lang="ts">
  import { page } from '$app/state';
  import type { PrivateUser } from '@counter/types';
  import Avatar from './Avatar.svelte';

  let { user }: { user: PrivateUser | null } = $props();

  // The nav is the routing table, so it shows routes. The label is the path.
  const links = [
    { href: '/', label: '/', auth: false },
    { href: '/feed', label: '/feed', auth: true },
    { href: '/notifications', label: '/notifications', auth: true },
    { href: '/insights', label: '/insights', auth: true },
    { href: '/themes', label: '/themes', auth: false },
    { href: '/algorithm', label: '/algorithm', auth: false },
  ];

  const current = $derived(page.url.pathname);
  function active(href: string): boolean {
    return href === '/' ? current === '/' : current.startsWith(href);
  }
</script>

<nav class="nav panel">
  <a href="/" class="brand">
    <span class="mark" aria-hidden="true"></span>
    <span class="word">COUNTER</span>
  </a>

  <div class="links">
    {#each links as l (l.href)}
      {#if !l.auth || user}
        <a href={l.href} class="link" class:active={active(l.href)}>{l.label}</a>
      {/if}
    {/each}
  </div>

  <div class="foot">
    {#if user}
      <div class="me">
        <Avatar {user} size={34} />
        <a href="/{user.username}" class="who">
          <strong>{user.displayName || user.username}</strong>
          <small class="faint">@{user.username}</small>
        </a>
      </div>
      <div class="me-actions">
        <a class="btn" href="/settings">settings</a>
        <form method="POST" action="/actions/logout">
          <button class="btn" type="submit">log out</button>
        </form>
      </div>
    {:else}
      <a class="btn btn-primary" href="/login">Log in</a>
      <a class="btn" href="/register">Sign up</a>
    {/if}
  </div>
</nav>

<style>
  .nav {
    position: sticky;
    top: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-4);
    height: fit-content;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  /* The mark is a filled cell — the smallest unit of the grid. */
  .mark {
    width: 16px;
    height: 16px;
    border-radius: 1px;
    background: var(--color-accent);
  }
  .word {
    font-family: var(--mono);
    font-weight: 600;
    font-size: 0.95rem;
    letter-spacing: 0.18em;
  }
  .links {
    display: flex;
    flex-direction: column;
  }
  .link {
    font-family: var(--mono);
    font-size: 0.85rem;
    padding: var(--space-2) var(--space-3);
    border-left: 2px solid transparent;
    color: var(--color-text-dim);
  }
  .link:hover {
    color: var(--color-text);
  }
  .link.active {
    color: var(--color-accent);
    border-left-color: var(--color-accent);
    background: var(--color-surface-strong);
  }
  .foot {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .me {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .who {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
  }
  .who strong {
    font-weight: 500;
  }
  .who small {
    font-family: var(--mono);
    font-size: 0.74rem;
  }
  .me-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .me-actions form {
    margin: 0;
  }
  @media (max-width: 800px) {
    .nav {
      position: static;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
    }
    .links {
      flex-direction: row;
      flex-wrap: wrap;
      flex: 1;
    }
    .foot {
      border-top: none;
      padding-top: 0;
      flex-direction: row;
    }
  }
</style>
