import { loadRootEnv, loadServerEnv } from '@counter/config/env';
import { ALGORITHM } from '@counter/config';

loadRootEnv();
const env = loadServerEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL must be set to seed.');

const { createDb, runWithDb, db } = await import('./client.ts');
const schema = await import('./schema.ts');
const { users, posts, follows, likes, reposts, tags, postTags, themes, algorithmChangelog, postViews } =
  schema;

const instance = createDb(env.DATABASE_URL);

/**
 * Idempotent-ish seed: clears content tables and inserts a small, realistic
 * dataset so the app has something to render on first run. Safe for local dev.
 */
await runWithDb(instance, async () => {
  console.log('Seeding…');

  // Clear in FK-safe order.
  await db.delete(postViews);
  await db.delete(postTags);
  await db.delete(likes);
  await db.delete(reposts);
  await db.delete(follows);
  await db.delete(posts);
  await db.delete(tags);
  await db.delete(themes);
  await db.delete(algorithmChangelog);
  await db.delete(users);

  // PBKDF2 password hash, identical scheme to the API's WebCrypto hasher.
  const passwordHash = await hashPassword('password123');

  const [ada, linus, grace] = await db
    .insert(users)
    .values([
      {
        username: 'ada',
        displayName: 'Ada Lovelace',
        email: 'ada@counter.ltd',
        passwordHash,
        bio: 'Writing the first algorithm, in the open.',
        verified: true,
      },
      {
        username: 'linus',
        displayName: 'Linus',
        email: 'linus@counter.ltd',
        passwordHash,
        bio: 'Talk is cheap. Show me the code.',
      },
      {
        username: 'grace',
        displayName: 'Grace Hopper',
        email: 'grace@counter.ltd',
        passwordHash,
        bio: 'It is easier to ask forgiveness than permission.',
        verified: true,
      },
    ])
    .returning();

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

  // Anonymous view ticks (no identity attached).
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

  console.log('Seed complete. Login with any of: ada / linus / grace (password: password123)');
});

await instance.sql.end();
process.exit(0);

/** Inline copy of the API's PBKDF2 hasher so seed and runtime agree on format. */
async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000;
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
