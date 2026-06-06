// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Media upload: the one way bytes get into R2.
 *
 * A signed-in user POSTs an image here, we validate it server-side (size, real
 * format by magic bytes, max dimensions), store it content-addressed, and hand
 * back an object id. That id is what the client then attaches to a post or sets
 * as their avatar. Nothing else writes to R2, so every blob in the bucket came
 * through this gate, which is what "secure upload" and "no bad media" mean here.
 *
 * The whole router is behind auth: an upload always belongs to whoever is
 * signed in.
 */
import { Hono, type Context } from 'hono';
import { MEDIA } from '@counter/config';
import type { MediaUploadResponse } from '@counter/types';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { errors } from '../lib/errors.ts';
import { sniffMime, imageDimensions, storeObject } from '../services/media.ts';
import type { AppEnv } from '../types.ts';

/** Hono router mounted at /media. Handles all image upload traffic. */
export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.use('*', requireAuth);

/**
 * Pull the uploaded bytes out of the request, whether the client sent a raw
 * image body or a multipart form with a `file` field. Both clients (web proxy,
 * iOS) use multipart; a raw body is the convenient path for curl/tests.
 */
async function readUpload(c: Context<AppEnv>): Promise<ArrayBuffer> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    // The platform's FormData value type varies across the Workers/DOM libs, so
    // treat the entry structurally: a Blob has arrayBuffer(); a plain text field
    // (string) does not.
    const file = form.get('file') as unknown as Blob | string | null;
    if (!file || typeof file === 'string') {
      throw errors.validation('Expected a `file` field in the upload');
    }
    return file.arrayBuffer();
  }
  return c.req.arrayBuffer();
}

/**
 * POST /media — validate and store an image, returning its object id and URL.
 *
 * Rejects (422) anything that isn't a real, in-allowlist image within the size
 * and dimension caps. The returned object starts unreferenced; it's pinned only
 * once a post or avatar save attaches it, and swept if that never happens.
 */
mediaRoutes.post('/', async (c) => {
  requireUserId(c); // auth gate; the uploader's identity isn't stored on the blob

  const buffer = await readUpload(c);
  // Reject oversize before doing any work. arrayBuffer already buffered it, but
  // 8 MB is cheap to hold and this keeps a too-big file from reaching R2.
  if (buffer.byteLength > MEDIA.MAX_UPLOAD_BYTES) {
    throw errors.validation(`Upload exceeds the ${MEDIA.MAX_UPLOAD_BYTES} byte limit`);
  }
  if (buffer.byteLength === 0) throw errors.validation('Upload is empty');

  const bytes = new Uint8Array(buffer);

  // Trust the bytes, not the Content-Type: sniff the real format.
  const mime = sniffMime(bytes);
  if (!mime || !MEDIA.ALLOWED_MIME_TYPES.includes(mime as (typeof MEDIA.ALLOWED_MIME_TYPES)[number])) {
    throw errors.validation('Unsupported image format');
  }

  // Cap dimensions when we can read them. Unknown dimensions pass: the format is
  // already validated, and a missing header size shouldn't block a valid image.
  const dims = imageDimensions(bytes, mime);
  if (dims && (dims.width > MEDIA.MAX_DIMENSION || dims.height > MEDIA.MAX_DIMENSION)) {
    throw errors.validation(`Image exceeds ${MEDIA.MAX_DIMENSION}px on a side`);
  }

  const { object, url } = await storeObject(bytes, mime);

  return c.json<MediaUploadResponse>({
    id: object.id,
    url,
    mimeType: object.mimeType,
    width: object.width,
    height: object.height,
    sizeBytes: object.sizeBytes,
  });
});
