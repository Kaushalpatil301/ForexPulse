# ForexPulse · Real-Time Forex Data Aggregator

> Reliable, honestly-labelled currency exchange rates aggregated across multiple free public APIs, featuring in-flight deduplication, mathematical consensus filtering, and a strategic premium upgrade path.

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg?style=flat-square)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![Architecture: Clean Monorepo](https://img.shields.io/badge/Architecture-Unified%20Monorepo-blue.svg?style=flat-square)](docs/architecture.md)
[![Status: Production Ready](https://img.shields.io/badge/Status-Production%20Ready-success.svg?style=flat-square)](#)

[**Live Demo**](https://forexpulse.onrender.com) *(or deploy your own in 2 mins)* · [**API Documentation**](docs/api.md) · [**System Architecture**](docs/architecture.md) · [**Design Decisions**](decisions.md) · [**My Approach**](MY_APPROACH.md)

---

## UI Preview & Degraded States

```
┌────────────────────────────────────────────────────────────────────────┐
│  💱  ForexPulse                                      [FREE TIER] [PRO] │
├────────────────────────────────────────────────────────────────────────┤
│  Amount: [ 1,000 ]   From: [ USD ▼ ]   ⇄ Swap   To: [ EUR ▼ ] [↻ Refresh]│
│  Quick: [ 100 ] [ 500 ] [ 1,000 ⭐ ] [ 5,000 ⭐ ]  ⚡ High-Intent Mode Active │
├────────────────────────────────────────────────────────────────────────┤
│  SPOTLIGHT:  1,000 USD = 895.56 EUR  [📋 Copy]                         │
│              1 USD = 0.8956 EUR (open.er-api.com)                      │
├────────────────────────────────────────────────────────────────────────┤
│  🟢 DAILY CENTRAL BANK & MARKET RATE                                   │
│  Rates as of: 3 hours ago  ·  Last checked: 12 seconds ago             │
│  "Free-tier rates update about once a day. Upgrade for real-time."     │
├────────────────────────────────────────────────────────────────────────┤
│  CURRENCY      1 USD =        1,000 USD =      CONSENSUS     30-DAY    │
│  EUR           0.8956         895.56 EUR       Consensus     🔒 Pro    │
│  GBP           0.7469         746.95 GBP       Consensus     🔒 Pro    │
│  INR          95.0501      95,050.07 INR       Consensus     🔒 Pro    │
│  JPY         152.3400     152,340.00 JPY       ⚠️ median     🔒 Pro    │
├────────────────────────────────────────────────────────────────────────┤
│  ⚡ Moving > $1,000? Live interbank spreads fluctuate by up to 1.2%.   │
│     Unlock real-time streaming rates with Pro for $9/mo.               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## The Problem
Free public forex APIs publish once daily, suffer from strict rate limits, and experience intermittent outages. When free users see raw `"Unable to fetch rates"` 500 errors or unexplained 30–60 minute lag behind Google, they lose trust and bounce immediately. In fintech, **trust is the prerequisite for conversion**. If the free tier feels broken, free-to-paid conversion stagnates (stuck at 2% vs. 5% industry benchmark) and generates dozens of support tickets each week.

---

## Key Features
- **Zero-Downtime Multi-Source Ingestion:** Queries 3+ independent APIs (`open.er-api.com`, `fawazahmed0/jsDelivr`, `frankfurter.dev`, plus optional hourly `Open Exchange Rates`) concurrently via `Promise.allSettled()` with strict 3-second timeouts.
- **Mathematical Consensus & Outlier Detection:** Evaluates peer median across responding feeds; if any single provider diverges by $>2\%$, it is automatically rejected in favor of the median consensus and flagged (`⚠️ median`).
- **In-Flight Request Deduplication:** Prevents the "thundering herd" problem—collapses 1,000 simultaneous user requests for the same currency into a single upstream fetch cycle.
- **5-Minute Cache & Cold-Start Warmup:** Memory-cached for 300 seconds; automatically pre-warms top currencies (`USD`, `EUR`, `GBP`) on server boot so the first user gets a <5ms response.
- **Dual Timestamp Transparency:** Honestly displays both **"Rates as of"** (market fixing time) and **"Last checked"** (our verification time), completely defusing "stale rate" support tickets.
- **Strategic High-Intent Budget Guard:** Uses Finance's approved $5/day (~5,000 calls at $0.001/call) strictly on high-intent moments (conversions $\ge \$1,000$ or manual refreshes) with a 10 call/day per-client limit and fail-open resilience.
- **Tab-Visibility Aware:** Automatically pauses polling when the browser tab is minimized or hidden, resuming with an immediate check upon return.

---

## Ideal Use Cases
- **B2B SaaS Invoicing & Billing:** Embed reliable currency conversion into invoices without expensive Bloomberg/Refinitiv licenses.
- **Cross-Border Freelance Platforms:** Display transparent reference rates for international payouts with built-in audit trails.
- **Travel Budgeting Apps:** Provide offline-resilient, last-known-good conversion tables for travelers navigating patchy connectivity.
- **E-Commerce Currency Switchers:** Display localized indicative prices without introducing third-party latency into checkout funnels.

---

## How It Works (Architecture)

```
                            ┌──────────────────────────────────────────────┐
                            │             React Frontend (Vite)            │
                            │  - Dual Timestamps ("As of" & "Last checked")│
                            │  - Interactive Single-Pair Swap & Presets    │
                            │  - Tab-Visibility Pausing Polling Listener   │
                            └──────────────────────┬───────────────────────┘
                                                   │ HTTP /api/rates
                                                   ▼
                            ┌──────────────────────────────────────────────┐
                            │          Node.js Express API Server          │
                            │  - Whitelist Input Guard (20 Fiat Currencies)│
                            │  - In-Flight Promise Deduplication           │
                            │  - 5-Min Memory Cache + Boot-Time Pre-Warmup │
                            │  - High-Intent $5/Day Budget Router          │
                            └───────┬──────────────┬──────────────┬────────┘
                                    │              │              │
                 ┌──────────────────┴──┐    ┌──────┴──────┐    ┌──┴──────────────────┐
                 │   open.er-api.com   │    │ jsDelivr CDN│    │   Frankfurter (ECB) │
                 │   (Exact Unix ms)   │    │ (High Uptime│    │ (Official Baseline) │
                 └─────────────────────┘    └─────────────┘    └─────────────────────┘
```

### Fallback Ladder
1. **Fresh Memory Cache (<5 min):** Returned in <5ms.
2. **Live Multi-Source Parallel Query:** Merged using freshest timestamps and median outlier validation.
3. **Last-Known-Good Cache:** If all upstream feeds fail, returns previously cached data with an explicit amber alert banner.
4. **Structured 503 Guard:** In the rare event of a cold reboot during a total global outage, returns a clean retryable JSON error with an actionable "Retry" button. Never an unhandled exception or white screen.

---

## Initial Thought Process (Product Lens)

> *Authored for product evaluation. See [MY_APPROACH.md](MY_APPROACH.md) for full pre-implementation analysis.*

When free users complain that rates are "30–60 minutes behind Google", the root cause isn't that they need high-frequency trading latency. Free public feeds (ECB, open.er-api, jsDelivr) update **once daily** at official fixing hours. Trying to match Google with free daily APIs is architecturally impossible.

Instead, the product solution is **transparency and trust**:
1. **Never show an error:** Fall back to consensus and cached last-known-good rates so the app never fails.
2. **Reframe staleness into the upgrade pitch:** By clearly explaining that free rates represent official daily central bank fixing snapshots, staleness becomes the natural reason to upgrade to the $9/mo Pro tier for sub-second interbank streaming.
3. **Targeted budget spend:** Spending $5/day on window-shoppers converts nobody. Directing premium calls to high-value conversions ($\ge \$1,000$) delivers the "aha!" moment right when financial intent is highest.

---

## API Quick Reference

### `GET /api/rates`

#### Parameters
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `base` | `string` | `USD` | 3-letter ISO-4217 currency. Validated against whitelist (`USD`, `EUR`, `GBP`, `INR`, etc.). |
| `symbols` | `string` | Top 9 fiat | Comma-separated target currencies (e.g. `EUR,GBP,INR,JPY`). |
| `intent` | `string` | `normal` | Set to `high` for large amounts or manual refreshes to trigger premium budget routing. |

#### Example Response (`200 OK`)
```json
{
  "base": "USD",
  "rates": {
    "EUR": { "rate": 0.8956, "source": "open.er-api.com", "asOf": 1793491351000, "disputed": false },
    "GBP": { "rate": 0.7469, "source": "open.er-api.com", "asOf": 1793491351000, "disputed": false },
    "INR": { "rate": 95.0501, "source": "open.er-api.com", "asOf": 1793491351000, "disputed": false }
  },
  "meta": {
    "status": "fresh",
    "freshnessLabel": "Daily Central Bank & Market Rate",
    "degraded": false,
    "message": "Free-tier rates update about once a day. Upgrade for real-time.",
    "asOf": 1793491351000,
    "asOfFormatted": "Sun, 01 Nov 2026 00:02:31 GMT",
    "ageSeconds": 330,
    "lastCheckedAt": 1793524666311,
    "lastCheckedSeconds": 2,
    "servedFromCache": true,
    "premiumUsed": false,
    "sourcesOk": [ "open.er-api.com", "fawazahmed0/currency-api", "frankfurter (ECB)" ]
  }
}
```

*For comprehensive API documentation and error code specifications, see [`docs/api.md`](docs/api.md).*

---

## Quick Start (Run Locally)

### Prerequisites
- Node.js 18+ (tested on Node 20 & 24)
- npm 9+

```bash
# 1. Clone the repository
git clone https://github.com/Kaushalpatil301/ForexPulse.git
cd ForexPulse

# 2. Install all dependencies (frontend + backend)
npm run install:all

# 3. Start local development (in separate terminals)
npm run dev:backend     # Runs Express API on http://localhost:3001
npm run dev:frontend    # Runs React Vite UI on http://localhost:5173 (proxies /api)
```

### Production Single-Command Run
```bash
npm run build           # Builds frontend to frontend/dist
npm start               # Serves unified API + UI from http://localhost:3001
```

---

## Deploy to Cloud in 2 Minutes

### 1-Click Deployment via Render Blueprint
This repository includes a [`render.yaml`](render.yaml) configuration.
1. Fork or push this repository to your GitHub account.
2. In [Render Dashboard](https://dashboard.render.com/), click **New → Blueprint**.
3. Select this repository. Render automatically reads build and start commands:
   - **Build Command:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
   - **Start Command:** `node backend/server.js`
4. Click **Deploy**. Your live service will be online at a free HTTPS URL.

*(Also compatible with Railway, Fly.io, or Heroku without modification.)*

---

## Design Decisions & Tradeoffs

| Question | Decision | Tradeoff / Reasoning |
| :--- | :--- | :--- |
| **Why these 3 APIs?** | `open.er-api` (Unix timestamp), `jsDelivr` (CDN reliability), `frankfurter` (ECB baseline). | Three independent architectures mean zero single points of failure. |
| **How to handle conflicting data?** | Sort by freshest timestamp, test against peer median; override if deviation $> 2\%$. | Discards rogue/inverted data automatically without requiring manual intervention. |
| **Container vs. Serverless?** | Containerized Node.js (Render/Railway) over Serverless (Vercel/Lambda). | Serverless cold starts defeat in-memory caching and in-flight request deduplication. |
| **What was deliberately cut?** | Auth, DB persistence, Redis, full D3 charting suite. | Keeps bundle under 155KB, enables zero-config deployment, and protects shipping speed. |

*For deep dive analysis, see [`decisions.md`](decisions.md).*

---

## Roadmap
- [ ] **Distributed Cache:** Redis backing for horizontal scaling across multi-region Kubernetes clusters.
- [ ] **Automated Circuit Breaker:** Implement `opossum` to trip failing upstream feeds offline after 3 consecutive timeouts.
- [ ] **Stale-While-Revalidate Worker:** Background cron worker refreshing top currency pairs 30 seconds prior to cache TTL expiration.
- [ ] **Stripe Pro Subscriptions:** Automated webhook fulfillment for the $9/month Pro tier.
- [ ] **Push Rate Alerts:** Webhook and SMS delivery for currency volatility threshold triggers.

---

## Author & Contact

**Kaushal Patil**  
Full-Stack & Fintech Software Engineer  
- **GitHub:** [@Kaushalpatil301](https://github.com/Kaushalpatil301)  
- **LinkedIn:** [linkedin.com/in/kaushalpatil301](https://www.linkedin.com/in/kaushalpatil301/) *(update with your link)*  
- **Email:** `kaushalpatil@example.com` *(update with your email)*  

*💼 **Open to Work & Consulting:** Available for freelance contracts, full-stack API development, and fintech infrastructure roles.*

---

## License & Attribution
Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.  
Exchange rates aggregated with attribution to [Exchange Rate API](https://www.exchangerate-api.com).
