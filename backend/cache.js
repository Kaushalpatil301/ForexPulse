// FP-15: Advanced Cache Layer with Stale-While-Revalidate (SWR), Concurrency Deduplication & Last-Known-Good Fallback

export class ForexCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 5 * 60 * 1000; // 5 min TTL
    this.swrMs = options.swrMs || 3 * 60 * 1000; // 3 min fresh window (after which SWR kicks in)
    this.cache = new Map(); // base -> { ok, failed, fetchedAt }
    this.inflight = new Map(); // base -> Promise
    this.stats = {
      hits: 0,
      misses: 0,
      dedupes: 0,
      swrRefreshes: 0
    };
  }

  async get(base, fetchAllFn) {
    const hit = this.cache.get(base);
    const now = Date.now();

    // 1. Fresh cache hit (< 3 min)
    if (hit && now - hit.fetchedAt < this.swrMs) {
      this.stats.hits++;
      return { ...hit, fromCache: true, isStale: false };
    }

    // 2. Stale-While-Revalidate window (3 to 5 min)
    if (hit && now - hit.fetchedAt < this.ttlMs) {
      this.stats.hits++;
      this.stats.swrRefreshes++;
      // Return cached data immediately, refresh in background
      this.triggerBackgroundRefresh(base, fetchAllFn);
      return { ...hit, fromCache: true, isStale: false, isSWR: true };
    }

    // 3. Cache expired or cold start -> Fetch with in-flight deduplication (FP-28)
    this.stats.misses++;
    if (!this.inflight.has(base)) {
      const promise = fetchAllFn(base)
        .then((result) => {
          if (result.ok && result.ok.length > 0) {
            this.cache.set(base, { ...result, fetchedAt: Date.now() });
          }
          return result;
        })
        .finally(() => {
          this.inflight.delete(base);
        });
      this.inflight.set(base, promise);
    } else {
      this.stats.dedupes++;
    }

    const liveResult = await this.inflight.get(base);

    // 4. If live fetch succeeded, return it
    if (liveResult.ok && liveResult.ok.length > 0) {
      return { ...this.cache.get(base), fromCache: false, isStale: false };
    }

    // 5. If live fetch failed completely, return Last-Known-Good from cache
    if (hit) {
      return { ...hit, fromCache: true, allFailed: true, isStale: true };
    }

    // 6. No cached data and all providers failed (Cold start total outage)
    return null;
  }

  triggerBackgroundRefresh(base, fetchAllFn) {
    if (this.inflight.has(base)) return;
    const promise = fetchAllFn(base)
      .then((result) => {
        if (result.ok && result.ok.length > 0) {
          this.cache.set(base, { ...result, fetchedAt: Date.now() });
        }
      })
      .catch(() => {})
      .finally(() => {
        this.inflight.delete(base);
      });
    this.inflight.set(base, promise);
  }

  set(base, data) {
    this.cache.set(base, { fetchedAt: Date.now(), ...data });
  }

  clear() {
    this.cache.clear();
    this.inflight.clear();
  }

  getStats() {
    return {
      cachedKeys: Array.from(this.cache.keys()),
      ...this.stats
    };
  }
}

export const defaultForexCache = new ForexCache();
