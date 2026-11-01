# ForexPulse

A currency exchange rate service that stays up when public APIs don't, and tells users how fresh the rates are.

**Live demo:** [forexpulse-tc01.onrender.com](https://forexpulse-tc01.onrender.com) · **Decisions and tradeoffs:** [decisions.md](decisions.md) · **My approach:** [MY_APPROACH.md](MY_APPROACH.md)

![ForexPulse UI Preview](https://img.shields.io/badge/Status-Live%20%26%20Resilient-emerald?style=for-the-badge)

---

## Problem
The free tier of a forex tracker pulls from public APIs that are rate-limited, update about once a day, and sometimes go down. Users who see "Unable to fetch rates" or numbers that differ from Google lose trust and leave before ever considering the paid plan.

Free public APIs can't match real-time rates, so this project focuses on three things:
1. **The user always sees rates, never a blank screen.**
2. **Every rate is labelled with how old it is.**
3. **The limited premium API budget is spent only on high-intent moments.**

---

## Initial thought process
When looking at the low 2% conversion and 40 support tickets a week, I realized users weren't complaining because they needed millisecond trading latency—they were complaining because the app felt unreliable. Free public exchange rate APIs publish daily snapshots, so trying to match Google to the minute with free data is a losing battle. The real problem was trust: users saw blank error screens, unexplained delays, or random discrepancies, which made the product look amateur. My core goal was to make downtime impossible by querying multiple independent APIs in parallel and falling back to the last good rates if all failed. I also wanted to be completely transparent about data age, showing both when the market rate was fixed and when our server last verified it. Staleness isn't a bug you have to hide; when honestly explained as official central bank daily rates, it becomes the exact reason to upgrade to the paid tier for real-time rates. Finally, rather than wasting the $5/day premium budget on background polling, I reserved it for high-intent moments like large conversions and manual refreshes where live precision actually drives conversion.

---

## Features
- **One endpoint**, `GET /api/rates`, backed by real public APIs queried in parallel with circuit breakers and retries (FP-13, FP-14)
- **Robust outlier consensus**: Median & Median Absolute Deviation (MAD) with modified Z-score thresholds (FP-02)
- **Validated premium prioritization**: Explicit priority for validated live premium rates (FP-01)
- **5-minute cache with Stale-While-Revalidate (SWR)** and concurrent request deduplication (FP-15, FP-28)
- **Falls back to last-known-good rates** when upstream feeds fail (FP-23)
- **Freshness badge & dual timestamps** ("rates as of" vs "last checked") defusing support inquiries
- **Persistent atomic quota tracking** surviving process restarts and committing budget only on verified success (FP-03, FP-10)
- **Cache warm-up on boot** so the very first visitor gets a sub-10ms response
- **Tab visibility pause** preventing wasted polling when the browser tab is hidden
- **Single-pair converter** with an instant `⇄ Swap` button and one-click `📋 Copy`
- **15 automated reliability tests passing** covering consensus, failure states, quotas, and validation (FP-21 to FP-34)

---

## Data sources

| Source | Update frequency | Why it's used |
| :--- | :--- | :--- |
| [open.er-api.com](https://www.exchangerate-api.com/) | Daily | Gives an exact last-updated Unix timestamp |
| [fawazahmed0/currency-api](https://github.com/fawazahmed0/exchange-api) (jsDelivr CDN) | Daily | CDN-hosted, very reliable |
| [Frankfurter](https://frankfurter.dev/) (ECB rates) | Weekdays | Central bank reference rates |
| [Open Exchange Rates](https://openexchangerates.org/) *(optional)* | Hourly | Fresher data; needs a free key |

*Free rates are indicative and not suitable for trading or settlement.*

---

## How it works

```
React (Vite) ──> Express ──> Cache (5 min) ──> Public APIs (Parallel, 3s timeout)
                                        │
                                        └──> Premium API (Optional, budget-limited)
```

### When something fails the user sees:

| Situation | What happens |
| :--- | :--- |
| **One source is down** | Rates still load; the footer lists the unavailable source |
| **Rates are 25h+ old** | Amber badge with an explanation |
| **Rates are 49h+ old** | Red badge, "indicative only" |
| **All sources are down** | Last known rates stay on screen with a warning banner |
| **Down on first start with no cache** | Error message with a Retry button |

---

## API

`GET /api/rates?base=USD&symbols=EUR,INR&intent=high`

### Parameters

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `base` | `USD` | Base currency (validated against whitelist) |
| `symbols` | common currencies | Comma-separated target currencies |
| `intent` | `none` | `high` allows a premium call if budget remains |

### Example response (shortened):
```json
{
  "base": "USD",
  "rates": {
    "EUR": {
      "rate": 0.8956,
      "source": "open.er-api.com",
      "asOf": 1793491351000,
      "disputed": false
    }
  },
  "meta": {
    "status": "fresh",
    "degraded": false,
    "message": "Free-tier rates update about once a day. Upgrade for real-time.",
    "ageSeconds": 330,
    "servedFromCache": true,
    "premiumUsed": false,
    "sourcesOk": ["open.er-api.com", "fawazahmed0/currency-api", "frankfurter (ECB)"],
    "sourcesFailed": []
  }
}
```

Errors return JSON with an error message and a code (for example `ALL_SOURCES_DOWN` or `INVALID_BASE`).

---

## Run locally

Requires Node.js 18 or newer.

```bash
git clone https://github.com/Kaushalpatil301/ForexPulse.git
cd ForexPulse

# Run backend
cd backend && npm install && npm run dev       # http://localhost:3001

# Run frontend (in another terminal)
cd frontend && npm install && npm run dev      # http://localhost:5173
```

### Production build (the backend serves the built frontend):
```bash
cd frontend && npm install && npm run build
cd ../backend && npm install && npm start      # http://localhost:3001
```

---

## Environment variables

All optional.

| Variable | Purpose |
| :--- | :--- |
| `OXR_APP_ID` | Enables the hourly Open Exchange Rates source |
| `PREMIUM_API_URL` | Premium endpoint (expects `{ rates, timestamp }`) |
| `PREMIUM_API_KEY` | Key sent to the premium endpoint |
| `PREMIUM_DAILY_CALLS` | Global daily cap (default: `5000`) |
| `PREMIUM_PER_USER` | Per-user daily cap (default: `10`) |

---

## Deploy (Render)

The repo includes [`render.yaml`](render.yaml). Create a new Blueprint on Render and select this repository, or create a Web Service manually with:
- **Build Command:** `cd frontend && npm install && npm run build && cd ../backend && npm install`
- **Start Command:** `node backend/server.js`

It runs as a long-lived Node process because the cache and request sharing live in memory.

---

## What was cut
Accounts and login, payments, a database, Redis, historical charts, and tests beyond the core merge logic. Details are in [decisions.md](decisions.md).

---

## Next steps
- Redis for a shared cache and shared premium budget across instances
- Circuit breaker per source
- Background refresh before cache expiry
- Rate alerts and history as paid features

---

## Author
**Kaushal Patil** · [GitHub](https://github.com/Kaushalpatil301) · [LinkedIn](https://www.linkedin.com/in/kaushalpatil301) · kaushalpatil@example.com

---

## License and attribution
Distributed under the **MIT License**. Rates by [Exchange Rate API](https://www.exchangerate-api.com/).
