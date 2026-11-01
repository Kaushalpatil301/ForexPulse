import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { fetchAll, merge } from './aggregate.js';
import { tryPremium, premiumStatus } from './premium.js';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS headers to support decoupled deployments (e.g. Vercel frontend + Render backend)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

const CACHE_TTL = 5 * 60 * 1000;           // serve from cache for 5 min: protects rate limits
const HOUR = 3600e3;
const DEFAULT_SYMBOLS = ['EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'AED', 'SGD'];
const BASE_RE = /^[A-Z]{3}$/;

// Base-currency whitelist to protect upstream APIs from arbitrary query abuse
const ALLOWED_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'AED', 'SGD',
  'NZD', 'CNY', 'HKD', 'SEK', 'NOK', 'MXN', 'BRL', 'ZAR', 'KRW', 'THB'
]);

const cache = new Map();     // base -> { ok, failed, fetchedAt }   (last known good)
const inflight = new Map();  // base -> Promise (dedupe concurrent refreshes)

async function getSnapshot(base) {
  const hit = cache.get(base);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL) return { ...hit, fromCache: true };
  if (!inflight.has(base)) {
    inflight.set(base, fetchAll(base).then((r) => {
      if (r.ok.length) cache.set(base, { ...r, fetchedAt: Date.now() });
      return r;
    }).finally(() => inflight.delete(base)));
  }
  const r = await inflight.get(base);
  if (r.ok.length) return { ...cache.get(base), fromCache: false };
  if (hit) return { ...hit, fromCache: true, allFailed: true }; // serve last-known-good
  return null;
}

function freshness(asOf) {
  const age = Date.now() - asOf;
  if (age <= 25 * HOUR) return 'fresh';  // free sources publish daily; this is as current as free gets
  if (age <= 49 * HOUR) return 'aging';
  return 'stale';
}

function getFreshnessLabel(status, sourcesOk, ageMs) {
  if (status === 'live') return 'Live Interbank Rate';
  if (sourcesOk.some((s) => s.includes('hourly')) && ageMs <= 2 * HOUR) return 'Hourly Market Rate';
  if (status === 'fresh') return 'Daily Central Bank & Market Rate';
  if (status === 'aging') return 'Aging Reference Rate (Weekend/Holiday)';
  return 'Outdated Reference Rate';
}

app.get('/api/rates', async (req, res) => {
  const base = String(req.query.base || 'USD').toUpperCase();
  
  // Whitelist and input guard: protect upstream endpoints from malformed or unsupported currencies
  if (!BASE_RE.test(base) || !ALLOWED_CURRENCIES.has(base)) {
    return res.status(400).json({
      error: `Unsupported or invalid base currency '${base}'. Supported: ${Array.from(ALLOWED_CURRENCIES).join(', ')}`,
      code: 'INVALID_BASE'
    });
  }

  const rawSymbols = req.query.symbols ? String(req.query.symbols).split(',') : DEFAULT_SYMBOLS;
  const symbols = rawSymbols
    .map((s) => s.trim().toUpperCase())
    .filter((s) => BASE_RE.test(s) && ALLOWED_CURRENCIES.has(s) && s !== base)
    .slice(0, 30);

  const highIntent = req.query.intent === 'high';
  const clientId = req.ip;

  try {
    // Spend premium budget only at high-intent moments (manual refresh / large conversions).
    let premium = null;
    if (highIntent) premium = await tryPremium(base, clientId);

    const snap = await getSnapshot(base);
    if (!snap && !premium) {
      return res.status(503).json({ error: 'Rates are temporarily unavailable. Please try again in a minute.', code: 'ALL_SOURCES_DOWN' });
    }

    const sources = snap ? [...snap.ok] : [];
    if (premium) sources.push({ name: 'premium', ...premium });
    const rates = merge(sources, symbols);
    const asOf = Math.max(...Object.values(rates).map((r) => r.asOf), 0);

    const degraded = !!snap && (snap.allFailed || snap.failed.length > 0);
    const status = premium ? 'live' : freshness(asOf);
    const sourceNames = sources.map((s) => s.name);
    const freshnessLabel = getFreshnessLabel(status, sourceNames, Date.now() - asOf);
    
    const message =
      snap?.allFailed ? 'Our rate providers are unreachable. Showing the last rates we successfully fetched.'
      : status === 'stale' ? 'These rates are more than 2 days old. Treat them as indicative only.'
      : status === 'aging' ? 'Rates are a bit behind (weekend/holiday lag). Free rates update about once a day.'
      : degraded ? 'Some providers are down; rates were cross-checked from the remaining ones.'
      : 'Free-tier rates update about once a day. Upgrade for real-time.';

    const lastCheckedAt = snap?.fetchedAt ?? Date.now();
    const lastCheckedSeconds = Math.round((Date.now() - lastCheckedAt) / 1000);

    res.json({
      base, rates,
      meta: {
        status,
        freshnessLabel,
        degraded,
        message,
        asOf,
        asOfFormatted: new Date(asOf).toUTCString(),
        ageSeconds: Math.round((Date.now() - asOf) / 1000),
        lastCheckedAt,
        lastCheckedSeconds,
        servedFromCache: !!snap?.fromCache,
        premiumUsed: !!premium,
        sourcesOk: sourceNames,
        sourcesFailed: snap?.failed ?? [],
        premiumBudget: premiumStatus(),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unexpected error', code: 'INTERNAL' });
  }
});

// Cache warm-up on boot: guarantees the very first visitor gets sub-10ms response without cold-start delay
async function warmupCache() {
  console.log('[Warmup] Pre-warming cache for default bases (USD, EUR, GBP)...');
  for (const b of ['USD', 'EUR', 'GBP']) {
    try {
      await getSnapshot(b);
      console.log(`[Warmup] ✓ Pre-cached rates for ${b}`);
    } catch (e) {
      console.warn(`[Warmup] Warning for ${b}:`, e.message);
    }
  }
}

// Serve the built React app in production (single deploy).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`FX service on :${PORT}`);
  warmupCache();
});
