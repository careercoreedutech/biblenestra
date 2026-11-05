// Local environment for development and tests: an in-process Postgres (PGlite) instead of Neon and an
// R2 stand-in on disk, so the Worker code runs unchanged with `node dev/server.mjs` — no accounts needed.
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function makeDb(dataDir) {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.exec(await readFile(path.join(here, '..', 'db', 'schema.sql'), 'utf8'));
  return {
    pg,
    async query(text, params = []) { return (await pg.query(text, params)).rows; },
  };
}

// Minimal R2 bucket (put/get/head with ranges) backed by a folder (or memory when dir is null)
async function toBuffer(data) {
  if (data === null || data === undefined) return Buffer.alloc(0);
  if (typeof data.getReader === 'function') return Buffer.from(await new Response(data).arrayBuffer()); // ReadableStream
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  return Buffer.from(data);
}

export function makeBucket(dir) {
  const memory = new Map();
  const load = async (key) => {
    if (!dir) return memory.get(key) || null;
    const f = path.join(dir, key);
    if (!existsSync(f)) return null;
    const meta = JSON.parse(await readFile(`${f}.meta.json`, 'utf8').catch(() => '{}'));
    return { buf: await readFile(f), meta };
  };
  const obj = (m, buf) => ({ size: m.buf.length, httpMetadata: m.meta, httpEtag: `"${m.buf.length}"`, body: buf });
  return {
    async put(key, data, opts = {}) {
      const buf = await toBuffer(data);
      const meta = { contentType: opts.httpMetadata?.contentType || 'application/octet-stream' };
      if (!dir) { memory.set(key, { buf, meta }); return; }
      const f = path.join(dir, key);
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, buf);
      await writeFile(`${f}.meta.json`, JSON.stringify(meta));
    },
    async head(key) { const m = await load(key); return m ? obj(m, null) : null; },
    async delete(key) {
      if (!dir) { memory.delete(key); return; }
      const f = path.join(dir, key);
      await rm(f, { force: true }); await rm(`${f}.meta.json`, { force: true });
    },
    async get(key, opts = {}) {
      const m = await load(key);
      if (!m) return null;
      const r = opts.range;
      const buf = r ? m.buf.subarray(r.offset, r.offset + r.length) : m.buf;
      return obj(m, buf);
    },
  };
}
