#!/usr/bin/env python3
"""Generate BibleNestra's game question banks from bundled, verifiable data.

Inputs (read-only):
  src/data/kjv_bible.json   {"GEN:1": ["In the beginning ...", ...], ...}
  src/data/books_meta.json  [{id, name, testament, chapters}, ...]
  scripts/games_curated.py  hand-curated trivia / quotes / events / famous verse list

Outputs (src/data/games/):
  trivia.json  who.json  scramble.json  chronology.json

Every generated item cites a KJV reference and is built from the KJV text itself, so
answers are correct by construction. Curated items are cross-checked against the cited
verse text (answer keyword must appear) and any mismatch is printed as a WARN.

Deterministic: the same inputs always give the same output (fixed RNG seed).
Run:  python3 scripts/gen_games.py
"""
import json
import os
import random
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from games_curated import TRIVIA_LEGACY, TRIVIA, WHO, EVENTS, FAMOUS  # noqa: E402

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src')
DATA = os.path.join(APP, 'data')
OUT = os.path.join(DATA, 'games')
os.makedirs(OUT, exist_ok=True)

KJV = json.load(open(os.path.join(DATA, 'kjv_bible.json')))
META = json.load(open(os.path.join(DATA, 'books_meta.json')))
BOOK = {b['id']: b for b in META}
ORDER = [b['id'] for b in META]
IDX = {b: i for i, b in enumerate(ORDER)}
OT_IDS = [b['id'] for b in META if b['testament'] == 'OT']
NT_IDS = [b['id'] for b in META if b['testament'] == 'NT']
WARN = []

CAT_LABEL = {
    'gospels': 'Gospels & Jesus', 'old_testament': 'Old Testament', 'miracles': 'Miracles & Parables',
    'prophets': 'Prophets & Kings', 'acts': 'Acts & Apostles', 'books': 'Books of the Bible', 'verses': 'Know the verse',
}


# ---------------------------------------------------------------- helpers
def bname(bid):
    return BOOK[bid]['name']


def parse_ref(ref):
    m = re.match(r'^([1-3]?[A-Z]{2,3}) (\d+):(\d+)(?:-(\d+))?$', ref)
    if not m:
        raise ValueError('bad ref ' + ref)
    bid, c, v1, v2 = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4)
    v2 = int(v2) if v2 else v1
    return bid, c, v1, v2


def ref_label(ref):
    bid, c, v1, v2 = parse_ref(ref)
    nm = 'Psalm' if bid == 'PSA' else bname(bid)
    return f'{nm} {c}:{v1}' + (f'-{v2}' if v2 != v1 else '')


def verses(ref):
    bid, c, v1, v2 = parse_ref(ref)
    ch = KJV.get(f'{bid}:{c}')
    if not ch or v2 > len(ch):
        raise ValueError('ref not in KJV: ' + ref)
    return [t.strip() for t in ch[v1 - 1:v2]]


def text(ref, limit=300):
    t = ' '.join(verses(ref))
    if len(t) > limit:
        t = t[:limit].rsplit(' ', 1)[0].rstrip(',;:') + '…'
    return t


def norm(s):
    return re.sub(r'[^a-z0-9 ]', '', re.sub(r'\s+', ' ', s.lower())).strip()


def words(s):
    return re.findall(r"[A-Za-z']+", s)


def mc(rng, answer, distractors):
    """Shuffle 4 options; return (options, correctIndex)."""
    opts = [answer] + list(distractors)
    rng.shuffle(opts)
    return opts, opts.index(answer)


def check_options(item, where):
    lo = [o.strip().lower() for o in item['o']]
    assert len(item['o']) == 4, (where, item)
    assert len(set(lo)) == 4, ('duplicate options', where, item)
    assert 0 <= item['a'] < 4, (where, item)


# 5-word shingles per book -> lets us reject "which book?" distractors that contain the same wording
SHINGLES = defaultdict(set)
for key, vs in KJV.items():
    bid = key.split(':')[0]
    for t in vs:
        w = norm(t).split()
        for i in range(len(w) - 4):
            SHINGLES[bid].add(' '.join(w[i:i + 5]))

# normalized verse text -> list of refs (to detect formulaic / repeated sentences)
ALL_VERSES = []
for key, vs in KJV.items():
    bid, c = key.split(':')
    for i, t in enumerate(vs):
        ALL_VERSES.append((bid, int(c), i + 1, t))
ALL_NORM = [(f'{b} {c}:{v}', ' ' + norm(t) + ' ') for b, c, v, t in ALL_VERSES]


def appears_elsewhere(fragment, own_ref):
    f = ' ' + norm(fragment) + ' '
    return any(f in t for r, t in ALL_NORM if r != own_ref)


rng = random.Random(20261101)

# ================================================================= TRIVIA
trivia = []
for q in TRIVIA_LEGACY:
    trivia.append({'id': q['id'], 'c': q['category'], 'q': q['question'], 'o': q['options'], 'a': q['correctIndex'],
                   'r': q['reference'], 'x': q['explanation'], 'k': 'story'})

for n, (cat, q, ans, dis, ref, *kw) in enumerate(TRIVIA, 1):
    kw = kw[0] if kw else ans
    body = ' '.join(verses(ref))
    if kw != '-' and kw.lower() not in body.lower():
        WARN.append(f'trivia c{n}: "{kw}" not in {ref}: {body[:140]}')
    o, a = mc(rng, ans, dis)
    trivia.append({'id': f'tc{n}', 'c': cat, 'q': q, 'o': o, 'a': a, 'r': ref_label(ref), 'x': text(ref), 'k': 'story'})

famous = [r.strip() for r in FAMOUS.replace('\n', ' ').split(',') if r.strip()]
famous = list(dict.fromkeys(famous))  # dedupe, keep order
for r in famous:
    verses(r)  # raises if missing

STOP = set('''the and that unto shall with thee thou thy thine them they their there this these those which what when
whom from have hath were will upon into also than then shalt said saith said ye you your our ours his her him
for not but all are was be is of in to a an it as by on or so no my me we us he she i am at if do did done
every even more most much many some such very own let may might must can could would should being been
among above whither thither hither himself herself themselves itself myself thyself yourselves before after about
against without within through thereof therein therefore wherefore because according doth behold verily also unto'''.split())


def content_words(t):
    out = []
    for w in re.findall(r"[A-Za-z']+", t):
        lw = w.lower().strip("'")
        if len(lw) >= 4 and lw not in STOP and "'" not in w:
            out.append(w)
    return out


def related(a, b):
    a, b = a.lower(), b.lower()
    k = min(len(a), len(b), 5)
    return a[:k] == b[:k] or a in b or b in a


chapter_words = {}


def chapter_pool(bid, c):
    key = (bid, c)
    if key not in chapter_words:
        ws = []
        for t in KJV[f'{bid}:{c}']:
            ws += content_words(t)
        chapter_words[key] = ws
    return chapter_words[key]


# --- Which book contains this verse?
for r in famous:
    bid, c, v, _ = parse_ref(r)
    t = verses(r)[0]
    if len(t) > 230:
        continue
    w = norm(t).split()
    sh = {' '.join(w[i:i + 5]) for i in range(len(w) - 4)}
    i = IDX[bid]
    window = [ORDER[j] for j in range(max(0, i - 7), min(66, i + 8)) if j != i]
    rng.shuffle(window)
    dis = [b for b in window if not (sh & SHINGLES[b])][:3]
    if len(dis) < 3:
        continue
    o, a = mc(rng, bname(bid), [bname(b) for b in dis])
    trivia.append({'id': f'tb-{bid}{c}.{v}', 'c': 'verses', 'q': f'In which book is this verse found?\n“{t}”', 'o': o, 'a': a,
                   'r': ref_label(r), 'x': t, 'k': 'verse'})

# --- Complete the verse (fill in the blank)
for r in famous:
    bid, c, v, _ = parse_ref(r)
    t = verses(r)[0]
    if len(t) > 220:
        continue
    cands = [w for w in content_words(t) if len(re.findall(r'\b' + re.escape(w) + r'\b', t)) == 1]
    if not cands:
        continue
    cands.sort(key=lambda w: (-len(w), w))
    ans = rng.choice(cands[:3])
    in_verse = {x.lower() for x in words(t)}
    pool = [w for w in chapter_pool(bid, c) if w.lower() not in in_verse and not related(w, ans)
            and abs(len(w) - len(ans)) <= 3 and (w[0].isupper() == ans[0].isupper()) and (w.isupper() == ans.isupper())]
    pool = list(dict.fromkeys(pool))
    if len(pool) < 3:  # widen to whole book
        extra = []
        for cc in range(1, BOOK[bid]['chapters'] + 1):
            extra += chapter_pool(bid, cc)
        pool += [w for w in dict.fromkeys(extra) if w.lower() not in in_verse and not related(w, ans) and w not in pool
                 and abs(len(w) - len(ans)) <= 3 and (w[0].isupper() == ans[0].isupper()) and (w.isupper() == ans.isupper())]
    dis = []
    for w in rng.sample(pool, len(pool)):
        if all(not related(w, d) for d in dis):
            dis.append(w)
        if len(dis) == 3:
            break
    if len(dis) < 3:
        continue
    blank = re.sub(r'\b' + re.escape(ans) + r'\b', '_____', t, count=1)
    o, a = mc(rng, ans, dis)
    trivia.append({'id': f'tf-{bid}{c}.{v}', 'c': 'verses', 'q': f'Complete the verse ({ref_label(r)}):\n“{blank}”', 'o': o, 'a': a,
                   'r': ref_label(r), 'x': t, 'k': 'verse'})

# --- How many chapters?
for b in META:
    n = b['chapters']
    pool = [x for x in {n - 3, n - 2, n - 1, n + 1, n + 2, n + 3, n + 5, n - 5, n * 2} if x > 0 and x != n]
    pool = sorted(pool)
    dis = rng.sample(pool, 3)
    o, a = mc(rng, str(n), [str(x) for x in dis])
    trivia.append({'id': f'tn-{b["id"]}', 'c': 'books', 'q': f'How many chapters are in the book of {b["name"]}?', 'o': o, 'a': a,
                   'r': f'{b["name"]} 1–{n}', 'x': f'{b["name"]} has {n} chapter{"s" if n != 1 else ""} in the King James Version.', 'k': 'books'})

# --- Which testament?
for n in range(24):
    want_nt = n % 2 == 0
    ans = rng.choice(NT_IDS if want_nt else OT_IDS)
    dis = rng.sample(OT_IDS if want_nt else NT_IDS, 3)
    o, a = mc(rng, bname(ans), [bname(d) for d in dis])
    tname = 'New' if want_nt else 'Old'
    trivia.append({'id': f'tt-{n}', 'c': 'books', 'q': f'Which of these books is in the {tname} Testament?', 'o': o, 'a': a,
                   'r': bname(ans), 'x': f'{bname(ans)} is in the {tname} Testament; the others are in the {"Old" if want_nt else "New"} Testament.', 'k': 'books'})

# --- Book superlatives computed from the data (only when the answer is unique)
lens = {k: len(v) for k, v in KJV.items()}
mx = max(lens.values()); mn = min(lens.values())
longest = [k for k, v in lens.items() if v == mx]
shortest = [k for k, v in lens.items() if v == mn]
if len(longest) == 1:
    b, c = longest[0].split(':')
    o, a = mc(rng, f'{"Psalm" if b == "PSA" else bname(b)} {c}', ['Psalm 23', 'Isaiah 53', 'Genesis 1'])
    trivia.append({'id': 'ts-longest', 'c': 'books', 'q': 'Which is the longest chapter in the Bible?', 'o': o, 'a': a, 'r': f'{"Psalm" if b == "PSA" else bname(b)} {c}', 'x': f'It has {mx} verses.', 'k': 'books'})
if len(shortest) == 1:
    b, c = shortest[0].split(':')
    o, a = mc(rng, f'{"Psalm" if b == "PSA" else bname(b)} {c}', ['Psalm 23', 'John 11', 'Jude 1'])
    trivia.append({'id': 'ts-shortest', 'c': 'books', 'q': 'Which is the shortest chapter in the Bible?', 'o': o, 'a': a, 'r': f'{"Psalm" if b == "PSA" else bname(b)} {c}', 'x': f'It has only {mn} verses.', 'k': 'books'})
most = max(META, key=lambda b: b['chapters'])
assert sum(1 for b in META if b['chapters'] == most['chapters']) == 1
o, a = mc(rng, most['name'], ['Isaiah', 'Genesis', 'Jeremiah'])
trivia.append({'id': 'ts-most', 'c': 'books', 'q': 'Which book of the Bible has the most chapters?', 'o': o, 'a': a, 'r': most['name'], 'x': f'{most["name"]} has {most["chapters"]} chapters.', 'k': 'books'})
for tid, qq, ansn, d in [('ts-ot', 'How many books are in the Old Testament?', len(OT_IDS), [27, 36, 46]),
                         ('ts-nt', 'How many books are in the New Testament?', len(NT_IDS), [21, 39, 24]),
                         ('ts-all', 'How many books are in the Bible (KJV, Protestant canon)?', len(ORDER), [72, 73, 60])]:
    o, a = mc(rng, str(ansn), [str(x) for x in d])
    trivia.append({'id': tid, 'c': 'books', 'q': qq, 'o': o, 'a': a, 'r': 'Canon of Scripture', 'x': f'The Old Testament has {len(OT_IDS)} books and the New Testament {len(NT_IDS)}: {len(ORDER)} in all.', 'k': 'books'})

for it in trivia:
    check_options(it, 'trivia')

# ================================================================= WHO SAID IT
OT_BOOKS = set(OT_IDS)
GOSP = {'MAT', 'MRK', 'LUK', 'JHN'}
R = lambda a, b: set(ORDER[IDX[a]:IDX[b] + 1])  # noqa: E731
SPK = {
    # name in text: (label, allowed books)
    'the LORD': ('God', OT_BOOKS), 'the LORD God': ('God', OT_BOOKS), 'God': ('God', OT_BOOKS),
    'Jesus': ('Jesus', GOSP), 'Peter': ('Peter', GOSP | {'ACT'}), 'Paul': ('Paul', {'ACT'}),
    'Adam': ('Adam', {'GEN'}), 'Cain': ('Cain', {'GEN'}), 'Noah': ('Noah', {'GEN'}),
    'Abram': ('Abraham', {'GEN'}), 'Abraham': ('Abraham', {'GEN'}), 'Sarai': ('Sarah', {'GEN'}), 'Sarah': ('Sarah', {'GEN'}),
    'Lot': ('Lot', {'GEN'}), 'Isaac': ('Isaac', {'GEN'}), 'Rebekah': ('Rebekah', {'GEN'}), 'Esau': ('Esau', {'GEN'}),
    'Jacob': ('Jacob', {'GEN'}), 'Israel': ('Jacob', {'GEN'}), 'Laban': ('Laban', {'GEN'}), 'Rachel': ('Rachel', {'GEN'}),
    'Leah': ('Leah', {'GEN'}), 'Reuben': ('Reuben', {'GEN'}), 'Judah': ('Judah', {'GEN'}), 'Joseph': ('Joseph', {'GEN'}),
    'Pharaoh': ('Pharaoh', {'GEN', 'EXO'}), 'Moses': ('Moses', R('EXO', 'DEU')), 'Aaron': ('Aaron', R('EXO', 'DEU')),
    'Balaam': ('Balaam', {'NUM'}), 'Balak': ('Balak', {'NUM'}), 'Joshua': ('Joshua', R('EXO', 'JOS')), 'Caleb': ('Caleb', R('NUM', 'JDG')),
    'Deborah': ('Deborah', {'JDG'}), 'Barak': ('Barak', {'JDG'}), 'Gideon': ('Gideon', {'JDG'}), 'Jephthah': ('Jephthah', {'JDG'}),
    'Manoah': ('Manoah', {'JDG'}), 'Samson': ('Samson', {'JDG'}), 'Delilah': ('Delilah', {'JDG'}),
    'Naomi': ('Naomi', {'RUT'}), 'Ruth': ('Ruth', {'RUT'}), 'Boaz': ('Boaz', {'RUT'}),
    'Hannah': ('Hannah', {'1SA'}), 'Eli': ('Eli', {'1SA'}), 'Samuel': ('Samuel', {'1SA'}), 'Saul': ('Saul', {'1SA', '2SA'}),
    'Jonathan': ('Jonathan', {'1SA', '2SA'}), 'David': ('David', {'1SA', '2SA', '1KI', '1CH'}), 'Goliath': ('Goliath', {'1SA'}),
    'Abner': ('Abner', {'1SA', '2SA'}), 'Abigail': ('Abigail', {'1SA'}), 'Achish': ('Achish', {'1SA'}),
    'Joab': ('Joab', {'2SA', '1KI', '1CH'}), 'Absalom': ('Absalom', {'2SA'}), 'Nathan': ('Nathan', {'2SA', '1KI'}),
    'Hushai': ('Hushai', {'2SA'}), 'Mephibosheth': ('Mephibosheth', {'2SA'}), 'Barzillai': ('Barzillai', {'2SA'}),
    'Bathsheba': ('Bathsheba', {'1KI'}), 'Solomon': ('Solomon', {'1KI', '2CH'}), 'Elijah': ('Elijah', {'1KI', '2KI'}),
    'Elisha': ('Elisha', {'2KI'}), 'Ahab': ('Ahab', {'1KI'}), 'Jehoshaphat': ('Jehoshaphat', {'1KI', '2KI', '2CH'}),
    'Micaiah': ('Micaiah', {'1KI', '2CH'}), 'Jezebel': ('Jezebel', {'1KI', '2KI'}), 'Naboth': ('Naboth', {'1KI'}),
    'Jehu': ('Jehu', {'2KI'}), 'Hezekiah': ('Hezekiah', {'2KI', '2CH', 'ISA'}), 'Isaiah': ('Isaiah', {'2KI', 'ISA'}),
    'Naaman': ('Naaman', {'2KI'}), 'Gehazi': ('Gehazi', {'2KI'}), 'Jeremiah': ('Jeremiah', {'JER'}),
    'Daniel': ('Daniel', {'DAN'}), 'Nebuchadnezzar': ('Nebuchadnezzar', {'DAN'}), 'Esther': ('Esther', {'EST'}),
    'Haman': ('Haman', {'EST'}), 'Mordecai': ('Mordecai', {'EST'}), 'Job': ('Job', {'JOB'}), 'Jonah': ('Jonah', {'JON'}),
    'Nehemiah': ('Nehemiah', {'NEH'}), 'Ezra': ('Ezra', {'EZR'}),
    'Pilate': ('Pilate', GOSP), 'Thomas': ('Thomas', {'JHN'}), 'Martha': ('Martha', {'JHN', 'LUK'}),
    'Nicodemus': ('Nicodemus', {'JHN'}), 'Nathanael': ('Nathanael', {'JHN'}), 'Philip': ('Philip', {'JHN'}),
    'Andrew': ('Andrew', {'JHN'}), 'Zacharias': ('Zacharias', {'LUK'}), 'Elisabeth': ('Elisabeth', {'LUK'}),
    'Simeon': ('Simeon', {'LUK'}), 'Zacchaeus': ('Zacchaeus', {'LUK'}), 'Mary': ('Mary, mother of Jesus', {'LUK'}),
    'Stephen': ('Stephen', {'ACT'}), 'Festus': ('Festus', {'ACT'}), 'Agrippa': ('Agrippa', {'ACT'}), 'Felix': ('Felix', {'ACT'}),
    'Gamaliel': ('Gamaliel', {'ACT'}), 'Barnabas': ('Barnabas', {'ACT'}), 'Ananias': ('Ananias', {'ACT'}),
}
NAMES = sorted(SPK, key=len, reverse=True)
NAME_RE = '|'.join(re.escape(n) for n in NAMES)
VERB = r'(?:answered and said|answering said|said|saith|cried|spake)'
P1 = re.compile(rf"^(?:And |Then |But |So |Now )?({NAME_RE}) {VERB}(?: (?:unto|to) [^,:;]{{1,40}})?, (.+)$")
P2 = re.compile(rf"^(?:And |Then |But |So )?(?:said|saith) ({NAME_RE})(?: (?:unto|to) [^,:;]{{1,40}})?, (.+)$")
P3 = re.compile(rf"^(?:And |Then )?answered ({NAME_RE}) and said(?: (?:unto|to) [^,:;]{{1,40}})?, (.+)$")
P4 = re.compile(rf"^(?:And |Then |But |So )?({NAME_RE}) {VERB}(?: (?:unto|to) [^,:;]{{1,40}})?,$")  # quote is the next verse
NARR = re.compile(r"\b(said|saith|answered|spake|saying)\b|[.?!;:] (And|Then|So|But) (he|she|they|[A-Z][a-z]+) |his name|her name|called (his|her) name|And (he|she|they) ")
LUK_MARY = {1, 2}


def era(bid):
    i = IDX[bid]
    if bid == 'GEN':
        return 'patriarchs'
    if i <= IDX['DEU']:
        return 'exodus'
    if i <= IDX['RUT']:
        return 'judges'
    if i <= IDX['2CH']:
        return 'kings'
    if bid in GOSP:
        return 'gospels'
    if i >= IDX['ACT']:
        return 'church'
    return 'exile'


ERAS = ['patriarchs', 'exodus', 'judges', 'kings', 'exile', 'gospels', 'church']

who_raw = []  # (label, quote, ref, full verse)
seen_q = set()
for (bid, c, v, t) in ALL_VERSES:
    m = P1.match(t) or P2.match(t) or P3.match(t)
    q = None
    span = 0
    if m:
        name, q, full = m.group(1), m.group(2), t
    else:
        m = P4.match(t)
        if m:
            nxt = KJV[f'{bid}:{c}'][v] if v < len(KJV[f'{bid}:{c}']) else None
            if nxt:
                name, q, full = m.group(1), nxt.strip(), t + ' ' + nxt.strip()
                span = 1
    if not q:
        continue
    label, books = SPK[name]
    if bid not in books:
        continue
    if name == 'Mary' and c not in LUK_MARY:
        continue
    q = q.strip()
    if not q[0].isupper() or not re.search(r'[.?!]$', q):
        continue
    if NARR.search(q) or len(q) < 28 or len(q) > 175:
        continue
    if label.split(',')[0].split(' ')[0] in q or name in q:
        continue
    key = norm(q)
    if key in seen_q:
        continue
    ref = f'{bid} {c}:{v}' + (f'-{v + 1}' if span else '')
    if appears_elsewhere(q, f'{bid} {c}:{v + span}'):
        continue
    seen_q.add(key)
    who_raw.append((label, q, ref, full))

# cap the two most frequent voices so other speakers get airtime
CAPS = {'Jesus': 140, 'God': 90}
by = defaultdict(list)
for w in who_raw:
    by[w[0]].append(w)
who_auto = []
for lab, items in by.items():
    if lab in CAPS and len(items) > CAPS[lab]:
        items = rng.sample(items, CAPS[lab])
    who_auto += items
who_auto.sort(key=lambda w: (IDX[w[2].split(' ')[0]], w[2]))

# speaker -> eras (from curated + auto)
spk_eras = defaultdict(set)
for lab, quote, ref in WHO:
    spk_eras[lab].add(era(ref.split(' ')[0]))
for lab, quote, ref, full in who_auto:
    spk_eras[lab].add(era(ref.split(' ')[0]))
NEVER_WITH = {('God', 'Jesus'), ('Jesus', 'God'), ('Satan', 'The serpent'), ('The serpent', 'Satan'),
              ('Mary, mother of Jesus', 'Elisabeth'), ('God', 'The angel Gabriel')}
DIVINE = {'God', 'Jesus', 'Satan', 'The serpent', 'The angel Gabriel'}


def speaker_distractors(answer, ref, quote):
    e = era(ref.split(' ')[0])
    ei = ERAS.index(e)
    picked = []
    for radius in range(0, len(ERAS)):
        eras = {ERAS[j] for j in (ei - radius, ei + radius) if 0 <= j < len(ERAS)}
        pool = sorted(s for s, es in spk_eras.items() if es & eras and s != answer and s not in picked
                      and (answer, s) not in NEVER_WITH and s not in DIVINE
                      and s.split(',')[0].split(' ')[-1] not in quote)
        rng.shuffle(pool)
        for s in pool:
            if len(picked) < 3:
                picked.append(s)
        if len(picked) == 3:
            return picked
    return picked


who = []
for n, (lab, quote, ref) in enumerate(WHO, 1):
    body = ' '.join(verses(ref))
    if quote not in body:
        WARN.append(f'who curated {n}: quote not verbatim in {ref}: {quote}')
    o, a = mc(rng, lab, speaker_distractors(lab, ref, quote))
    who.append({'id': f'w{n}', 'q': quote[0].upper() + quote[1:], 'o': o, 'a': a, 'r': ref_label(ref), 'x': text(ref), 'k': 'famous'})
for n, (lab, quote, ref, full) in enumerate(who_auto, 1):
    if any(norm(quote) == norm(w['q']) for w in who if w['k'] == 'famous'):
        continue
    o, a = mc(rng, lab, speaker_distractors(lab, ref, quote))
    ex = full if len(full) <= 320 else full[:320].rsplit(' ', 1)[0] + '…'
    who.append({'id': f'wa{n}', 'q': quote, 'o': o, 'a': a, 'r': ref_label(ref), 'x': ex, 'k': 'more'})
for it in who:
    check_options(it, 'who')

# ================================================================= SCRAMBLE
def segment(t):
    """A memorable chunk of a verse: the whole verse if short, otherwise its first clause."""
    whole = t.rstrip('.?!')
    if 6 <= len(words(whole)) <= 13:
        return whole
    first = re.split(r'[;:]', t)[0].rstrip(',.?!')
    if 6 <= len(words(first)) <= 13:
        return first
    return None


def chips(seg):
    out = []
    for tok in seg.split():
        tok = tok.strip(",.;:?!()")
        if tok.startswith("'") or tok.endswith("'") and not tok.endswith("s'"):
            tok = tok.strip("'")
        if tok:
            out.append(tok)
    return out


scramble = []
seen_s = set()
scr_refs = famous[:]
# Round-robin through devotional books so the extra pool is varied, keeping only verses that
# speak of God / faith (skips obscure narrative or proverbs about sluggards and strange women).
GOODWORD = re.compile(r"\b(LORD|God|Lord|Christ|Jesus|love|loveth|faith|grace|mercy|wisdom|righteous|righteousness|peace|joy|hope|praise|salvation|truth|light|Spirit|blessed|Blessed|trust|heart)\b")
BADWORD = re.compile(r"\b(saith|saying|said|Moreover|consume|hate|hateth|destroy|wrath|curse|cursed|slay|abomination)\b")
streams = []
for bid in ['PSA', 'PRO', 'ISA', 'JHN', 'MAT', 'ROM', 'ECC', '1JN', 'JAS', 'EPH', 'PHP', 'HEB', 'LUK', 'COL', 'GAL', '1PE', '1CO', '2CO', 'JOS', '2TI', 'MRK']:
    refs = []
    for c in range(1, BOOK[bid]['chapters'] + 1):
        for v in range(1, len(KJV[f'{bid}:{c}']) + 1):
            refs.append(f'{bid} {c}:{v}')
    streams.append(refs)
while any(streams):
    for st in streams:
        if st:
            scr_refs.append(st.pop(0))
for r in scr_refs:
    t = verses(r)[0]
    if '[' in t:
        continue
    seg = segment(t)
    if not seg or seg.startswith(('And ', 'But ', 'Then ', 'So ', 'Now ', 'Therefore ', 'Wherefore ')) and r not in famous:
        continue
    if r not in famous and (not GOODWORD.search(seg) or BADWORD.search(seg) or re.match(r'PRO [5-7]:', r)):
        continue
    w = chips(seg)
    if len(w) < 6 or len(set(x.lower() for x in w)) < 5 or norm(seg) in seen_s:
        continue
    seen_s.add(norm(seg))
    bid, c, v, _ = parse_ref(r)
    scramble.append({'id': f's-{bid}{c}.{v}', 'r': ref_label(r), 'w': w, 'x': t, 'k': 'famous' if r in famous else 'more'})
    if len(scramble) >= 560:
        break

# ================================================================= CHRONOLOGY
chron = []
EV = [dict(l=l, r=r, lo=lo, hi=hi) for (l, r, lo, hi) in EVENTS]
for e in EV:
    verses(e['r'])


def before(a, b):
    return a['hi'] < b['lo']


seen_c = set()
tries = 0
while len([c for c in chron if c['k'] == 'events']) < 330 and tries < 200000:
    tries += 1
    pick = rng.sample(EV, 4)
    ok = all(before(a, b) or before(b, a) for i, a in enumerate(pick) for b in pick[i + 1:])
    if not ok:
        continue
    order = sorted(pick, key=lambda e: e['lo'])
    span = order[-1]['lo'] - order[0]['lo']
    if span > 70 and rng.random() < 0.6:  # prefer sets from the same era; they are more interesting
        continue
    mode = 'first' if rng.random() < 0.6 else 'last'
    key = (mode, tuple(sorted(e['l'] for e in pick)))
    if key in seen_c:
        continue
    seen_c.add(key)
    ans = order[0] if mode == 'first' else order[-1]
    o, a = mc(rng, ans['l'], [e['l'] for e in pick if e is not ans])
    x = 'In order: ' + ' → '.join(f"{e['l']} ({ref_label(e['r'])})" for e in order)
    chron.append({'id': f'ce{len(seen_c)}', 'q': f'Which of these happened {mode.upper()}?', 'o': o, 'a': a,
                  'r': ref_label(ans['r']), 'x': x, 'k': 'events'})

for i, bid in enumerate(ORDER):
    if i + 1 < len(ORDER):
        ans = ORDER[i + 1]
        pool = [ORDER[j] for j in (i + 2, i + 3, i - 1, i + 4, i - 2, i + 5, i - 3) if 0 <= j < 66 and j != i and j != i + 1][:3]
        o, a = mc(rng, bname(ans), [bname(b) for b in pool])
        chron.append({'id': f'cn-{bid}', 'q': f'Which book comes right after {bname(bid)}?', 'o': o, 'a': a, 'r': f'{bname(bid)} → {bname(ans)}',
                      'x': ' → '.join(bname(ORDER[j]) for j in range(max(0, i - 1), min(66, i + 3))), 'k': 'books'})
    if i > 0:
        ans = ORDER[i - 1]
        pool = [ORDER[j] for j in (i - 2, i - 3, i + 1, i - 4, i + 2, i + 3, i - 5) if 0 <= j < 66 and j != i and j != i - 1][:3]
        o, a = mc(rng, bname(ans), [bname(b) for b in pool])
        chron.append({'id': f'cp-{bid}', 'q': f'Which book comes right before {bname(bid)}?', 'o': o, 'a': a, 'r': f'{bname(ans)} → {bname(bid)}',
                      'x': ' → '.join(bname(ORDER[j]) for j in range(max(0, i - 2), min(66, i + 2))), 'k': 'books'})
seen_b = set()
while len([c for c in chron if c['id'].startswith('cf')]) < 90:
    pick = sorted(rng.sample(range(66), 4))
    if pick[-1] - pick[0] > 20 or tuple(pick) in seen_b:
        continue
    seen_b.add(tuple(pick))
    mode = 'first' if len(seen_b) % 2 else 'last'
    ans = ORDER[pick[0]] if mode == 'first' else ORDER[pick[-1]]
    o, a = mc(rng, bname(ans), [bname(ORDER[j]) for j in pick if ORDER[j] != ans])
    chron.append({'id': f'cf{len(seen_b)}', 'q': f'Which of these books comes {mode.upper()} in the Bible?', 'o': o, 'a': a,
                  'r': 'Order of the books', 'x': 'In order: ' + ' → '.join(bname(ORDER[j]) for j in pick), 'k': 'books'})
for it in chron:
    check_options(it, 'chron')

# ================================================================= write
def dump(name, items):
    p = os.path.join(OUT, name)
    with open(p, 'w') as f:
        json.dump(items, f, ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(p)


sizes = {n: dump(n + '.json', it) for n, it in [('trivia', trivia), ('who', who), ('scramble', scramble), ('chronology', chron)]}
kinds = lambda xs: dict(sorted(((k, sum(1 for x in xs if x['k'] == k)) for k in {x['k'] for x in xs})))  # noqa: E731
print('trivia', len(trivia), kinds(trivia), sizes['trivia'])
print('who', len(who), kinds(who), sizes['who'])
print('scramble', len(scramble), kinds(scramble), sizes['scramble'])
print('chronology', len(chron), kinds(chron), sizes['chronology'])
print('total bytes', sum(sizes.values()))
for w in WARN:
    print('WARN', w)
