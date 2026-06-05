// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Service worker for Web Push.
 *
 * Its only job is background notifications: show the one the server pushed, and
 * route a tap to the right place in the app. The payload arrives already
 * decrypted by the browser (the server sealed it with RFC 8291), and it's
 * deliberately thin: a type label and a section URL, never a sender or message
 * body. Message bodies are end-to-end encrypted and the server can't read them.
 */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // A push with no usable body still shows a generic nudge below.
  }

  // Title stays the app name so nothing identifying lands on the lock screen;
  // the body is the type-only line the server chose.
  const title = 'Counter';
  const options = {
    body: data.body || 'You have a new notification',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    // Collapse repeats of the same notification id instead of stacking them.
    tag: data.notificationId || undefined,
    data: { url: data.url || '/notifications' },
  };

  event.waitUntil(
    (async () => {
      // De-dupe with the live socket: if a Counter tab is open and focused, the
      // in-app notification feed already showed this, so skip the OS banner.
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const focused = clientList.some((c) => c.visibilityState === 'visible' && c.focused);
      if (focused) return;
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/notifications';

  // Focus an existing Counter tab if one is open, rather than spawning another.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
