// PACKAGE F — compact counts for videos and posts, X/Twitter style: 999, 1K, 1.2K, 10K, 100K, 1.2M.
// Pure JS (no React Native imports) so the backend tests can check it too. Truncates instead of rounding, so 999,999
// shows 999K and never 1000K. Strings that are already formatted (seed data such as '24.8K') pass through unchanged.
export function compactCount(n) {
  if (typeof n === 'string') return n.trim() === '' ? '0' : n;
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v < 1000) return String(v);
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [size, suffix] of units) {
    if (v >= size) {
      const tenths = Math.floor(v / (size / 10)) / 10; // e.g. 1234567 → 1.2 (M)
      if (tenths >= 100) return `${Math.floor(v / size)}${suffix}`; // 100K, 999K: no decimal past 99.9
      return `${tenths % 1 === 0 ? tenths.toFixed(0) : tenths.toFixed(1)}${suffix}`;
    }
  }
  return String(v);
}
