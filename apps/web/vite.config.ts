import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Share the monorepo-root .env (PUBLIC_API_URL) instead of duplicating it.
  envDir: '../../',
  server: {
    port: 5173,
  },
});
