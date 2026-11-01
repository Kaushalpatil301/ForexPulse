# Real-Time Forex Data Aggregation Service

A resilient, multi-source currency exchange rate tracking service designed for fintech users (travelers, freelancers, small businesses). Built to eliminate 5xx failures, restore user trust, and systematically boost Free-to-Paid conversions ($9/month) from 2% toward the 5% industry benchmark.

---

## Initial Thought Process (Product Lens)

### The Problem Behind the Numbers
- **Current status:** 10,000 free users, 200 paid ($9/mo), **2% conversion rate**, and **40 support tickets/week** complaining about "rates are wrong" or "service down".
- **The Core Diagnosis:** When free users see an empty screen, a 500 error, or an unexplained divergence from Google's rate, they don't blame the free tier—they assume the entire company's infrastructure is untrustworthy. Users never upgrade on an app they don't trust.
- **The PM's Hypothesis:** *"Users don't need real-time; they need to trust what they see."*
  Most free public forex feeds (ECB, open.er-api, jsDelivr) update **once daily** at official fixing times. Attempting to match Google minute-by-minute with free APIs is impossible. Instead, the strategy is:
  1. **Make downtime impossible** by fetching 3 independent sources in parallel with hard timeouts and fallback to last-known-good cache.
  2. **Make staleness honest and transparent** by showing clear timestamps, data source attribution, and consensus indicators.
  3. **Turn staleness into the upgrade pitch:** *"Free tier reflects official daily central bank fixing rates. Need live tick-by-tick streaming? Upgrade to Pro ($9/mo)."*
  4. **Deploy the $5/day budget (~5,000 calls) strategically** on high-intent moments (conversions $\ge \$1,000$ or manual refreshes) to give high-intent users a taste of the live Pro tier.

---

## Architecture Overview

```
                      ┌──────────────────────────────────────────────┐
                      │             React Frontend (Vite)            │
                      │  - Freshness Badges (Live, Fresh, Aging)     │
                      │  - Interactive Currency Converter & Presets  │
                      │  - Graceful Degraded State Banners           │
                      └──────────────────────┬───────────────────────┘
                                             │ HTTP /api/rates
                                             ▼
                      ┌──────────────────────────────────────────────┐
                      │          Node.js Express API Server          │
                      │  - In-Flight Request Deduplication           │
                      │  - 5-Minute In-Memory Cache                  │
                      │  - High-Intent $5/Day Budget Router          │
                      └───────┬──────────────┬──────────────┬────────┘
                              │              │              │
           ┌──────────────────┴──┐    ┌──────┴──────┐    ┌──┴──────────────────┐
           │   open.er-api.com   │    │ jsDelivr CDN│    │   Frankfurter (ECB) │
           │   (Exact Unix ms)   │    │ (High Uptime│    │ (Official Baseline) │
           └─────────────────────┘    └─────────────┘    └─────────────────────┘
```

### Key Technical Characteristics
1. **Parallel Multi-Source Ingestion:** Queries `open.er-api.com`, `fawazahmed0/currency-api` (jsDelivr), and `frankfurter.dev` (ECB) concurrently via `Promise.allSettled()` with 3s timeouts.
2. **In-Flight Deduplication:** Multiple concurrent requests for the same base currency share one in-flight promise, preventing thundering herd spikes.
3. **Median Outlier Detection:** Filters rogue data if an API deviates by $>2\%$ from the median of peer sources.
4. **Resilient Fallback Ladder:** Fresh Cache (5 min) $\rightarrow$ Live Multi-Source Merge $\rightarrow$ Last-Known-Good Cache $\rightarrow$ Structured 503 (cold start only).
5. **High-Intent Budget Guard:** Triggers premium API when `amount >= 1000` or on manual "Refresh now", limited to 5,000 daily global calls and 10/day per IP.

---

## Quick Start (Local Development)

### Prerequisites
- Node.js 18+ (tested on Node 20 & 24)
- npm 9+

### 1. Run Backend
```bash
cd backend
npm install
npm run dev
# Running on http://localhost:3001
```

### 2. Run Frontend
```bash
cd ../frontend
npm install
npm run dev
# Running on http://localhost:5173 (proxies /api to :3001)
```

Open `http://localhost:5173` in your browser.

---

## Production Build (Single Unified Service)

The Express backend automatically serves the built React frontend from `frontend/dist` when available:

```bash
# 1. Build the frontend
cd frontend
npm install
npm run build

# 2. Start the unified production server
cd ../backend
npm install
npm start
# Unified app running on http://localhost:3001 (or $PORT)
```

---

## Online Deployment Guide

### Deploying to Render (Recommended)
1. Fork or push this repository to GitHub.
2. Log into [Render Dashboard](https://dashboard.render.com/) and click **New → Web Service**.
3. Select your repository.
4. Configure settings:
   - **Environment:** `Node`
   - **Build Command:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - **Start Command:** `node backend/server.js`
5. *(Optional)* Add Environment Variables:
   - `PREMIUM_API_URL` (optional mock or real premium endpoint)
   - `PREMIUM_DAILY_CALLS` = `5000`
   - `OXR_APP_ID` (optional free Open Exchange Rates App ID for hourly rates)
6. Click **Deploy Web Service**.

### Deploying to Railway / Heroku
- **Buildpack:** `heroku/nodejs`
- **Root build command:** `npm run build --prefix frontend && npm install --prefix backend`
- **Start command:** `node backend/server.js`

### Deploying to Vercel
- Connect the GitHub repository.
- Vercel automatically detects the Vite frontend (`frontend/dist`).
- Backend routes can be served as serverless functions or reverse-proxied.

---

## API Specification

### `GET /api/rates`

#### Query Parameters:
- `base` (string, optional, default: `'USD'`): 3-letter currency code (e.g., `USD`, `EUR`, `GBP`).
- `symbols` (string, optional): Comma-separated list of target currencies (e.g., `EUR,GBP,INR,JPY`).
- `intent` (string, optional): Set to `'high'` for manual refreshes or high-amount conversions to request premium budget allocation.

#### Example Request:
```http
GET /api/rates?base=USD&symbols=EUR,GBP,INR&intent=high
```

#### Example Response:
```json
{
  "base": "USD",
  "rates": {
    "EUR": {
      "rate": 0.8955,
      "source": "open.er-api.com",
      "asOf": 1793491351000,
      "agreeingSources": 3,
      "disputed": false
    },
    "GBP": {
      "rate": 0.7469,
      "source": "open.er-api.com",
      "asOf": 1793491351000,
      "agreeingSources": 3,
      "disputed": false
    },
    "INR": {
      "rate": 95.0501,
      "source": "open.er-api.com",
      "asOf": 1793491351000,
      "agreeingSources": 3,
      "disputed": false
    }
  },
  "meta": {
    "status": "fresh",
    "degraded": false,
    "message": "Free-tier rates update about once a day. Upgrade for real-time.",
    "asOf": 1793491351000,
    "ageSeconds": 320,
    "fetchedAt": 1793523574793,
    "servedFromCache": false,
    "premiumUsed": false,
    "sourcesOk": [
      "open.er-api.com",
      "fawazahmed0/currency-api",
      "frankfurter (ECB)"
    ],
    "sourcesFailed": [],
    "premiumBudget": {
      "enabled": false,
      "used": 0,
      "limit": 5000
    }
  }
}
```

---

## Documentation & Decisions
- For detailed product strategy and requirements analysis, see [MY_APPROACH.md](MY_APPROACH.md).
- For in-depth architectural tradeoffs, fallback strategies, and failure modes, see [decisions.md](decisions.md).
