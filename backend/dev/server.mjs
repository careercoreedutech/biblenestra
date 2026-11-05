// Local API server: `npm run dev` → http://localhost:8787
// Uses PGlite (data in dev/.data/db) and a folder for uploads (dev/.data/media). Auth: X-Dev-User header.
// Optional: `node dev/server.mjs --seed` loads demo content from db/seed-demo.sql on first run.
import { serve } from '@hono/node-server';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from './local-env.mjs';

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
  AUTH_DEV_MODE: 'true',
  ADS_CLIENT_CLAIM: 'true',
  CORS_ORIGINS: '*',
  // Fund Me: simulated payments locally (PAYMENTS_MODE=off → "Donations open soon")
  PAYMENTS_MODE: process.env.PAYMENTS_MODE === 'off' ? '' : (process.env.PAYMENTS_MODE || 'test'),
};
const app = createApp();
const port = Number(process.env.PORT || 8787);
serve({ fetch: (req) => app.fetch(req, env), port });
console.log(`BibleNestra API (local) on http://localhost:${port}`);
