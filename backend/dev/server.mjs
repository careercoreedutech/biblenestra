// Local API server: `npm run dev` → http://localhost:8787
// Uses PGlite (data in dev/.data/db) and a folder for uploads (dev/.data/media). Auth: X-Dev-User header.
// Optional: `node dev/server.mjs --seed` loads demo content from db/seed-demo.sql on first run.
import { serve } from '@hono/node-server';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket, makeAssets } from './local-env.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets several local servers run side by side (each needs its own PGlite folder)
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, '.data');
const fresh = !existsSync(path.join(dataDir, 'db'));
await mkdir(dataDir, { recursive: true });
const db = await makeDb(path.join(dataDir, 'db'));
if (fresh && process.argv.includes('--seed')) {
  await db.pg.exec(await readFile(path.join(here, '..', 'db', 'seed-demo.sql'), 'utf8'));
  console.log('Seeded demo content');
}
// DEV_ADMINS=admin,alice → those dev users get role 'admin' (for the /admin dashboard). Local only.
for (const name of String(process.env.DEV_ADMINS || 'admin').split(',').map((x) => x.trim()).filter((x) => /^[\w.-]{1,40}$/.test(x))) {
  await db.pg.query(`INSERT INTO users (clerk_id, display_name, role) VALUES ($1, $2, 'admin')
    ON CONFLICT (clerk_id) DO UPDATE SET role = 'admin'`, [`dev_${name}`, name.charAt(0).toUpperCase() + name.slice(1)]);
}
const env = {
  __db: db,
  MEDIA: makeBucket(path.join(dataDir, 'media')),
  ASSETS: makeAssets(path.join(here, '..', 'public')),
  AUTH_DEV_MODE: 'true',
  ADS_CLIENT_CLAIM: 'true',
  CORS_ORIGINS: '*',
  // Fund Me: simulated payments locally (PAYMENTS_MODE=off → "Donations open soon")
  PAYMENTS_MODE: process.env.PAYMENTS_MODE === 'off' ? '' : (process.env.PAYMENTS_MODE || 'test'),
  LINK_PREVIEWS: process.env.LINK_PREVIEWS || '', // CHAT GAPS: 'on' → chat link-preview cards fetch real websites locally
  // MEMBERSHIPS: test checkout for admins / testers, external payment rows (shown disabled), creator flag
  MEMBERSHIP_TEST_CHECKOUT: process.env.MEMBERSHIP_TEST_CHECKOUT || '',
  MEMBERSHIP_TESTERS: process.env.MEMBERSHIP_TESTERS || '',
  MEMBERSHIP_EXTERNAL_METHODS: process.env.MEMBERSHIP_EXTERNAL_METHODS || '',
  // WALLET CORE: test purchases for admins / testers; Paystack stays off unless keys are given (Fund Me only)
  WALLET_TEST_PURCHASES: process.env.WALLET_TEST_PURCHASES || '',
  WALLET_TESTERS: process.env.WALLET_TESTERS || '',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY || '',
  MEMBERSHIPS_PUBLIC_CREATION: process.env.MEMBERSHIPS_PUBLIC_CREATION || '',
};
// MEMBERSHIPS: `--seed-memberships` loads demo memberships (dev/seed-memberships.mjs) once, when none exist yet
if (process.argv.includes('--seed-memberships')) {
  const has = await db.query('SELECT 1 FROM memberships LIMIT 1');
  if (!has.length) {
    const { seedMemberships } = await import('./seed-memberships.mjs');
    console.log(`Seeded ${await seedMemberships(env)} demo memberships`);
  }
}
// FIND LOVE: `--seed-dating` loads ~20 demo dating profiles (dev/seed-dating.mjs) once, when none exist yet.
// DATING_DEMO_USER=<dev user> also gives that dev user a profile, coins, likes waiting and one match.
if (process.argv.includes('--seed-dating')) {
  const has = await db.query('SELECT 1 FROM dating_profiles LIMIT 1');
  if (!has.length) {
    const { seedDating } = await import('./seed-dating.mjs');
    console.log(`Seeded ${await seedDating(env, { demoUser: process.env.DATING_DEMO_USER || null })} demo dating profiles`);
  }
}
const app = createApp();
// PAYSTACK FOR EVERY PURCHASE: PAYSTACK_FAKE=1 → a pretend Paystack page (dev/fake-paystack.mjs), no keys, no money.
if (process.env.PAYSTACK_FAKE === '1' && !env.PAYSTACK_SECRET_KEY) {
  const { makeFakePaystack } = await import('./fake-paystack.mjs');
  const { fake, fetchFn } = makeFakePaystack();
  env.__paystackFake = fake; env.__paystackFetch = fetchFn;
  console.log('Paystack: FAKE local checkout (PAYSTACK_FAKE=1)');
}
const port = Number(process.env.PORT || 8787);
serve({ fetch: (req) => app.fetch(req, env), port });
console.log(`BibleNestra API (local) on http://localhost:${port}`);
