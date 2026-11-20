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
    category: typeof it.category === 'string' ? it.category : null, // JOBS FEEDS
    openTo: ['nigeria', 'africa', 'worldwide'].includes(it.openTo) ? it.openTo : null, // JOBS FEEDS
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
    async list({ kind, q, remote, category, africa, source, cursor, limit = PAGE_SIZE } = {}) {
      const p = [`limit=${limit}`];
      if (kind && kind !== 'all') p.push(`kind=${encodeURIComponent(kind)}`);
      if (q && q.trim()) p.push(`q=${encodeURIComponent(q.trim())}`);
      if (remote) p.push('remote=1');
      // JOBS FEEDS filters
      if (category && category !== 'all') p.push(`category=${encodeURIComponent(category)}`);
      if (africa) p.push('open=africa');
      if (source) p.push(`source=${encodeURIComponent(source)}`);
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
        categories: Array.isArray(res.categories) ? res.categories.filter((g) => g && g.id) : [], // JOBS FEEDS
        openToAfrica: Number(res.openToAfrica) || 0,
        updatedAt: res.updatedAt || null,
      };
    },
    // JOBS FEEDS: the Job & Academic Directory (51 platforms in 7 categories)
    async directory() {
      const res = (await api.request('GET', '/opportunities/directory')) || {};
      const categories = (Array.isArray(res.categories) ? res.categories : []).filter((g) => g && g.id).map((g) => ({
        id: String(g.id),
        label: cleanText(g.label) || String(g.id),
        short: cleanText(g.short) || cleanText(g.label),
        blurb: cleanText(g.blurb),
        items: (Array.isArray(g.items) ? g.items : []).filter((d) => d && d.slug && d.name && isWebUrl(d.url)).map((d) => ({
          slug: String(d.slug),
          name: cleanText(d.name),
          url: d.url.trim(),
          description: cleanText(d.description),
          live: !!d.live,
          sourceKey: d.sourceKey || null,
          listings: Number(d.listings) || 0,
        })),
      }));
      return { categories };
    },
  }), [api.online, api.request]);
}
