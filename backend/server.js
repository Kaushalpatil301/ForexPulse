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

app.get('/api/rates', async (req, res) => {
  const base = String(req.query.base || 'USD').toUpperCase();
  if (!BASE_RE.test(base)) return res.status(400).json({ error: 'Invalid base currency' });
  const symbols = (req.query.symbols ? String(req.query.symbols).split(',') : DEFAULT_SYMBOLS).map((s) => s.trim().toUpperCase()).filter((s) => BASE_RE.test(s) && s !== base).slice(0, 30);
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
    const message =
      snap?.allFailed ? 'Our rate providers are unreachable. Showing the last rates we successfully fetched.'
      : status === 'stale' ? 'These rates are more than 2 days old. Treat them as indicative only.'
      : status === 'aging' ? 'Rates are a bit behind. Free rates update about once a day.'
      : degraded ? 'Some providers are down; rates were cross-checked from the remaining ones.'
      : 'Free-tier rates update about once a day. Upgrade for real-time.';

    res.json({
      base, rates,
      meta: {
        status, degraded, message,
        asOf, ageSeconds: Math.round((Date.now() - asOf) / 1000),
        fetchedAt: snap?.fetchedAt ?? Date.now(), servedFromCache: !!snap?.fromCache,
        premiumUsed: !!premium,
        sourcesOk: sources.map((s) => s.name), sourcesFailed: snap?.failed ?? [],
        premiumBudget: premiumStatus(),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Unexpected error', code: 'INTERNAL' });
  }
});

// Serve the built React app in production (single deploy).
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`FX service on :${PORT}`));
