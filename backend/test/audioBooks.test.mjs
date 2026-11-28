// AUDIO BOOKS (brief 18.1): an admin creates a multi-chapter audio book (cover, then ordered audio files, each with a
// chapter title). The first chapter is the item's main file. Every chapter is streamable through its own signed URL.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { makeDb, makeBucket } from '../dev/local-env.mjs';

let env; const app = createApp();
before(async () => {
  env = { __db: await makeDb(null), MEDIA: makeBucket(null), AUTH_DEV_MODE: 'true', REALTIME_SECRET: 'rt-secret' };
  await env.__db.query(`INSERT INTO users (clerk_id, display_name, role) VALUES ('dev_boss', 'Boss', 'admin')`);
});

async function call(user, method, p, body) {
  const h = { 'X-Dev-User': user };
  let b;
  if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await app.fetch(new Request(`http://api.test${p}`, { method, headers: h, body: b }), env);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  return { status: res.status, json };
}
async function uploadAudio(user, fill) {
  const data = new Uint8Array(3000).fill(fill);
  const res = await app.fetch(new Request('http://api.test/library/files?kind=audio', {
    method: 'POST', headers: { 'X-Dev-User': user, 'Content-Type': 'audio/mpeg', 'Content-Length': String(data.byteLength) }, body: data,
  }), env);
  assert.equal(res.status, 201);
  return (await res.json()).key;
}

test('admin publishes an audio book with ordered chapters; each chapter has its own URL', async () => {
  const k1 = await uploadAudio('boss', 1);
  const k2 = await uploadAudio('boss', 2);
  const k3 = await uploadAudio('boss', 3);
  const r = await call('boss', 'POST', '/library/items', {
    kind: 'audio', scope: 'platform', fileKey: k1, title: 'The Pilgrim’s Progress (audio)', artist: 'Narrator', durationSec: 900,
    chapters: [
      { fileKey: k1, title: 'Chapter 1: The burden', durationSec: 300 },
      { fileKey: k2, title: 'Chapter 2: The slough', durationSec: 320 },
      { fileKey: k3, title: '', durationSec: 280 },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.chapters.length, 3);
  assert.deepEqual(r.json.chapters.map((c) => c.index), [1, 2, 3]);
  assert.equal(r.json.chapters[0].title, 'Chapter 1: The burden');
  assert.equal(r.json.chapters[2].title, 'Chapter 3', 'an empty chapter title gets a default');
  assert.ok(r.json.chapters.every((c) => /\/library\/file\/lib\/audio\//.test(c.url)), 'each chapter has a playable file URL');
  assert.notEqual(r.json.chapters[0].url, r.json.chapters[1].url);
  // the library list returns the book with its chapters too
  const list = await call('alice', 'GET', '/library/items?kind=audio');
  const found = list.json.items.find((i) => i.id === r.json.id);
  assert.ok(found && found.chapters.length === 3, 'members see the chapters in the library');
});

test('chapters must start with the item file, be distinct, and be audio', async () => {
  const a = await uploadAudio('boss', 4);
  const b = await uploadAudio('boss', 5);
  const wrongFirst = await call('boss', 'POST', '/library/items', {
    kind: 'audio', scope: 'platform', fileKey: a, title: 'Mismatch',
    chapters: [{ fileKey: b, title: 'One' }, { fileKey: a, title: 'Two' }],
  });
  assert.equal(wrongFirst.status, 400, 'the first chapter must be the item file');
  const dupes = await call('boss', 'POST', '/library/items', {
    kind: 'audio', scope: 'platform', fileKey: a, title: 'Dupes',
    chapters: [{ fileKey: a, title: 'One' }, { fileKey: a, title: 'Two' }],
  });
  assert.equal(dupes.status, 400, 'a chapter file cannot repeat');
  const pdfKey = await uploadAudio('boss', 6);
  const notAudio = await call('boss', 'POST', '/library/items', {
    kind: 'pdf', scope: 'platform', fileKey: pdfKey, title: 'Not a PDF', rightsAttested: true,
    chapters: [{ fileKey: pdfKey, title: 'One' }],
  });
  assert.equal(notAudio.status, 400, 'chapters are for audio items only');
});

test('a chapter file already used by another item is refused; non-admins cannot publish to the platform', async () => {
  const used = await uploadAudio('boss', 7);
  const first = await call('boss', 'POST', '/library/items', { kind: 'audio', scope: 'platform', fileKey: used, title: 'Sermon' });
  assert.equal(first.status, 201);
  const other = await uploadAudio('boss', 8);
  const reuse = await call('boss', 'POST', '/library/items', {
    kind: 'audio', scope: 'platform', fileKey: other, title: 'Book reusing a sermon',
    chapters: [{ fileKey: other, title: 'One' }, { fileKey: used, title: 'Two' }],
  });
  assert.equal(reuse.status, 409, 'a file already in the library is refused');
  const memberUpload = await uploadAudio('alice', 9);
  const denied = await call('alice', 'POST', '/library/items', {
    kind: 'audio', scope: 'platform', fileKey: memberUpload, title: 'Nope', chapters: [{ fileKey: memberUpload, title: 'One' }],
  });
  assert.equal(denied.status, 403);
});
