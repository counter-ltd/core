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
  import { badges } from '$lib/badges.svelte';

  let {
    user,
    accounts = [],
  }: {
    user: PrivateUser | null;
    accounts: Array<{ userId: string; username: string; displayName: string | null; avatarUrl: string | null }>;
  } = $props();

  // The line-icon for each route, keyed by the link's `icon` field. Stored as
  // raw inner markup so one shared <svg> (stroke + sizing) wraps them all; the
  // paths are static and authored here, so {@html} is safe. All drawn on a
  // 24x24 grid to line up on the same baseline.
  const icons: Record<string, string> = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V21h14V9.5"/>',
    feed: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    topics: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/>',
    insights: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-3"/>',
    themes: '<circle cx="13.5" cy="6.5" r="1.3"/><circle cx="17.5" cy="10.5" r="1.3"/><circle cx="8.5" cy="7.5" r="1.3"/><circle cx="6.5" cy="12.5" r="1.3"/><path d="M12 3a9 9 0 0 0 0 18 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 1 2-4h1a4 4 0 0 0 4-4 9 9 0 0 0-9-6z"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
    admin: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  };

  // The nav doubles as the site map, so each link's label is literally its
  // path. `auth: true` means the link only shows to signed-in users. The
  // transparency/meta links (/algorithm, /changelog, /data) now live as tabs
  // under /about, which keeps this list short enough to scan at a glance.
  const links = [
    { href: '/', label: '/', icon: 'home', auth: false },
    { href: '/feed', label: '/feed', icon: 'feed', auth: true },
    { href: '/topics', label: '/topics', icon: 'topics', auth: false },
    { href: '/notifications', label: '/notifications', icon: 'bell', auth: true },
    { href: '/messages', label: '/messages', icon: 'chat', auth: true },
    { href: '/insights', label: '/insights', icon: 'insights', auth: true },
    { href: '/themes', label: '/themes', icon: 'themes', auth: false },
    { href: '/about', label: '/about', icon: 'about', auth: false },
  ];

  // The admin panel link only appears for accounts that hold at least one admin
  // permission, so it's invisible to everyone else rather than 403-ing on click.
  const isAdmin = $derived((user?.permissions?.length ?? 0) > 0);

  // Live unread count for the two routes that have a badge; 0 (no badge) for the
  // rest. Reads the shared store so a live notification re-renders the count.
  function badgeCount(href: string): number {
    if (href === '/notifications') return badges.notifications;
    if (href === '/messages') return badges.messages;
    return 0;
  }

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
        <a href={l.href} class="link" class:active={active(l.href)}>
          <svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html icons[l.icon]}</svg>
          {l.label}
          {#if badgeCount(l.href) > 0}
            <span class="nav-badge">{badgeCount(l.href) > 99 ? '99+' : badgeCount(l.href)}</span>
          {/if}
        </a>
      {/if}
    {/each}
    {#if isAdmin}
      <a href="/admin" class="link link-admin" class:active={active('/admin')}>
        <svg class="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html icons.admin}</svg>
        /admin
      </a>
    {/if}

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
          <a class="btn btn-icon" href="/discord" target="_blank" rel="noopener noreferrer" aria-label="Join our Discord">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.114 18.1.133 18.115a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
          </a>
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

    <!--
      "Built with Counter" attribution. The Counter Social License (Condition 5)
      requires this on every deployment, visible to everyone without logging in,
      linking back to the source. Placed here so it appears at the bottom of the
      sidebar on both desktop and the mobile drawer.
    -->
    <div class="attribution">
      <a href="https://counter.ltd" target="_blank" rel="noopener">
        <span class="attr-mark" aria-hidden="true"></span>
        <span>Built with Counter</span>
      </a>
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
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  /* The leading line-icon. Dimmer than the label so the text still leads; it
     picks up the accent along with the label on hover/active since both use
     currentColor. */
  .ico {
    flex-shrink: 0;
    opacity: 0.7;
  }
  .link:hover .ico,
  .link.active .ico {
    opacity: 1;
  }
  /* Unread count pill on /notifications and /messages. Pushed to the row's
     trailing edge so the icon+label column stays aligned. */
  .nav-badge {
    margin-left: auto;
    font-size: 0.68rem;
    line-height: 1;
    min-width: 1.1rem;
    padding: 3px 5px;
    border-radius: 999px;
    text-align: center;
    background: var(--color-accent);
    color: var(--color-accent-contrast, #fff);
    font-weight: 600;
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
  /* Settings is an <a>, log out is a <button> wrapped in a <form>. A two-column
     grid gives each action an identical track so the buttons match width
     instead of sizing to their label text. */
  .me-actions {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    gap: var(--space-2);
  }
  /* Equal padding on all sides makes the button naturally square at btn height. */
  .btn-icon {
    justify-content: center;
    padding: var(--space-2);
  }
  .me-actions form {
    margin: 0;
  }
  /* The button is nested in the form, so stretch it to fill its grid cell. */
  .me-actions form .btn {
    width: 100%;
  }
  /* Center each label, and pin the button's line-height: a <button> doesn't
     inherit the body line-height the way the <a> does, so without this the two
     end up different heights. */
  .me-actions > .btn,
  .me-actions form .btn {
    justify-content: center;
    line-height: 1.45;
  }
  /* Quiet by default, accent on hover; the license forbids hiding this. */
  .attribution {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }
  .attribution a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--mono);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    color: var(--color-text-dim);
  }
  .attribution a:hover {
    color: var(--color-accent);
  }
  /* Same filled cell as the nav brand mark, so the two read as one identity. */
  .attr-mark {
    width: 12px;
    height: 12px;
    border-radius: 1px;
    background: var(--color-accent);
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
