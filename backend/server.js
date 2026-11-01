import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { fetchAll, merge } from './aggregate.js';
import { tryPremium, getPremiumStatus } from './premium.js';
import { defaultForexCache } from './cache.js';
import { RatesQuerySchema, ALLOWED_CURRENCIES } from './validator.js';
import { createRateLimiter } from './rateLimiter.js';
import { PROVIDER_CIRCUIT_BREAKERS, PROVIDER_METRICS } from './sources.js';

export const app = express();
const PORT = process.env.PORT || 3001;

// FP-17: Configurable, Secure CORS
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : ['*'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// FP-16: Rate Limiting (120 req / min per IP)
app.use(createRateLimiter({ windowMs: 60000, maxRequests: 120 }));

// FP-18: Structured Request Logging & Observability
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = Math.random().toString(36).slice(2, 9);
  req.reqId = reqId;

  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      console.log(JSON.stringify({
        level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        reqId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip
      }));
    }
  });
  next();
});

// FP-19: Separated Health & Observability Endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'live', pid: process.pid, uptime: process.uptime() });
});

app.get('/health/ready', (req, res) => {
  const breakers = Object.fromEntries(
    Object.entries(PROVIDER_CIRCUIT_BREAKERS).map(([k, v]) => [k, v.getStats().state])
  );
  const allOpen = Object.values(breakers).every((state) => state === 'OPEN');
  if (allOpen) {
    return res.status(503).json({ status: 'not_ready', reason: 'ALL_PROVIDERS_TRIPPED', breakers });
  }
  res.json({ status: 'ready', breakers, cacheKeys: defaultForexCache.cache.size });
});

app.get('/metrics', (req, res) => {
  res.json({
    uptime: process.uptime(),
    cache: defaultForexCache.getStats(),
    circuitBreakers: Object.fromEntries(
      Object.entries(PROVIDER_CIRCUIT_BREAKERS).map(([k, v]) => [k, v.getStats()])
    ),
    providerMetrics: PROVIDER_METRICS,
    premium: getPremiumStatus()
  });
});

// Primary Currency Rates Endpoint
app.get('/api/rates', async (req, res) => {
  // FP-11 & FP-20: Strict Zod Input Validation & Edge Case Handling
  const queryResult = RatesQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    const rawIssues = queryResult.error.issues || queryResult.error.errors || [];
    const issues = rawIssues.map((e) => ({
      field: (e.path || []).join('.'),
      message: e.message
    }));
    return res.status(400).json({
      error: `Validation failed: ${issues.map((i) => i.message).join('; ')}`,
      code: 'INVALID_INPUT',
      details: issues,
      supportedCurrencies: ALLOWED_CURRENCIES
    });
  }

  const { base, symbols, intent, amount } = queryResult.data;
  const highIntent = intent === 'high';
  const clientId = req.ip || '127.0.0.1';

  try {
    // FP-01, FP-05, FP-10: Budgeted Premium routing for high-intent requests
    let premiumData = null;
    if (highIntent) {
      premiumData = await tryPremium(base, clientId);
    }

    // FP-15: Query multi-source cache with SWR and last-known-good
    const snap = await defaultForexCache.get(base, fetchAll);

    // If both cache/providers and premium are unavailable, return clean 503
    if (!snap && !premiumData) {
      return res.status(503).json({
        error: 'Rates are temporarily unavailable. Please try again in a minute.',
        code: 'ALL_SOURCES_DOWN'
      });
    }

    const sources = snap ? [...snap.ok] : [];
    if (premiumData) {
      sources.push(premiumData);
    }

    // FP-01 & FP-02: Robust Consensus with MAD Outlier Rejection & Premium Prioritization
    const { rates, freshnessMetrics } = merge(sources, symbols);

    // Handle conversion calculation if requested
    const converted = {};
    if (amount !== undefined && amount >= 0) {
      for (const [sym, r] of Object.entries(rates)) {
        converted[sym] = Number((r.rate * amount).toFixed(4));
      }
    }

    const degraded = Boolean(snap && (snap.allFailed || (snap.failed && snap.failed.length > 0)));
    const status = premiumData ? 'live' : freshnessMetrics.overallFreshness;
    const sourcesOk = sources.map((s) => s.name);
    const sourcesFailed = snap?.failed || [];

    const message =
      snap?.allFailed
        ? 'Our rate providers are unreachable. Showing the last rates we successfully fetched.'
        : status === 'stale'
        ? 'These rates are more than 2 days old. Treat them as indicative only.'
        : status === 'aging'
        ? 'Rates are a bit behind (weekend/holiday lag). Free rates update about once a day.'
        : degraded
        ? 'Some providers are temporarily down; rates were cross-checked from the remaining feeds.'
        : 'Free-tier rates update about once a day. Upgrade to Pro for sub-second live streaming.';

    res.json({
      base,
      amount,
      rates,
      converted,
      meta: {
        status,
        freshnessLabel:
          status === 'live'
            ? 'Live Interbank Rate'
            : sourcesOk.some((s) => s.includes('hourly'))
            ? 'Hourly Market Rate'
            : status === 'fresh'
            ? 'Daily Central Bank & Market Rate'
            : status === 'aging'
            ? 'Aging Reference Rate (Weekend/Holiday)'
            : 'Outdated Reference Rate',
        degraded,
        message,
        asOf: freshnessMetrics.newestAsOf,
        oldestAsOf: freshnessMetrics.oldestAsOf,
        medianAsOf: freshnessMetrics.medianAsOf,
        asOfFormatted: new Date(freshnessMetrics.newestAsOf).toUTCString(),
        ageSeconds: Math.max(0, Math.round((Date.now() - freshnessMetrics.newestAsOf) / 1000)),
        lastCheckedAt: snap?.fetchedAt || Date.now(),
        lastCheckedSeconds: Math.max(0, Math.round((Date.now() - (snap?.fetchedAt || Date.now())) / 1000)),
        servedFromCache: Boolean(snap?.fromCache),
        isSWR: Boolean(snap?.isSWR),
        premiumUsed: Boolean(premiumData),
        sourcesOk,
        sourcesFailed,
        premiumBudget: getPremiumStatus()
      }
    });
  } catch (err) {
    console.error('Unhandled request error:', err);
    res.status(500).json({ error: 'Unexpected server error', code: 'INTERNAL_ERROR' });
  }
});

// Cache pre-warming for default currencies on boot
export async function warmupCache() {
  const warmupBases = ['USD', 'EUR', 'GBP'];
  for (const b of warmupBases) {
    try {
      await defaultForexCache.get(b, fetchAll);
    } catch {
      // Non-fatal
    }
  }
}

// Serve production React bundle
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health') || req.path.startsWith('/metrics')) {
      return next();
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// Start server only when run directly (enables supertest to import app without binding port)
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`ForexPulse API running on :${PORT}`);
    warmupCache();
  });
}
