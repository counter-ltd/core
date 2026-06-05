// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Client-side heartbeat manager for online status.
 *
 * Calls POST /actions/heartbeat on a fixed interval while the user has online
 * status enabled. One heartbeat fires immediately on start so the server knows
 * you're active straight away rather than after the first interval elapses.
 *
 * The interval matches the user's configured heartbeat interval so the server's
 * "online" window (interval + 30s grace) only expires if the tab is genuinely
 * idle or closed.
 */

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start sending periodic heartbeats. Replaces any running timer so calling
 * start twice (e.g. when settings change) is safe.
 *
 * @param intervalSeconds  How often to fire; matches the user's configured interval.
 */
export function startHeartbeat(intervalSeconds: number): void {
  stopHeartbeat();
  void sendHeartbeat();
  intervalId = setInterval(() => void sendHeartbeat(), intervalSeconds * 1000);
}

/** Stop sending heartbeats. Safe to call even when the timer isn't running. */
export function stopHeartbeat(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function sendHeartbeat(): Promise<void> {
  try {
    await fetch('/actions/heartbeat', { method: 'POST' });
  } catch {
    // Network errors are silently swallowed; the timer keeps running and
    // will succeed once connectivity returns.
  }
}
