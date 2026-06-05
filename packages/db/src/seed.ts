// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Local dev seed. Wipes the content tables and inserts a small, believable
 * dataset (three users, a handful of posts, follows, likes, views, a theme) so
 * the app renders something real on first run. Bun-only, never on Workers.
 */
import { loadRootEnv, loadServerEnv } from '@counter/config/env';
import { ALGORITHM, PERMISSION_KEYS, MODERATOR_PERMISSIONS, SYSTEM_GROUPS } from '@counter/config';

loadRootEnv();
const env = loadServerEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL must be set to seed.');

// Dynamic import after the env check so client.ts/schema.ts only load once we
// know there's a database to talk to.
const { createDb, runWithDb, db } = await import('./client.ts');
const schema = await import('./schema.ts');
const { users, posts, follows, likes, reposts, tags, postTags, themes, algorithmChangelog, postViews, groups, userGroups } =
  schema;

const instance = createDb(env.DATABASE_URL);

// Everything runs inside runWithDb so the ambient `db` resolves to this
// connection (see client.ts). Re-running the seed replaces the data, it doesn't
// stack on top, since we clear the tables first.
await runWithDb(instance, async () => {
  console.log('Seeding…');

  // Delete children before parents so foreign keys never block a delete. This
  // order is the reverse of how the rows depend on each other.
  await db.delete(postViews);
  await db.delete(postTags);
  await db.delete(likes);
  await db.delete(reposts);
  await db.delete(follows);
  await db.delete(posts);
  await db.delete(tags);
  await db.delete(themes);
  await db.delete(algorithmChangelog);
  // user_groups references both users and groups, so clear it before either.
  await db.delete(userGroups);
  await db.delete(groups);
  await db.delete(users);

  // Every seed user shares one password. We hash it once and reuse it; the
  // format matches the API's hasher so these accounts can actually log in.
  const passwordHash = await hashPassword('password123');

  // Emails are encrypted at rest, with a blind index for lookup, exactly as the
  // API writes them. The keys must match apps/api/.dev.vars, or these accounts
  // won't decrypt or resolve at login.
  const [ada, linus, grace] = await db
    .insert(users)
    .values([
      {
        username: 'ada',
        displayName: 'Ada Lovelace',
        ...(await emailFields('ada@counter.ltd')),
        passwordHash,
        bio: 'Writing the first algorithm, in the open.',
        verified: true,
      },
      {
        username: 'linus',
        displayName: 'Linus',
        ...(await emailFields('linus@counter.ltd')),
        passwordHash,
        bio: 'Talk is cheap. Show me the code.',
      },
      {
        username: 'grace',
        displayName: 'Grace Hopper',
        ...(await emailFields('grace@counter.ltd')),
        passwordHash,
        bio: 'It is easier to ask forgiveness than permission.',
        verified: true,
      },
    ])
    .returning();

  // .returning() hands back the inserted rows so we can wire up relationships
  // below with the generated ids. The guards keep TypeScript happy and catch a
  // silently empty insert early.
  if (!ada || !linus || !grace) throw new Error('Seed users failed');

  const [open, code] = await db
    .insert(tags)
    .values([{ name: 'opensource' }, { name: 'code' }])
    .returning();

  const [p1, p2, p3] = await db
    .insert(posts)
    .values([
      { userId: ada.id, body: 'Counter is live. Every view is anonymous. #opensource' },
      { userId: linus.id, body: 'The whole algorithm is readable at /algorithm. #code' },
      { userId: grace.id, body: 'No follower gate on insights. From post one.' },
    ])
    .returning();

  if (!p1 || !p2 || !p3 || !open || !code) throw new Error('Seed posts/tags failed');

  // A reply to p1: parentId set, so it threads under Ada's launch post.
  await db
    .insert(posts)
    .values([{ userId: linus.id, body: 'Finally. A platform that respects this.', parentId: p1.id }]);

  await db.insert(postTags).values([
    { postId: p1.id, tagId: open.id },
    { postId: p2.id, tagId: code.id },
  ]);

  await db.insert(follows).values([
    { followerId: linus.id, followingId: ada.id },
    { followerId: grace.id, followingId: ada.id },
    { followerId: ada.id, followingId: grace.id },
  ]);

  await db.insert(likes).values([
    { userId: linus.id, postId: p1.id },
    { userId: grace.id, postId: p1.id },
    { userId: ada.id, postId: p2.id },
  ]);

  await db.insert(reposts).values([{ userId: grace.id, postId: p2.id }]);

  // Anonymous view ticks, one row per view, no identity attached (see the
  // post_views privacy note in schema.ts). Uneven counts make the numbers in
  // the UI look lived-in rather than placeholder.
  const views = [
    ...Array.from({ length: 12 }, () => ({ postId: p1.id, referrer: 'feed' })),
    ...Array.from({ length: 5 }, () => ({ postId: p1.id, referrer: 'profile' })),
    ...Array.from({ length: 8 }, () => ({ postId: p2.id, referrer: 'external' })),
    ...Array.from({ length: 3 }, () => ({ postId: p3.id, referrer: 'direct' })),
  ];
  await db.insert(postViews).values(views);

  await db.insert(themes).values([
    {
      userId: ada.id,
      name: 'Glass Noir',
      description: 'Deep dark with a cold glass edge.',
      variables: {
        '--color-bg': '#08090c',
        '--color-surface': 'rgba(255,255,255,0.04)',
        '--color-text': '#e8eaf0',
        '--color-accent': '#7aa2ff',
      },
      published: true,
    },
  ]);

  // First entry in the public transparency log, pinned to the algorithm version
  // shipped in @counter/config so the log and the live weights agree.
  await db.insert(algorithmChangelog).values([
    {
      version: ALGORITHM.version,
      summary: 'Initial public ranking algorithm.',
      detail:
        'Chronological-leaning ranking with recency decay and light public-engagement weighting. No personalization, no individual tracking.',
      changedBy: 'counter',
      commitHash: 'genesis',
    },
  ]);

  // Admin groups. `admin` carries every permission (the resolver also grants the
  // full set to any admin-group member regardless of what's stored); `moderator`
  // is the content-focused subset. Both are system groups, so the panel won't let
  // anyone delete them out from under the site.
  const [adminGroup, modGroup] = await db
    .insert(groups)
    .values([
      {
        slug: SYSTEM_GROUPS.ADMIN,
        name: 'Administrators',
        description: 'Full access to every part of the control panel.',
        permissions: [...PERMISSION_KEYS],
        color: '#7aa2ff',
        isSystem: true,
      },
      {
        slug: SYSTEM_GROUPS.MODERATOR,
        name: 'Moderators',
        description: 'Content moderation and the report queue.',
        permissions: MODERATOR_PERMISSIONS,
        color: '#7ad1a8',
        isSystem: true,
      },
    ])
    .returning();
  if (!adminGroup || !modGroup) throw new Error('Seed groups failed');

  // ada runs the place; grace helps moderate. linus is a normal user, so the
  // seeded data shows the panel both with and without access.
  await db.insert(userGroups).values([
    { userId: ada.id, groupId: adminGroup.id, assignedBy: ada.id },
    { userId: grace.id, groupId: modGroup.id, assignedBy: ada.id },
  ]);

  console.log('Seed complete. Login with any of: ada / linus / grace (password: password123)');
  console.log('  ada = Administrator, grace = Moderator, linus = regular user');
});

await instance.sql.end();
// Force exit so a lingering postgres handle doesn't keep the process alive.
process.exit(0);

/**
 * Inline copy of the API's PBKDF2 hasher so seeded accounts hash identically to
 * ones created through signup and can log in. Output format is
 * `pbkdf2$iterations$saltB64$hashB64`, which the API's verifier parses back.
 */
async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000;
  // Random per-password salt so two users with the same password hash differently.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

/** Hex string to bytes, for loading the 32-byte AES/HMAC keys from env. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

/**
 * Inline copy of the API's field encryption (AES-256-GCM, `v1:` envelope), so
 * seeded emails are stored in the same encrypted-at-rest shape the API writes.
 * Kept here rather than imported because the seed can't reach into apps/api.
 */
async function encryptField(plaintext: string, hexKey: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', hexToBytes(hexKey), { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `v1:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

/** Inline copy of the API's blind index (keyed HMAC-SHA256) for email lookups. */
async function blindIndex(value: string, hexKey: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(hexKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build the encrypted email + blind index pair a seeded user row needs. */
async function emailFields(address: string): Promise<{ email: string; emailIndex: string }> {
  const lowered = address.toLowerCase();
  return {
    email: await encryptField(lowered, env.MESSAGE_ENCRYPTION_KEY),
    emailIndex: await blindIndex(lowered, env.BLIND_INDEX_KEY),
  };
}
