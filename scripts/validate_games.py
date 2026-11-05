#!/usr/bin/env python3
"""Validate BibleNestra game banks (src/data/games/*.json) and the daily rotation.

Checks
  * every bank has >= 1,500 items (endless practice); total size < 3 MB; ids unique within (and across) banks
  * multiple-choice: exactly 4 options, no duplicate options (case-insensitive), answer index valid
  * every reference resolves to real KJV verses (book/chapter/verse exist) where it is a verse ref
  * who-said-it: quote text appears verbatim in the cited KJV verse(s)
  * scramble: words, joined, appear in the cited KJV verse (punctuation-insensitive), >= 6 words
  * daily rotation (runs daily.js in Node): 12/8 per day, no repeat inside a pool's first cycle,
    correct answer survives option shuffling
  * endless practice (createEndless in daily.js): no repeats until the bank is exhausted, today's set
    skipped, a fresh order on the next lap, no back-to-back repeat across laps, resumable from a position
Exit code 1 on any failure.
"""
import json
import os
import re
import subprocess
import sys

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')
G = os.path.join(APP, 'data', 'games')
G_JS = G.replace('\\', '/')
KJV = json.load(open(os.path.join(APP, 'data', 'kjv_bible.json'), encoding='utf-8'))
META = json.load(open(os.path.join(APP, 'data', 'books_meta.json'), encoding='utf-8'))
NAME2ID = {b['name']: b['id'] for b in META}
NAME2ID['Psalm'] = 'PSA'
errors = []


def err(m):
    errors.append(m)


def norm(s):
    return re.sub(r'[^a-z0-9 ]', '', re.sub(r'\s+', ' ', s.lower().replace('’', "'"))).strip()


def resolve(label):
    """'John 3:16' / '1 Samuel 17:40-41' -> verse text, or None if label isn't a single verse ref."""
    m = re.match(r'^(.+?) (\d+):(\d+)(?:-(\d+))?$', label)
    if not m or m.group(1) not in NAME2ID:
        return None
    ch = KJV.get(f'{NAME2ID[m.group(1)]}:{m.group(2)}')
    v1 = int(m.group(3)); v2 = int(m.group(4) or v1)
    if not ch or v2 > len(ch) or v1 < 1:
        err(f'bad reference {label}')
        return ''
    return ' '.join(ch[v1 - 1:v2])


banks = {n: json.load(open(os.path.join(G, n + '.json'), encoding='utf-8')) for n in ['trivia', 'who', 'scramble', 'chronology']}
DAILY_N = {'trivia': 12, 'who': 12, 'scramble': 8, 'chronology': 12}
all_ids = set()
for name, items in banks.items():
    if len(items) < 1500:
        err(f'{name}: only {len(items)} items (need >= 1500)')
    ids = [x['id'] for x in items]
    if len(set(ids)) != len(ids):
        err(f'{name}: duplicate ids')
    if all_ids & set(ids):
        err(f'{name}: ids collide with another bank')
    all_ids |= set(ids)
    for x in items:
        if 'o' in x:
            o = x['o']
            if len(o) != 4:
                err(f'{name} {x["id"]}: {len(o)} options')
            if len({s.strip().lower() for s in o}) != len(o):
                err(f'{name} {x["id"]}: duplicate options {o}')
            if not (0 <= x['a'] < len(o)):
                err(f'{name} {x["id"]}: answer index out of range')
            if not x.get('r') or not x.get('x'):
                err(f'{name} {x["id"]}: missing reference/explanation')
        text = resolve(x['r'].split(' · ')[0])
        if name == 'who' and text is not None and norm(x['q']) not in norm(text):
            err(f'who {x["id"]}: quote not in {x["r"]}')
        if name == 'scramble':
            if len(x['w']) < 6:
                err(f'scramble {x["id"]}: too few words')
            if text is not None and norm(' '.join(x['w'])) not in norm(text):
                err(f'scramble {x["id"]}: words not in {x["r"]}')

# ---- daily rotation, executed with Node against the real daily.js
node = r'''
const fs = require('fs');
const src = fs.readFileSync('%s/daily.js', 'utf8').replace(/export (function|const)/g, '$1');
const m = {}; new Function('m', src + '; Object.assign(m,{dailySelection,takeForDay,dayNumber,dateKey,createEndless});')(m);
const load = (n) => JSON.parse(fs.readFileSync('%s/' + n + '.json', 'utf8'));
const MIX = { trivia: [['story',6],['verse',4],['books',2]], who: [['famous',4],['more',8]], scramble: [['famous',4],['more',4]], chronology: [['events',7],['books',5]] };
const out = {};
for (const g of Object.keys(MIX)) {
  const items = load(g).map((x) => ({ id: x.id, pool: x.k, options: x.o, correctIndex: x.a, answer: x.o ? x.o[x.a] : null }));
  const sizes = new Set(); let badAnswer = 0; const firstSeen = {}; let earlyRepeat = 0;
  const poolSize = {}; items.forEach((x) => { poolSize[x.pool] = (poolSize[x.pool] || 0) + 1; });
  const take = Object.fromEntries(MIX[g]);
  for (let d = 0; d < 120; d++) {
    const date = new Date(2026, 10, 1 + d);
    const set = m.dailySelection(g, items, MIX[g], date, { shuffleChoices: g !== 'scramble' });
    sizes.add(set.length);
    set.forEach((q) => {
      if (q.options && q.options[q.correctIndex] !== q.answer) badAnswer++;
      const cyc = Math.floor(poolSize[q.pool] / take[q.pool]);
      if (firstSeen[q.id] != null && d - firstSeen[q.id] < cyc) earlyRepeat++;
      if (firstSeen[q.id] == null) firstSeen[q.id] = d;
    });
  }
  const today = m.dailySelection(g, items, MIX[g], new Date(2026, 10, 1)).map((q) => q.id).join(',');
  const again = m.dailySelection(g, items, MIX[g], new Date(2026, 10, 1, 23, 59)).map((q) => q.id).join(',');
  const tomorrow = m.dailySelection(g, items, MIX[g], new Date(2026, 10, 2)).map((q) => q.id).join(',');
  // endless practice
  const ex = m.dailySelection(g, items, MIX[g], new Date(2026, 10, 1)).map((q) => q.id);
  const it = m.createEndless(items, { seed: 12345, exclude: ex });
  const lap1 = new Set(); let lapDup = 0, exServed = 0;
  for (let k = 0; k < items.length - ex.length; k++) { const r = it.next(); if (lap1.has(r.item.id)) lapDup++; lap1.add(r.item.id); if (ex.includes(r.item.id)) exServed++; }
  const lap2 = []; let prev = null, backToBack = 0;
  for (let k = 0; k < items.length - ex.length; k++) { const r = it.next(); lap2.push(r.item.id); if (r.item.id === prev) backToBack++; prev = r.item.id; }
  const lap2Unique = new Set(lap2).size === lap2.length;
  const a = m.createEndless(items, { seed: 777, exclude: ex }); for (let k = 0; k < 333; k++) a.next();
  const b = m.createEndless(items, { seed: 777, exclude: ex, start: a.position });
  const resumes = a.next().item.id === b.next().item.id;
  const endless = { lap1: lap1.size, lapDup, exServed, lap2Unique, backToBack, resumes, newOrder: [...lap1].slice(0, 20).join() !== lap2.slice(0, 20).join() };
  out[g] = { sizes: [...sizes], badAnswer, earlyRepeat, deterministic: today === again, changes: today !== tomorrow, distinct120: Object.keys(firstSeen).length, endless };
}
console.log(JSON.stringify(out));
''' % (G_JS, G_JS)
res = subprocess.run(['node', '-e', node], capture_output=True, text=True)
if res.returncode:
    err('node daily test failed: ' + res.stderr[-800:])
else:
    daily = json.loads(res.stdout)
    for g, r in daily.items():
        print(f'daily {g}: {r}')
        want = 8 if g == 'scramble' else 12
        if r['sizes'] != [want]:
            err(f'daily {g}: sizes {r["sizes"]}')
        if r['badAnswer'] or r['earlyRepeat'] or not r['deterministic'] or not r['changes']:
            err(f'daily {g}: {r}')
        e = r['endless']
        if e['lap1'] != len(banks[g]) - DAILY_N[g] or e['lapDup'] or e['exServed'] or not e['lap2Unique'] or e['backToBack'] or not e['resumes'] or not e['newOrder']:
            err(f'endless {g}: {e}')

total = sum(os.path.getsize(os.path.join(G, n + '.json')) for n in banks)
print(f'total bank size {total // 1024} KB')
if total > 3 * 1024 * 1024:
    err(f'game banks total {total} bytes (> 3 MB)')
meta = json.load(open(os.path.join(G, 'meta.json'), encoding='utf-8'))
if meta != {n: len(items) for n, items in banks.items()}:
    err(f'meta.json out of date: {meta}')
for n, items in banks.items():
    pools = {}
    for x in items:
        pools[x['k']] = pools.get(x['k'], 0) + 1
    print(f'{n}: {len(items)} items {pools}  ({os.path.getsize(os.path.join(G, n + ".json")) // 1024} KB)')
if errors:
    print('\n'.join('FAIL ' + e for e in errors[:60]))
    print(f'{len(errors)} problem(s)')
    sys.exit(1)
print('OK — all game banks valid')
