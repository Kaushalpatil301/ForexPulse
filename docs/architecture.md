# System Architecture & Failure Modes

This document details the internal resilience mechanisms, concurrency safeguards, and consensus algorithms that power **ForexPulse**.

---

## 1. Request Lifecycle & Concurrency Shielding

When requests hit the `/api/rates` endpoint, they pass through a 4-stage resilience pipeline:

```
Incoming Request
      │
      ▼
[Stage 1: Whitelist Guard] ──(Invalid)──> 400 Bad Request
      │
      ▼
[Stage 2: 5-Minute Memory Cache Hit?] ──(Hit < 300s)──> Return Cached (<5ms)
      │
      ▼
[Stage 3: In-Flight Deduplication] 
      ├── Promise already running for base? ──(Yes)──> Await existing Promise
      └── New Promise created and stored in inflight Map
            │
            ▼
      [Parallel Query via Promise.allSettled]
            ├── open.er-api.com (timeout: 3000ms)
            ├── jsDelivr CDN / fawazahmed0 (timeout: 3000ms)
            ├── frankfurter.dev ECB (timeout: 3000ms)
            └── Open Exchange Rates (optional hourly, timeout: 3000ms)
            │
            ▼
[Stage 4: Mathematical Consensus & Outlier Filter]
      │
      ▼
Update In-Memory Cache (TTL: 300s) & Resolve In-Flight Requests
```

---

## 2. Mathematical Consensus & Anomaly Detection

Public rates occasionally suffer from inverted ratios or temporary upstream bugs. To eliminate single-point-of-failure corruption without manual intervention:

1. **Timestamp Sorting:** All successful provider responses are collected. For each currency pair, rates are sorted by timestamp:
   $$\text{Primary} = \arg\max_{s} (\text{asOf}_s)$$
2. **Peer Median Calculation:** The median of all remaining peer rates is calculated:
   $$M = \text{median}(\text{rest})$$
3. **Outlier Thresholding ($>2\%$ Rule):**
   $$\text{Deviation} = \frac{|\text{Rate}_{\text{primary}} - M|}{M}$$
   - **Deviation $\le 0.02$:** Primary rate accepted as verified consensus.
   - **Deviation $> 0.02$:** Primary rate rejected as anomalous. Overridden with $\text{median}(\text{all rates})$, flagged with `disputed: true`, and annotated in the UI with a `⚠️ median` badge.

---

## 3. Comprehensive Degraded State Matrix

| Scenario | Upstream Status | Cache Status | User Experience | HTTP Status |
| :--- | :--- | :--- | :--- | :--- |
| **Normal State** | 3/3 Healthy | Warm (<5m) or Fresh Fetch | 🟢 `Up to date` badge, dual timestamps, instant load. | `200 OK` |
| **Single Source Outage** | 1 failed, 2 healthy | Resolved live | 🟢 Clean rates shown. Footer quietly logs: `Active: 2/3 (frankfurter unavailable)`. | `200 OK` |
| **Corrupted Upstream Feed** | 1 rogue ($>2\%$ off) | Resolved live | 🟢 Consensus rate shown with subtle `⚠️ median` indicator. Zero errors. | `200 OK` |
| **Total Cloud/Network Outage** | 3/3 Unreachable | Cache available (>5m old) | 🟡 **Last-Known-Good Served.** Amber banner explains: *"Providers temporarily unreachable. Showing verified rates from 14 mins ago."* | `200 OK` (degraded) |
| **Cold Boot Total Outage** | 3/3 Unreachable | Cache empty | 🔴 Branded error card with an actionable **"Retry Connection"** button. | `503 Service Unavailable` |

