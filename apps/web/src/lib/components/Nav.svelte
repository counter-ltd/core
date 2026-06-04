<!--
  Copyright (c) 2026 Counter (counter.ltd)
  SPDX-License-Identifier: LicenseRef-CSL-1.0
  Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.
-->
<script lang="ts">
  /**
   * The site's main navigation: brand, the route list, and the signed-in/out
   * footer. On wide screens it's a sticky sidebar; on narrow screens it
   * collapses into a hamburger drawer (see the media query in the styles).
   *
   * Props:
   *   user      The signed-in user, or null when logged out.
   *   accounts  Every stored account (no refresh tokens). First entry matches
   *             `user`. Drives the account switcher in the footer.
   */
  import { page } from '$app/state';
  import type { PrivateUser } from '@counter/types';
  import Avatar from './Avatar.svelte';

  let {
    user,
    accounts = [],
  }: {
    user: PrivateUser | null;
    accounts: Array<{ userId: string; username: string; displayName: string | null; avatarUrl: string | null }>;
  } = $props();

  // The nav doubles as the site map, so each link's label is literally its
  // path. `auth: true` means the link only shows to signed-in users.
  const links = [
    { href: '/', label: '/', auth: false },
    { href: '/feed', label: '/feed', auth: true },
    { href: '/topics', label: '/topics', auth: false },
    { href: '/notifications', label: '/notifications', auth: true },
    { href: '/insights', label: '/insights', auth: true },
    { href: '/themes', label: '/themes', auth: false },
    { href: '/algorithm', label: '/algorithm', auth: false },
    { href: '/changelog', label: '/changelog', auth: false },
    { href: '/data', label: '/data', auth: false },
  ];

  const current = $derived(page.url.pathname);
  // Home only counts as active on an exact match; every other link highlights
  // for its whole subtree (e.g. /topics stays lit on /topics/foo). If we used
  // startsWith for '/' too, every page would light up the home link.
  function active(href: string): boolean {
    return href === '/' ? current === '/' : current.startsWith(href);
  }

  // Whether the mobile drawer is showing.
  let open = $state(false);
  // Whether the account switcher tray is open.
  let accountsOpen = $state(false);

  // Other accounts stored locally (everyone except the active one).
  const otherAccounts = $derived(user ? accounts.filter((a) => a.userId !== user.id) : []);

  // Close both the nav drawer and the account tray on navigation.
  $effect(() => {
    current;
    open = false;
    accountsOpen = false;
  });
</script>

<nav class="nav panel">
  <a href="/" class="brand">
    <span class="mark" aria-hidden="true"></span>
    <span class="word">COUNTER</span>
  </a>

  <div class="links" class:open>
    <!-- Hide auth-only routes from logged-out visitors. -->
    {#each links as l (l.href)}
      {#if !l.auth || user}
        <a href={l.href} class="link" class:active={active(l.href)}>{l.label}</a>
      {/if}
    {/each}

    <!-- Footer swaps between the account block and the log in / sign up CTAs. -->
    <div class="foot">
      {#if user}
        <div class="me">
          <Avatar {user} size={34} />
          <a href="/{user.username}" class="who">
            <strong>{user.displayName || user.username}</strong>
            <small class="faint">@{user.username}</small>
          </a>
          <!-- Toggle button always visible so the user can add accounts even
               when they only have one. -->
          <button
            class="me-expand"
            class:active={accountsOpen}
            onclick={() => (accountsOpen = !accountsOpen)}
            aria-label="Switch accounts"
            aria-expanded={accountsOpen}
          >
            <span class="chevron" aria-hidden="true">▾</span>
          </button>
        </div>

        {#if accountsOpen}
          <div class="account-tray">
            {#each otherAccounts as acc (acc.userId)}
              <form method="POST" action="/actions/switch-account">
                <input type="hidden" name="userId" value={acc.userId} />
                <button type="submit" class="account-row">
                  <Avatar user={acc} size={26} />
                  <div class="acc-who">
                    <strong>{acc.displayName || acc.username}</strong>
                    <small>@{acc.username}</small>
                  </div>
                </button>
              </form>
            {/each}
            <a href="/login?add=1" class="account-add">+ add account</a>
          </div>
        {/if}

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
  </div>

  <button class="hamburger" onclick={() => (open = !open)} aria-label="Toggle navigation">
    <span></span>
    <span></span>
    <span></span>
  </button>
</nav>

<!-- Dim layer behind the open drawer; tapping it closes the drawer. -->
{#if open}
  <div class="backdrop" onclick={() => (open = false)} role="presentation"></div>
{/if}

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
  /* The mark is a filled cell, the smallest unit of the grid. */
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
    margin-top: var(--space-5);
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
  .me-expand {
    margin-left: auto;
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    padding: 2px 6px;
    color: var(--color-text-dim);
    line-height: 1;
    transition: border-color 0.15s, color 0.15s;
  }
  .me-expand:hover,
  .me-expand.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .chevron {
    display: inline-block;
    font-size: 0.7rem;
    transition: transform 0.15s;
  }
  .me-expand.active .chevron {
    transform: rotate(180deg);
  }
  /* The tray sits between the .me row and .me-actions. */
  .account-tray {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) 0;
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }
  .account-tray form {
    margin: 0;
  }
  .account-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    padding: var(--space-2) var(--space-2);
    color: var(--color-text);
    text-align: left;
    transition: background 0.12s;
  }
  .account-row:hover {
    background: var(--color-surface-strong);
  }
  .acc-who {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
  }
  .acc-who strong {
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .acc-who small {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--color-text-dim);
  }
  .account-add {
    padding: var(--space-2) var(--space-2);
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--color-text-dim);
    border-radius: var(--radius-sm);
  }
  .account-add:hover {
    color: var(--color-accent);
  }
  .me-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .me-actions form {
    margin: 0;
  }
  .hamburger {
    display: none;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    cursor: pointer;
    padding: 7px 8px;
    color: var(--color-text);
  }
  .hamburger span {
    display: block;
    width: 18px;
    height: 2px;
    background: currentColor;
    border-radius: 1px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 199;
  }
  /* Narrow screens: the sidebar becomes a top bar, and .links turns into an
     off-canvas drawer parked just off the left edge that slides in when open. */
  @media (max-width: 800px) {
    .nav {
      position: static;
      flex-direction: row;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
    }
    .brand {
      flex: 1;
    }
    .hamburger {
      display: flex;
    }
    .links {
      position: fixed;
      top: 0;
      left: 0;
      height: 100dvh;
      width: 260px;
      background: var(--color-bg);
      border-right: 1px solid var(--color-border);
      flex-direction: column;
      padding: var(--space-5) var(--space-4);
      gap: 0;
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      z-index: 200;
      overflow-y: auto;
    }
    .links.open {
      transform: translateX(0);
    }
    .foot {
      margin-top: auto;
    }
  }
</style>
