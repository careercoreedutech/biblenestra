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
const dataDir = path.join(here, '.data');
const fresh = !existsSync(path.join(dataDir, 'db'));
await mkdir(dataDir, { recursive: true });
const db = await makeDb(path.join(dataDir, 'db'));
if (fresh && process.argv.includes('--seed')) {
  await db.pg.exec(await readFile(path.join(here, '..', 'db', 'seed-demo.sql'), 'utf8'));
  console.log('Seeded demo content');
}
const env = {
  __db: db,
  MEDIA: makeBucket(path.join(dataDir, 'media')),
  AUTH_DEV_MODE: 'true',
  ADS_CLIENT_CLAIM: 'true',
  CORS_ORIGINS: '*',
};
const app = createApp();
const port = Number(process.env.PORT || 8787);
serve({ fetch: (req) => app.fetch(req, env), port });
console.log(`BibleNestra API (local) on http://localhost:${port}`);
