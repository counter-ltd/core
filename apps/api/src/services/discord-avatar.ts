// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Ingesting Discord avatars into our own media storage.
 *
 * When a Discord message is shared to Counter (or an account is linked), we pull
 * the author's avatar off Discord's CDN once and store it as a regular
 * content-addressed media object, so cards render from media.counter.ltd instead
 * of hotlinking Discord forever.
 *
 * The `discord_profiles` table is the cache, keyed by Discord snowflake so there
 * is exactly one row per account. That key is what gives us the three storage
 * guarantees the feature needs:
 *  - the same avatar shared by many users dedups to one blob (content-addressing),
 *  - re-sharing the same unchanged avatar is a cache hit (no re-fetch, no new blob),
 *  - when someone changes their Discord avatar we fetch the new one and release
 *    the old object's refcount so the GC sweep can reclaim it.
 */

import { db, discordProfiles, mediaObjects, eq } from '@counter/db';
import { storeObject, incRef, decRef, publicUrl } from './media.ts';
import type { DiscordUser } from './discord-post.ts';

const DISCORD_CDN = 'https://cdn.discordapp.com';

/** The public URL of an already-stored object, or null if it's missing. */
async function urlForObject(objectId: string | null): Promise<string | null> {
  if (!objectId) return null;
  const object = await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.id, objectId) });
  return object ? publicUrl(object.sha256) : null;
}

/**
 * Ensure we have the Discord user's current avatar stored, returning its public
 * Counter URL (or null for default avatars / fetch failures).
 *
 * Idempotent and cheap on the common path: if the cached `avatarHash` still
 * matches Discord's, we return the stored URL without touching the network. Only
 * a changed (or first-seen) hash triggers a fetch, and even then an identical
 * image across accounts dedups to one object.
 *
 * @param user  The Discord user from an interaction payload (needs id + avatar hash).
 */
export async function syncDiscordAvatar(user: DiscordUser): Promise<string | null> {
  const hash = user.avatar ?? null;
  const existing = await db.query.discordProfiles.findFirst({
    where: eq(discordProfiles.discordUserId, user.id),
  });

  // Cache hit: same avatar as last time, so reuse the stored object untouched.
  if (existing && existing.avatarHash === hash) {
    return urlForObject(existing.objectId);
  }

  // Default avatar (no hash): nothing to ingest. Drop any object we held and
  // record the cleared state so we don't re-check every share.
  if (!hash) {
    await decRef(existing?.objectId);
    await upsertProfile(user, null, null);
    return null;
  }

  // Animated avatars start with `a_` and are served as .gif; everything else as .png.
  const ext = hash.startsWith('a_') ? 'gif' : 'png';
  let objectId: string | null = null;
  let url: string | null = null;
  try {
    const res = await fetch(`${DISCORD_CDN}/avatars/${user.id}/${hash}.${ext}?size=256`);
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const stored = await storeObject(bytes, res.headers.get('content-type') ?? 'image/png');
      objectId = stored.object.id;
      url = stored.url;
      await incRef(objectId);
    }
  } catch {
    // Network/CDN hiccup. Leave the avatar unset; the card falls back to initials
    // and the next share will try again.
  }

  // Pin the new object before releasing the old so a swap never strands a blob.
  await decRef(existing?.objectId);
  await upsertProfile(user, hash, objectId);
  return url;
}

/** Upsert the cache row for a Discord account, recording its current avatar state. */
async function upsertProfile(
  user: DiscordUser,
  avatarHash: string | null,
  objectId: string | null,
): Promise<void> {
  const values = {
    discordUserId: user.id,
    avatarHash,
    objectId,
    username: user.username,
    globalName: user.global_name ?? null,
    updatedAt: new Date(),
  };
  await db
    .insert(discordProfiles)
    .values(values)
    .onConflictDoUpdate({
      target: discordProfiles.discordUserId,
      set: {
        avatarHash: values.avatarHash,
        objectId: values.objectId,
        username: values.username,
        globalName: values.globalName,
        updatedAt: values.updatedAt,
      },
    });
}
