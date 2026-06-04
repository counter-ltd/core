// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * SvelteKit build configuration. We deploy to Cloudflare Workers, so this picks
 * the Cloudflare adapter and turns off one default that doesn't survive that
 * environment (see the csrf note below).
 */
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Behind Cloudflare the Worker can see a different host than the browser
    // submitted the form to, so the built-in origin check misfires and rejects
    // legitimate posts. We turn it off here and run our own check in
    // hooks.server.ts instead.
    csrf: { checkOrigin: false },
  },
};

export default config;
