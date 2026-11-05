// Full-Bible word search — pure JS (no React / RN imports) so it can be unit-tested in Node.
//
// • buildIndexAsync() flattens a { 'GEN:1': [verse, …] } text map into parallel arrays in canonical
//   book order and lower-cases every verse once (lazily, the first time someone searches).
// • searchAsync() scans the index in slices and yields to the event loop between slices, so a search
//   over all 31,102 verses never blocks the UI thread for long; it reports progress and can be
//   cancelled when the query changes.
// • There is no result cap: every matching verse is returned (as compact verse indexes).

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export async function buildIndexAsync(textMap, books, { slice = 6000, isCancelled = () => false } = {}) {
  const bookIdx = [];
  const chapter = [];
  const verse = [];
  const text = [];
  let done = 0;
  for (let b = 0; b < books.length; b += 1) {
    const bk = books[b];
    for (let c = 1; c <= bk.chapters; c += 1) {
      const vs = textMap[`${bk.id}:${c}`];
      if (!vs) continue;
      for (let v = 0; v < vs.length; v += 1) {
        if (!vs[v]) continue;
        bookIdx.push(b); chapter.push(c); verse.push(v + 1); text.push(vs[v]);
      }
    }
  }
  const lower = new Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    lower[i] = text[i].toLowerCase().replace(/[’‘]/g, "'");
    done += 1;
    if (done % slice === 0) {
      // eslint-disable-next-line no-await-in-loop
      await yieldToUi();
      if (isCancelled()) return null;
    }
  }
  // first/last verse index of every book, for fast book-scoped searches
  const range = books.map(() => [-1, -1]);
  for (let i = 0; i < bookIdx.length; i += 1) {
    const r = range[bookIdx[i]];
    if (r[0] < 0) r[0] = i;
    r[1] = i;
  }
  return { n: text.length, bookIdx, chapter, verse, text, lower, range, books };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normaliseQuery(q) {
  return String(q || '').toLowerCase().replace(/[’‘]/g, "'").replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
}

// -> { phrase, terms, test(lower) -> 0 (no) | 1 (all words) | 2 (exact phrase), count(lower) -> occurrences of the exact phrase }
export function compileQuery(q, { wholeWord = false } = {}) {
  const phrase = normaliseQuery(q);
  if (phrase.length < 2) return null;
  const terms = Array.from(new Set(phrase.split(' ').filter(Boolean)));
  if (!wholeWord) {
    return {
      phrase,
      terms,
      test(l) {
        for (let i = 0; i < terms.length; i += 1) if (l.indexOf(terms[i]) < 0) return 0;
        return terms.length === 1 || l.indexOf(phrase) >= 0 ? 2 : 1;
      },
      count(l) {
        let n = 0;
        let at = l.indexOf(phrase);
        while (at >= 0) { n += 1; at = l.indexOf(phrase, at + phrase.length); }
        return n;
      },
    };
  }
  const B = "(?:^|[^a-z0-9'])";
  const E = "(?=$|[^a-z0-9'])";
  const termRe = terms.map((t) => new RegExp(B + esc(t) + E));
  const phraseRe = new RegExp(B + esc(phrase) + E, 'g');
  return {
    phrase,
    terms,
    test(l) {
      for (let i = 0; i < termRe.length; i += 1) if (!termRe[i].test(l)) return 0;
      phraseRe.lastIndex = 0;
      return terms.length === 1 || phraseRe.test(l) ? 2 : 1;
    },
    count(l) {
      phraseRe.lastIndex = 0;
      const m = l.match(phraseRe);
      return m ? m.length : 0;
    },
  };
}

// Search every verse. opts: { wholeWord, phraseOnly, testament: 'ALL'|'OT'|'NT', bookId, slice, onProgress(fraction), isCancelled }
// -> { ids: number[] (verse indexes, canonical order), exact: Uint8Array-like flags per id, occurrences, perBook: { [bookId]: n } }
export async function searchAsync(index, query, opts = {}) {
  const { wholeWord = false, phraseOnly = false, testament = 'ALL', bookId = null, slice = 2500, onProgress = () => {}, isCancelled = () => false } = opts;
  const cq = compileQuery(query, { wholeWord });
  const out = { ids: [], exact: [], occurrences: 0, perBook: {}, query: cq ? cq.phrase : '' };
  if (!cq || !index) return out;
  let from = 0;
  let to = index.n - 1;
  if (bookId) {
    const b = index.books.findIndex((x) => x.id === bookId);
    if (b < 0 || index.range[b][0] < 0) return out;
    [from, to] = index.range[b];
  }
  const total = Math.max(1, to - from + 1);
  const { lower, bookIdx, books } = index;
  for (let i = from; i <= to; i += 1) {
    const bk = books[bookIdx[i]];
    if (testament === 'ALL' || bk.testament === testament) {
      const r = cq.test(lower[i]);
      if (r && (r === 2 || !phraseOnly)) {
        out.ids.push(i);
        out.exact.push(r === 2 ? 1 : 0);
        out.occurrences += cq.count(lower[i]);
        out.perBook[bk.id] = (out.perBook[bk.id] || 0) + 1;
      }
    }
    if ((i - from + 1) % slice === 0) {
      onProgress((i - from + 1) / total);
      // eslint-disable-next-line no-await-in-loop
      await yieldToUi();
      if (isCancelled()) return null;
    }
  }
  onProgress(1);
  return out;
}

// Flat rows for a grouped list: a header row before each book's first verse.
// filter: { testament, bookId } applied to an existing result (no re-search needed).
export function groupRows(index, result, { testament = 'ALL', bookId = null } = {}) {
  const rows = [];
  let count = 0;
  if (!index || !result) return { rows, count };
  let lastBook = -1;
  for (let k = 0; k < result.ids.length; k += 1) {
    const i = result.ids[k];
    const b = index.bookIdx[i];
    const bk = index.books[b];
    if (testament !== 'ALL' && bk.testament !== testament) continue;
    if (bookId && bk.id !== bookId) continue;
    if (b !== lastBook) {
      rows.push({ key: 'h' + bk.id, type: 'book', bookId: bk.id, name: bk.name, n: result.perBook[bk.id] || 0 });
      lastBook = b;
    }
    rows.push({ key: 'v' + i, type: 'verse', i, bookId: bk.id, chapter: index.chapter[i], verse: index.verse[i], text: index.text[i], exact: !!result.exact[k] });
    count += 1;
  }
  return { rows, count };
}
