// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Browser-side Web Push setup: register the service worker, ask permission, and
 * subscribe or unsubscribe with the push service.
 *
 * This only does the browser half. The resulting subscription is handed back to
 * the caller, which posts it to a SvelteKit server action so the access token
 * never has to touch client JavaScript. Everything here no-ops gracefully when
 * the browser lacks push support or the user denies permission.
 */

/** Whether this browser can do Web Push at all (absent on older Safari, etc.). */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The VAPID public key arrives as base64url; the subscribe call wants raw bytes. */
function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register the push service worker, reusing the existing registration if any. */
async function getRegistration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/sw.js');
}

/**
 * Whether this browser currently holds an active push subscription. Lets the
 * settings UI show the right toggle state without re-subscribing.
 */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  return sub !== null;
}

/**
 * Ask permission and subscribe. Returns the subscription JSON to send to the
 * server, or null if the browser can't subscribe or the user said no.
 *
 * @param vapidPublicKey - The server's base64url VAPID public key.
 */
export async function subscribe(vapidPublicKey: string): Promise<PushSubscriptionJSON | null> {
  if (!pushSupported() || !vapidPublicKey) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const reg = await getRegistration();
  // Reuse an existing subscription rather than creating a duplicate; the server
  // upserts on the endpoint anyway, but this avoids the round trip.
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      // Required by Chrome: every push must result in a visible notification.
      userVisibleOnly: true,
      // Cast past the DOM lib's ArrayBuffer-vs-SharedArrayBuffer strictness; the
      // bytes are a plain Uint8Array, which is exactly what subscribe expects.
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  return sub.toJSON();
}

/**
 * Unsubscribe this browser. Returns the endpoint that was removed (so the caller
 * can tell the server to drop it), or null if there was nothing subscribed.
 */
export async function unsubscribe(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await getRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
