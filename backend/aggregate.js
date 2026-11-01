import { SOURCES } from './sources.js';

const MAX_DEVIATION = 0.02; // 2%: beyond this we distrust the freshest source
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Query all sources in parallel; failures are data, not exceptions.
export async function fetchAll(base) {
  const results = await Promise.allSettled(SOURCES.map((s) => s.fetch(base)));
  const ok = [], failed = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? ok.push({ name: SOURCES[i].name, ...r.value }) : failed.push({ name: SOURCES[i].name, error: r.reason?.message || 'failed' })));
  return { ok, failed };
}

// Conflict policy: take the freshest source's value unless it disagrees with the rest by >2%; then use the median.
export function merge(ok, symbols) {
  const out = {};
  for (const sym of symbols) {
    const vals = ok.filter((s) => typeof s.rates[sym] === 'number').map((s) => ({ source: s.name, rate: s.rates[sym], asOf: s.asOf }));
    if (!vals.length) continue;
    vals.sort((a, b) => b.asOf - a.asOf);
    const [primary, ...rest] = vals;
    let rate = primary.rate, source = primary.source, disputed = false;
    if (rest.length) {
      const m = median(rest.map((v) => v.rate));
      if (Math.abs(primary.rate - m) / m > MAX_DEVIATION) { rate = median(vals.map((v) => v.rate)); source = 'median of sources'; disputed = true; }
    }
    out[sym] = { rate, source, asOf: primary.asOf, agreeingSources: vals.length, disputed };
  }
  return out;
}
