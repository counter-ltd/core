// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The media storage layer: validating uploaded bytes, putting them in R2, and
 * keeping the `media_objects` refcount honest so nothing leaks.
 *
 * Objects are content-addressed: the R2 key and the `sha256` column are the
 * hash of the bytes, so two identical uploads (the same avatar shared by many
 * users, the same photo posted twice) become one object. That's what makes the
 * "careful storage management" and "no duplicate account photos" requirements
 * fall out for free.
 *
 * Lifecycle: storeObject() writes the blob at refCount 0. The things that point
 * at it (post media rows, user avatars, cached Discord profiles) call incRef
 * when they attach and decRef when they detach. sweepStaleObjects() deletes
 * anything that's been at refCount 0 past the grace window, which reclaims both
 * never-attached uploads and replaced avatars in one rule.
 *
 * WebCrypto only (no node:crypto), matching the auth code's cross-runtime rule.
 */

import { db, media, mediaObjects, users, eq, and, lt, sql, type MediaObject } from '@counter/db';
import { loadServerEnv } from '@counter/config/env';
import { MEDIA } from '@counter/config';
import { getWorkerBindings } from '../lib/bindings.ts';
import { errors } from '../lib/errors.ts';

/** Pixel dimensions parsed from an image header. */
export interface Dimensions {
  width: number;
  height: number;
}

/** What storeObject hands back: the persisted row and its public URL. */
export interface StoredObject {
  object: MediaObject;
  url: string;
}

// --- byte sniffing ---

/**
 * Identify an image format from its leading magic bytes.
 *
 * The client-supplied Content-Type is attacker-controlled, so the only thing we
 * trust is the bytes themselves. Returns the canonical MIME for the formats we
 * accept, or null for anything else (the caller rejects null as bad media).
 *
 * @param bytes  Raw uploaded bytes (at least the first dozen are inspected).
 */
export function sniffMime(bytes: Uint8Array): string | null {
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // GIF: "GIF87a" or "GIF89a"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Best-effort image dimensions from the file header, without decoding pixels.
 *
 * Used to enforce the max-dimension cap and to populate width/height. Returns
 * null when the format isn't one we parse or the header is truncated; the caller
 * treats unknown dimensions as acceptable rather than rejecting valid images.
 *
 * @param bytes  Raw uploaded bytes.
 * @param mime   The sniffed MIME, so we parse the right header layout.
 */
export function imageDimensions(bytes: Uint8Array, mime: string): Dimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mime === 'image/png') {
      // IHDR lives right after the 8-byte signature + 4-byte length + "IHDR".
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mime === 'image/gif') {
      // Logical screen descriptor: width then height, little-endian, at byte 6.
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (mime === 'image/jpeg') {
      return jpegDimensions(bytes, view);
    }
    if (mime === 'image/webp') {
      return webpDimensions(bytes, view);
    }
  } catch {
    // Truncated header / out-of-range read. Treat as unknown rather than fatal.
    return null;
  }
  return null;
}

/** Walk JPEG segments to the start-of-frame marker, which carries the size. */
function jpegDimensions(bytes: Uint8Array, view: DataView): Dimensions | null {
  let offset = 2; // skip the SOI marker (FF D8)
  while (offset + 9 < bytes.length) {
    // Every marker starts with 0xFF; skip any fill bytes between segments.
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // SOF0..SOF15 carry the frame size, except the non-size markers C4/C8/CC.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      // After the 2-byte marker and 2-byte length comes precision, then height, width.
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    // Not a frame marker: jump past this segment using its length field.
    const segLength = view.getUint16(offset + 2);
    offset += 2 + segLength;
  }
  return null;
}

/** Read the canvas size from a WEBP file's VP8 / VP8L / VP8X chunk. */
function webpDimensions(bytes: Uint8Array, view: DataView): Dimensions | null {
  // Chunk FourCC sits at byte 12, payload at 16+.
  const fourCC = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  if (fourCC === 'VP8 ') {
    // Lossy: 14-bit width/height follow the 3-byte start code at offset 26.
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (fourCC === 'VP8L') {
    // Lossless: 14-bit dimensions are packed into 4 bytes after the 0x2f signature.
    const b = view.getUint32(21, true);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  if (fourCC === 'VP8X') {
    // Extended: canvas size is two 24-bit little-endian values (minus one) at 24.
    const width = (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)) + 1;
    const height = (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)) + 1;
    return { width, height };
  }
  return null;
}

// --- hashing + URLs ---

/**
 * Lower-case hex sha256 of the bytes. Doubles as the R2 key and dedup key.
 *
 * @param bytes  Raw bytes to hash.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The R2 key for an object's bytes. */
function objectKey(sha256: string): string {
  return `objects/${sha256}`;
}

/**
 * The public, client-facing URL for a stored object.
 *
 * @param sha256  The object's content hash.
 */
export function publicUrl(sha256: string): string {
  // MEDIA_PUBLIC_URL is seeded into the env from the Worker bindings, so this is
  // the one source of truth for the bucket's served origin on both runtimes.
  const base = loadServerEnv().MEDIA_PUBLIC_URL.replace(/\/+$/, '');
  return `${base}/${objectKey(sha256)}`;
}

// --- storage ---

/** Resolve the R2 binding, or fail loudly if media storage isn't wired up. */
function bucket(): R2Bucket {
  const b = getWorkerBindings()?.MEDIA;
  // Absent under the plain Bun dev server (no R2 there); uploads need `wrangler dev`.
  if (!b) throw errors.internal('Media storage is not configured in this environment');
  return b;
}

/**
 * Store validated bytes in R2 and record (or reuse) their `media_objects` row.
 *
 * Content-addressed, so a hash that already exists short-circuits: we skip the
 * R2 write entirely and hand back the existing object. The new row starts at
 * refCount 0; the caller is responsible for incRef once it attaches the object.
 *
 * @param bytes  The validated upload (already sniffed and size-checked).
 * @param mime   The sniffed MIME to persist and set as the R2 Content-Type.
 */
export async function storeObject(bytes: Uint8Array, mime: string): Promise<StoredObject> {
  const sha256 = await sha256Hex(bytes);

  // Dedup: an identical blob is already stored, so reuse it untouched.
  const existing = await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.sha256, sha256) });
  if (existing) return { object: existing, url: publicUrl(sha256) };

  const dims = imageDimensions(bytes, mime);
  // Write the bytes before the row so a row never points at a missing object.
  await bucket().put(objectKey(sha256), bytes, { httpMetadata: { contentType: mime } });

  const [object] = await db
    .insert(mediaObjects)
    .values({
      sha256,
      mimeType: mime,
      sizeBytes: bytes.byteLength,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    })
    .returning();
  if (!object) throw errors.internal('Failed to record media object');

  return { object, url: publicUrl(sha256) };
}

// --- refcounting ---

/**
 * Increment an object's refcount because something now points at it.
 *
 * @param objectId  The `media_objects` id to pin.
 */
export async function incRef(objectId: string): Promise<void> {
  await db
    .update(mediaObjects)
    .set({ refCount: sql`${mediaObjects.refCount} + 1`, lastReferencedAt: new Date() })
    .where(eq(mediaObjects.id, objectId));
}

/**
 * Decrement an object's refcount because a reference to it went away. Floors at
 * zero so a double-detach can't drive the count negative and strand the blob.
 *
 * @param objectId  The `media_objects` id to release, or null/undefined for a no-op.
 */
export async function decRef(objectId: string | null | undefined): Promise<void> {
  if (!objectId) return;
  await db
    .update(mediaObjects)
    .set({
      refCount: sql`GREATEST(${mediaObjects.refCount} - 1, 0)`,
      lastReferencedAt: new Date(),
    })
    .where(eq(mediaObjects.id, objectId));
}

// --- post attachments ---

/** A post attachment request: which uploaded object, plus its alt text. */
export interface MediaAttachment {
  objectId: string;
  altText?: string;
}

/**
 * Attach uploaded objects to a post: insert the `media` rows (copying the
 * object's URL and metadata) and pin each object with an incRef.
 *
 * Every objectId must resolve to a stored object the caller uploaded; an unknown
 * id is a 422 rather than a silent skip, so a malformed client can't create a
 * post with phantom attachments.
 *
 * @param postId       The post the attachments belong to.
 * @param userId       The post author, denormalized onto each media row.
 * @param attachments  The objects to attach, in display order.
 */
export async function attachPostMedia(
  postId: string,
  userId: string,
  attachments: MediaAttachment[],
): Promise<void> {
  for (const item of attachments) {
    const object = await db.query.mediaObjects.findFirst({
      where: eq(mediaObjects.id, item.objectId),
    });
    if (!object) throw errors.validation('Unknown media object');

    await db.insert(media).values({
      postId,
      userId,
      objectId: object.id,
      url: publicUrl(object.sha256),
      mimeType: object.mimeType,
      width: object.width,
      height: object.height,
      sizeBytes: object.sizeBytes,
      altText: item.altText ?? null,
    });
    await incRef(object.id);
  }
}

/**
 * Release the objects a post held when it's deleted, dropping each refcount so
 * the bytes become eligible for GC once nothing else points at them.
 *
 * @param postId  The post being torn down.
 */
export async function releasePostMedia(postId: string): Promise<void> {
  const rows = await db.select().from(media).where(eq(media.postId, postId));
  for (const row of rows) await decRef(row.objectId);
}

// --- avatars ---

/**
 * Point a user's avatar at an uploaded object (or clear it), keeping refcounts
 * balanced so the old avatar's blob is reclaimable once nothing else holds it.
 *
 * Setting the same object again is a no-op. The served `avatarUrl` is derived
 * from the object here, so clients keep reading the same field they always have.
 *
 * @param userId    Whose avatar to set.
 * @param objectId  The uploaded object to use, or null to remove the avatar.
 */
export async function setUserAvatar(userId: string, objectId: string | null): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw errors.notFound('User not found');

  const previous = user.avatarObjectId;
  if (previous === objectId) return;

  let url: string | null = null;
  if (objectId) {
    const object = await db.query.mediaObjects.findFirst({ where: eq(mediaObjects.id, objectId) });
    if (!object) throw errors.validation('Unknown media object');
    url = publicUrl(object.sha256);
    await incRef(objectId);
  }
  // Release the old avatar after pinning the new one, so a failure mid-swap
  // never leaves the user with a decremented-but-still-referenced old blob.
  await decRef(previous);

  await db
    .update(users)
    .set({ avatarObjectId: objectId, avatarUrl: url, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// --- garbage collection ---

/**
 * Delete objects that have sat at refCount 0 past the grace window, removing the
 * bytes from R2 and the row from the table.
 *
 * Run from the Worker's scheduled handler. The grace window keeps a freshly
 * uploaded-but-not-yet-attached object alive long enough for its post or avatar
 * save to land.
 *
 * @returns How many objects were reclaimed.
 */
export async function sweepStaleObjects(): Promise<number> {
  const cutoff = new Date(Date.now() - MEDIA.GC_GRACE_HOURS * 60 * 60 * 1000);
  const stale = await db
    .select()
    .from(mediaObjects)
    .where(and(eq(mediaObjects.refCount, 0), lt(mediaObjects.lastReferencedAt, cutoff)));

  const b = getWorkerBindings()?.MEDIA;
  for (const obj of stale) {
    // Drop the bytes first; if the row delete fails we'd rather have an orphan
    // row (caught next sweep) than an orphan blob that never gets reclaimed.
    if (b) await b.delete(objectKey(obj.sha256));
    await db.delete(mediaObjects).where(eq(mediaObjects.id, obj.id));
  }
  return stale.length;
}
