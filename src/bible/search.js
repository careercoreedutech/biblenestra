// Full-Bible word search for the app (Search screen + Concordance "Where it appears").
//
// Searches the reader's current translation when its whole text is stored on the device
// (downloaded for offline), otherwise the bundled King James Version — and says which.
// The index for each translation is built lazily (first search) and kept in memory.
import { useEffect, useRef, useState } from 'react';
import BOOKS from '../data/books_meta.json';
import { readDownloadedText } from './loader';
import { resolveTranslationId } from './catalog';
import { buildIndexAsync, searchAsync, groupRows, compileQuery } from './searchCore';

export { groupRows, compileQuery };

const indexes = new Map(); // tr -> Promise<index>

function indexFor(tr, text) {
  if (!indexes.has(tr)) {
    const p = buildIndexAsync(text, BOOKS).catch((e) => { indexes.delete(tr); throw e; });
    indexes.set(tr, p);
  }
  return indexes.get(tr);
}

// -> { id: translation actually searched, requested, fallback: bool, index }
export async function searchSource(trId = 'KJV') {
  const requested = resolveTranslationId(trId || 'KJV');
  let text = null;
  if (requested !== 'KJV') {
    try { text = await readDownloadedText(requested); } catch (e) { text = null; }
  }
  if (text) return { id: requested, requested, fallback: false, index: await indexFor(requested, text) };
  const kjvText = await readDownloadedText('KJV');
  return { id: 'KJV', requested, fallback: requested !== 'KJV', index: await indexFor('KJV', kjvText) };
}

// React hook: debounced, cancellable, chunked search with progress.
// opts: { translation, wholeWord, phraseOnly, testament, bookId, debounce }
// -> { status: 'idle'|'searching'|'done'|'error', progress, result, index, source }
export function useBibleSearch(query, opts = {}) {
  const { translation = 'KJV', wholeWord = false, phraseOnly = false, testament = 'ALL', bookId = null, debounce = 250 } = opts;
  const [st, setSt] = useState({ status: 'idle', progress: 0, result: null, index: null, source: null });
  const run = useRef(0);
  const q = String(query || '').trim();
  useEffect(() => () => { run.current += 1; }, []); // cancel an in-flight search on unmount
  useEffect(() => {
    const id = run.current + 1;
    run.current = id;
    const cancelled = () => run.current !== id;
    if (!compileQuery(q)) { setSt((s) => ({ ...s, status: 'idle', progress: 0, result: null })); return undefined; }
    setSt((s) => ({ ...s, status: 'searching', progress: 0 }));
    const t = setTimeout(async () => {
      try {
        const src = await searchSource(translation);
        if (cancelled()) return;
        let last = 0;
        const result = await searchAsync(src.index, q, {
          wholeWord, phraseOnly, testament, bookId,
          isCancelled: cancelled,
          onProgress: (p) => { if (!cancelled() && p - last >= 0.2) { last = p; setSt((s) => ({ ...s, progress: p })); } },
        });
        if (!result || cancelled()) return;
        setSt({ status: 'done', progress: 1, result, index: src.index, source: src });
      } catch (e) {
        if (!cancelled()) setSt((s) => ({ ...s, status: 'error', progress: 0, error: e.message || 'Search failed' }));
      }
    }, debounce);
    return () => { clearTimeout(t); };
  }, [q, translation, wholeWord, phraseOnly, testament, bookId]);
  return st;
}
