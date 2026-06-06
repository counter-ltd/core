// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Wiring for the Counter HTTP API: one Hono app with the global middleware
 * stack and every feature's routes mounted under its own prefix.
 *
 * This file is deliberately just assembly. The entry points that run it
 * (worker.ts on Workers, the Bun server locally) call createApp() and hand it
 * requests, so the same app definition serves both runtimes unchanged.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { onError } from './middleware/error.ts';
import { optionalAuth } from './middleware/auth.ts';
import { rateLimit } from './middleware/ratelimit.ts';
import { authRoutes } from './routes/auth.ts';
import { userRoutes } from './routes/users.ts';
import { postRoutes } from './routes/posts.ts';
import { mediaRoutes } from './routes/media.ts';
import { searchRoutes } from './routes/search.ts';
import { tagRoutes } from './routes/tags.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { insightRoutes } from './routes/insights.ts';
import { themeRoutes } from './routes/themes.ts';
import { algorithmRoutes } from './routes/algorithm.ts';
import { topicRoutes } from './routes/topics.ts';
import { integrationRoutes } from './routes/integrations.ts';
import { messageRoutes } from './routes/messages.ts';
import { deviceRoutes } from './routes/devices.ts';
import { oauthRoutes } from './routes/oauth.ts';
import { tunnelRoutes } from './routes/tunnel.ts';
import { discordBotRoutes } from './routes/discord-bot.ts';
import { githubRoutes } from './routes/github.ts';
import { webPushRoutes } from './routes/web-push.ts';
import { adminRoutes } from './routes/admin.ts';
import { reportRoutes } from './routes/reports.ts';
import { previewRoutes } from './routes/preview.ts';
import type { AppEnv } from './types.ts';

/**
 * Build the fully-wired Hono app: global middleware, then every route group.
 *
 * @returns A ready-to-serve app. Runtime entry points call its `.fetch`.
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  // Middleware order matters: CORS first so even error responses carry the
  // headers, auth next so rate limiting and routes can see who's calling.
  app.use('*', cors());
  // Auth runs on every request but never rejects; it just attaches userId when
  // a valid token is present. Routes that require a user opt into requireAuth.
  app.use('*', optionalAuth);
  app.use('*', rateLimit);

  app.get('/', (c) =>
    c.json({
      name: 'Counter API',
      version: '0.3.0',
      docs: 'https://github.com/counter-ltd/core',
      message: 'Open source. Open algorithm. No tracking. Public by default.',
    }),
  );
  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/auth', authRoutes);
  app.route('/auth', oauthRoutes);
  app.route('/users', userRoutes);
  app.route('/posts', postRoutes);
  app.route('/media', mediaRoutes);
  app.route('/search', searchRoutes);
  app.route('/tags', tagRoutes);
  app.route('/notifications', notificationRoutes);
  app.route('/insights', insightRoutes);
  app.route('/themes', themeRoutes);
  app.route('/algorithm', algorithmRoutes);
  app.route('/topics', topicRoutes);
  app.route('/integrations', integrationRoutes);
  app.route('/messages', messageRoutes);
  app.route('/devices', deviceRoutes);
  app.route('/tunnel', tunnelRoutes);
  app.route('/discord-bot', discordBotRoutes);
  app.route('/github', githubRoutes);
  app.route('/web-push', webPushRoutes);
  app.route('/reports', reportRoutes);
  app.route('/admin', adminRoutes);
  app.route('/preview', previewRoutes);

  // Unmatched paths and thrown errors funnel through these two so every
  // response leaves the API in the same `{ error: { code, message } }` shape.
  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404),
  );
  app.onError(onError);

  return app;
}
