import { SOURCES } from './sources.js';
import { mergeSources } from './consensus.js';

export async function fetchAll(base) {
  const results = await Promise.allSettled(SOURCES.map((s) => s.fetch(base)));
  const ok = [];
  const failed = [];

  results.forEach((r, i) => {
    const sourceName = SOURCES[i].name;
    if (r.status === 'fulfilled') {
      ok.push({ name: sourceName, ...r.value });
    } else {
      failed.push({
        name: sourceName,
        error: r.reason?.message || 'Upstream provider request failed'
      });
    }
  });

  return { ok, failed };
}

export function merge(okSources, symbols) {
  return mergeSources(okSources, symbols);
}
