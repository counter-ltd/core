// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Public entry point for @counter/config, and it is client-safe on purpose:
 * constants only, no Node built-ins.
 *
 * The web bundle imports from here, so this file must never reach into env.ts
 * (which uses node:fs and would break the browser build). Server code that
 * needs the env loaders imports them directly from '@counter/config/env'.
 */
export * from './constants.ts';
export * from './blocklist.ts';
