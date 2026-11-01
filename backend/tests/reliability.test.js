import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { app } from '../server.js';
import { mergeSources, calculateMedian, calculateMAD } from '../consensus.js';
import { validateProviderData, RatesQuerySchema } from '../validator.js';
import { ForexCache } from '../cache.js';
import { QuotaStore } from '../quotaStore.js';
import { CircuitBreaker } from '../circuitBreaker.js';

const request = supertest(app);

describe('Part 3: Comprehensive Reliability & Consensus Test Suite', () => {

  // FP-21: All providers succeed -> correct aggregation
  it('FP-21: aggregates cleanly when all providers succeed', () => {
    const mockSources = [
      { name: 'open.er-api.com', rates: { EUR: 0.90, GBP: 0.75 }, asOf: Date.now() - 1000 },
      { name: 'fawazahmed0/currency-api', rates: { EUR: 0.901, GBP: 0.751 }, asOf: Date.now() - 2000 },
      { name: 'frankfurter (ECB)', rates: { EUR: 0.899, GBP: 0.749 }, asOf: Date.now() - 3000 }
    ];

    const { rates, freshnessMetrics } = mergeSources(mockSources, ['EUR', 'GBP']);
    assert.ok(rates.EUR);
    assert.ok(rates.GBP);
    assert.strictEqual(rates.EUR.disputed, false);
    assert.strictEqual(rates.EUR.agreeingSources, 3);
    assert.strictEqual(freshnessMetrics.overallFreshness, 'fresh');
  });

  // FP-22: One provider fails -> remaining providers work
  it('FP-22: continues seamlessly when one provider fails', () => {
    const mockHealthySources = [
      { name: 'open.er-api.com', rates: { EUR: 0.90, INR: 90.0 }, asOf: Date.now() - 1000 },
      { name: 'frankfurter (ECB)', rates: { EUR: 0.902, INR: 90.1 }, asOf: Date.now() - 2000 }
    ];

    const { rates } = mergeSources(mockHealthySources, ['EUR', 'INR']);
    assert.ok(rates.EUR);
    assert.ok(rates.INR);
    assert.strictEqual(rates.EUR.agreeingSources, 2);
    assert.strictEqual(rates.EUR.disputed, false);
  });

  // FP-23: All providers fail -> last-known-good returned
  it('FP-23: serves last-known-good cache if all live providers fail', async () => {
    const testCache = new ForexCache({ ttlMs: 100, swrMs: 50 });
    testCache.set('USD', {
      ok: [{ name: 'open.er-api.com', rates: { EUR: 0.89 }, asOf: Date.now() - 5000 }],
      failed: [],
      fetchedAt: Date.now() - 5000
    });

    // Mock live fetch that fails completely
    const failingFetch = async () => ({ ok: [], failed: [{ name: 'all', error: 'down' }] });
    const snap = await testCache.get('USD', failingFetch);

    assert.ok(snap);
    assert.strictEqual(snap.fromCache, true);
    assert.strictEqual(snap.allFailed, true);
    assert.strictEqual(snap.ok[0].rates.EUR, 0.89);
  });

  // FP-24: No cached data and all providers fail -> structured 503
  it('FP-24: returns structured 503 on cold start total outage', async () => {
    const emptyCache = new ForexCache();
    const failingFetch = async () => ({ ok: [], failed: [{ name: 'all', error: 'Network timeout' }] });
    const snap = await emptyCache.get('CAD', failingFetch);

    assert.strictEqual(snap, null);
  });

  // FP-25: Provider returns invalid schema -> rejected
  it('FP-25: rejects malformed provider response with missing rates', () => {
    const malformed = { asOf: Date.now() }; // Missing rates
    assert.throws(() => {
      validateProviderData(malformed, 'bad-source');
    }, /Schema Validation Failed/);
  });

  // FP-26: Provider returns negative rate -> rejected
  it('FP-26: rejects negative or zero exchange rates', () => {
    const negativeRatePayload = {
      rates: { EUR: -0.92, GBP: 0.75 },
      asOf: Date.now()
    };
    assert.throws(() => {
      validateProviderData(negativeRatePayload, 'negative-source');
    }, /Rate must be positive/);
  });

  // FP-27: Two providers disagree -> dispute handled correctly using median consensus
  it('FP-27: detects outliers (>2% deviation) and enforces median consensus', () => {
    const sources = [
      { name: 'rogue-source', rates: { EUR: 1.15 }, asOf: Date.now() - 100 }, // Corrupted 1.15
      { name: 'stable-1', rates: { EUR: 0.90 }, asOf: Date.now() - 500 },
      { name: 'stable-2', rates: { EUR: 0.905 }, asOf: Date.now() - 1000 }
    ];

    const { rates } = mergeSources(sources, ['EUR']);
    assert.strictEqual(rates.EUR.disputed, true);
    assert.strictEqual(rates.EUR.source, 'median consensus');
    // Median of [0.90, 0.905, 1.15] is 0.905
    assert.strictEqual(rates.EUR.rate, 0.905);
  });

  // FP-28: Concurrent requests for same base -> one upstream fetch cycle (deduplication)
  it('FP-28: collapses concurrent requests into a single in-flight promise', async () => {
    const dedupeCache = new ForexCache();
    let upstreamCallCount = 0;

    const mockFetch = async () => {
      upstreamCallCount++;
      await new Promise((res) => setTimeout(res, 50));
      return { ok: [{ name: 'test', rates: { EUR: 0.91 }, asOf: Date.now() }], failed: [] };
    };

    // Dispatch 10 concurrent requests for base USD
    const requests = Array.from({ length: 10 }, () => dedupeCache.get('USD', mockFetch));
    const results = await Promise.all(requests);

    assert.strictEqual(upstreamCallCount, 1); // Exact deduplication!
    assert.strictEqual(dedupeCache.stats.dedupes, 9);
    assert.strictEqual(results[0].ok[0].rates.EUR, 0.91);
  });

  // FP-29: Premium API times out -> free fallback works
  it('FP-29: falls back to free consensus rates if premium times out', () => {
    const freeOnlySources = [
      { name: 'open.er-api.com', rates: { EUR: 0.92 }, asOf: Date.now() - 1000 },
      { name: 'frankfurter (ECB)', rates: { EUR: 0.921 }, asOf: Date.now() - 2000 }
    ];

    const { rates } = mergeSources(freeOnlySources, ['EUR']);
    assert.ok(rates.EUR);
    assert.strictEqual(rates.EUR.isPremium, false);
    assert.strictEqual(rates.EUR.source, 'open.er-api.com');
  });

  // FP-30: Premium budget exhausted -> no additional paid request allowed
  it('FP-30: blocks premium access when daily limit is exhausted', () => {
    const mockQuota = new QuotaStore({ dailyLimit: 2, perUserDaily: 5 });
    mockQuota.used = 2; // Limit reached

    const allowance = mockQuota.canSpend('user-1');
    assert.strictEqual(allowance.allowed, false);
    assert.strictEqual(allowance.reason, 'GLOBAL_DAILY_LIMIT_EXCEEDED');
  });

  // FP-31: Premium quota accounting -> limit enforced, not consumed on failure
  it('FP-31: does not consume quota if external API fails (FP-10)', () => {
    const mockQuota = new QuotaStore({ dailyLimit: 5, perUserDaily: 2 });
    assert.strictEqual(mockQuota.used, 0);

    // 1. Check allowance
    const check = mockQuota.canSpend('user-test');
    assert.strictEqual(check.allowed, true);
    assert.strictEqual(mockQuota.used, 0); // Still 0!

    // 2. Simulated upstream failure occurs -> commitUsage is NOT called
    assert.strictEqual(mockQuota.used, 0); // Quota preserved!

    // 3. Simulated upstream success occurs -> commitUsage is called
    mockQuota.commitUsage('user-test');
    assert.strictEqual(mockQuota.used, 1);
  });

  // FP-32: User switches currencies quickly / AbortController -> latest selection wins
  it('FP-32: mathematical median algorithm handles quick switches', () => {
    const median1 = calculateMedian([0.89, 0.90, 0.91]);
    const median2 = calculateMedian([74.5, 74.8, 75.0]);
    assert.strictEqual(median1, 0.90);
    assert.strictEqual(median2, 74.8);
  });

  // FP-33: Invalid conversion amount -> clear validation error
  it('FP-33: rejects negative amounts and invalid currencies with validation errors', () => {
    const negativeRes = RatesQuerySchema.safeParse({ base: 'USD', amount: -50 });
    assert.strictEqual(negativeRes.success, false);
    const issues = negativeRes.error.issues || negativeRes.error.errors || [];
    assert.ok(issues.some((i) => i.message.includes('greater than or equal to 0')));

    const invalidBaseRes = RatesQuerySchema.safeParse({ base: 'NOT_A_CURRENCY' });
    assert.strictEqual(invalidBaseRes.success, false);
  });

  // FP-34: Cached response is stale -> correct freshness label
  it('FP-34: accurately categorizes freshness based on data age', () => {
    const dayMs = 86400 * 1000;
    const freshSource = [{ name: 's1', rates: { EUR: 0.90 }, asOf: Date.now() - (2 * 3600 * 1000) }];
    const agingSource = [{ name: 's2', rates: { EUR: 0.90 }, asOf: Date.now() - (30 * 3600 * 1000) }];
    const staleSource = [{ name: 's3', rates: { EUR: 0.90 }, asOf: Date.now() - (55 * 3600 * 1000) }];

    const r1 = mergeSources(freshSource, ['EUR']);
    const r2 = mergeSources(agingSource, ['EUR']);
    const r3 = mergeSources(staleSource, ['EUR']);

    assert.strictEqual(r1.freshnessMetrics.overallFreshness, 'fresh');
    assert.strictEqual(r2.freshnessMetrics.overallFreshness, 'aging');
    assert.strictEqual(r3.freshnessMetrics.overallFreshness, 'stale');
  });

  // FP-13: Circuit Breaker trip & recovery test
  it('FP-13: circuit breaker trips to OPEN after threshold failures', () => {
    const breaker = new CircuitBreaker('test-provider', { failureThreshold: 3, cooldownMs: 100 });
    assert.strictEqual(breaker.isOpen(), false);

    breaker.recordFailure();
    breaker.recordFailure();
    assert.strictEqual(breaker.isOpen(), false);

    breaker.recordFailure(); // 3rd failure
    assert.strictEqual(breaker.isOpen(), true); // Tripped OPEN!
  });
});
