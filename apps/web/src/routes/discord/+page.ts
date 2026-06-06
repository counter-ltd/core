// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/** Shortlink: counter.ltd/discord → the Counter Discord server. */
import { redirect } from '@sveltejs/kit';

export function load() {
  throw redirect(307, 'https://discord.gg/svppGbQpSX');
}
