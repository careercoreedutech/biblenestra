// Local environment for development and tests: an in-process Postgres (PGlite) instead of Neon and an
// R2 stand-in on disk, so the Worker code runs unchanged with `node dev/server.mjs` — no accounts needed.
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import fs from 'node:fs';
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
  // R2 multipart stand-in (parts kept in memory). Enforces R2's rules: every part except the last must be
  // at least 5 MiB and all of them the same size; complete() needs every listed part with its etag.
  const MIN_PART = 5 * 1024 * 1024;
  const uploads = new Map(); // uploadId → { key, opts, parts: Map(n → { buf, etag }) }
  let bucket;
  const multipart = (key, uploadId) => ({
    key,
    uploadId,
    async uploadPart(n, data) {
      const u = uploads.get(uploadId);
      if (!u || u.key !== key) throw new Error('NoSuchUpload');
      const buf = await toBuffer(data);
      const etag = `p${n}-${buf.length}-${Math.random().toString(36).slice(2, 8)}`;
      u.parts.set(n, { buf, etag });
      return { partNumber: n, etag };
    },
    async complete(parts) {
      const u = uploads.get(uploadId);
      if (!u || u.key !== key) throw new Error('NoSuchUpload');
      const bufs = parts.map((p, i) => {
        const got = u.parts.get(p.partNumber);
        if (!got || got.etag !== p.etag) throw new Error(`InvalidPart ${p.partNumber}`);
        const last = i === parts.length - 1;
        if (!last && got.buf.length < MIN_PART) throw new Error('EntityTooSmall');
        if (!last && i > 0 && got.buf.length !== u.parts.get(parts[0].partNumber).buf.length) throw new Error('parts must be the same size');
        return got.buf;
      });
      uploads.delete(uploadId);
      await bucket.put(key, Buffer.concat(bufs), u.opts);
      return bucket.head(key);
    },
    async abort() { uploads.delete(uploadId); },
  });
  bucket = {
    async createMultipartUpload(key, opts = {}) {
      const uploadId = `mp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      uploads.set(uploadId, { key, opts, parts: new Map() });
      return multipart(key, uploadId);
    },
    resumeMultipartUpload(key, uploadId) { return multipart(key, uploadId); },
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
  return bucket;
}

// Static files (wrangler [assets] → env.ASSETS): serves backend/public from disk for local runs and tests.
export function makeAssets(dir) {
  return {
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const p = path.resolve(path.join(dir, decodeURIComponent(pathname)));
      if (!p.startsWith(path.resolve(dir)) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return new Response('Not found', { status: 404 });
      return new Response(fs.readFileSync(p));
    },
  };
}
