// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Vite config for the web app's dev server and build. SvelteKit drives most of
 * it through its plugin; the two overrides below are the only app-specific bits.
 */
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // Load env from the monorepo root so every app reads one shared .env
  // (PUBLIC_API_URL and friends) instead of each keeping its own copy in sync.
  envDir: '../../',
  server: {
    port: 5173,
  },
});
