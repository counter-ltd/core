import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { onError } from './middleware/error.ts';
import { optionalAuth } from './middleware/auth.ts';
import { rateLimit } from './middleware/ratelimit.ts';
import { authRoutes } from './routes/auth.ts';
import { userRoutes } from './routes/users.ts';
import { postRoutes } from './routes/posts.ts';
import { searchRoutes } from './routes/search.ts';
import { tagRoutes } from './routes/tags.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { insightRoutes } from './routes/insights.ts';
import { themeRoutes } from './routes/themes.ts';
import { algorithmRoutes } from './routes/algorithm.ts';
import type { AppEnv } from './types.ts';

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use('*', cors());
  // Auth is optional everywhere; routes opt into requireAuth where needed.
  app.use('*', optionalAuth);
  app.use('*', rateLimit);

  app.get('/', (c) =>
    c.json({
      name: 'Counter API',
      version: '1.0.0',
      docs: 'https://github.com/counter-ltd/core',
      message: 'Open source. Open algorithm. No tracking. Public by default.',
    }),
  );
  app.get('/health', (c) => c.json({ ok: true }));

  app.route('/auth', authRoutes);
  app.route('/users', userRoutes);
  app.route('/posts', postRoutes);
  app.route('/search', searchRoutes);
  app.route('/tags', tagRoutes);
  app.route('/notifications', notificationRoutes);
  app.route('/insights', insightRoutes);
  app.route('/themes', themeRoutes);
  app.route('/algorithm', algorithmRoutes);

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404),
  );
  app.onError(onError);

  return app;
}
