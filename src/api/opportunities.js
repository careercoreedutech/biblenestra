// OPPORTUNITIES — external listings (jobs, scholarships, grants, hackathons…) imported by the Worker from
// outside sources. Read-only; online mode only. Every listing links back to its original site.
//   GET /opportunities?kind=&q=&remote=1&cursor=&limit=20 → { items, cursor, hasMore }
//   GET /opportunities/summary                           → { kinds, sources, updatedAt }
import { useMemo } from 'react';
import { useApi } from './auth';

export const PAGE_SIZE = 20;

/** Plain-text excerpt: strips any stray HTML tags/entities a source may leak through. */
export function cleanText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, '\'')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Only ever open real web links (never javascript:, data:, intent: …). */
export const isWebUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

function normalizeItem(it) {
  if (!it || !it.id) return null;
  return {
    id: String(it.id),
    kind: it.kind || 'other',
    title: cleanText(it.title) || 'Untitled opportunity',
    org: cleanText(it.org) || '',
    location: cleanText(it.location) || '',
    remote: !!it.remote,
    url: isWebUrl(it.url) ? it.url.trim() : null,
    excerpt: cleanText(it.excerpt),
    tags: Array.isArray(it.tags) ? it.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 12) : [],
    deadline: it.deadline || null,
    postedAt: it.postedAt || null,
    salary: it.salary ? cleanText(it.salary) : null,
    source: {
      key: (it.source && it.source.key) || 'source',
      name: cleanText(it.source && it.source.name) || 'the original site',
      url: it.source && isWebUrl(it.source.url) ? it.source.url.trim() : null,
    },
  };
}

export function useOpportunitiesApi() {
  const api = useApi();
  return useMemo(() => ({
    online: !!api.online,
    async list({ kind, q, remote, cursor, limit = PAGE_SIZE } = {}) {
      const p = [`limit=${limit}`];
      if (kind && kind !== 'all') p.push(`kind=${encodeURIComponent(kind)}`);
      if (q && q.trim()) p.push(`q=${encodeURIComponent(q.trim())}`);
      if (remote) p.push('remote=1');
      if (cursor) p.push(`cursor=${encodeURIComponent(cursor)}`);
      const res = (await api.request('GET', `/opportunities?${p.join('&')}`)) || {};
      const items = (Array.isArray(res.items) ? res.items : []).map(normalizeItem).filter(Boolean);
      return { items, cursor: res.cursor || null, hasMore: !!res.hasMore && !!res.cursor };
    },
    async summary() {
      const res = (await api.request('GET', '/opportunities/summary')) || {};
      return {
        kinds: Array.isArray(res.kinds) ? res.kinds.filter((k) => k && k.kind) : [],
        sources: Array.isArray(res.sources) ? res.sources.filter((s) => s && s.name) : [],
        updatedAt: res.updatedAt || null,
      };
    },
  }), [api.online, api.request]);
}
