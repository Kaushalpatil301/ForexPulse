# My Approach (Product & Engineering Analysis)

## 1. What is the real problem? (users, trust, conversion — not "API errors")
The business metrics tell a very clear story:
- 10,000 free users, 200 paid users = **2% conversion** (industry benchmark is 5%).
- **40 support tickets/week** complaining about "wrong rates" or "service down".

The engineering symptom is "upstream API rate limits, stale daily feeds, and occasional 5xx outages". But the product reality is a **breakdown of user trust at the top of the funnel**.

When a freelancer invoicing an international client or a small business settling a vendor bill sees "Unable to fetch rates" or notices a rate that diverges from Google without explanation, they don't think: *"Oh, this is an ECB 16:00 CET daily reference fixing."* They think: *"This product is broken and unreliable. I will never enter my credit card for $9/month."*

Trust is the single prerequisite for conversion. Free users will never upgrade to a paid tier if the entry-level experience feels amateur. Therefore, the goal is not to somehow magically turn free, daily-updated public APIs into sub-second Bloomberg terminals. The goal is to **guarantee 100% perceived uptime, provide total data transparency, and turn staleness into the primary upgrade hook for the paid tier**.

---

## 2. What do free users actually need vs. what they think they need?
- **What free users think they need:** "Real-time tick-by-tick exchange rates matching Google to the second."
- **What free users actually need:**
  1. **Zero dead ends:** The service must NEVER show an empty white screen or "Unable to fetch rates" error.
  2. **Context and legibility:** A user needs to know *what* they are looking at and *when* it was recorded (e.g., "Official Central Bank daily reference rate, updated 2 hours ago").
  3. **Confidence in transaction safety:** They need assurance that the number isn't a glitch from a rogue provider.
  4. **A friction-free conversion calculator:** The core job-to-be-done is calculating conversions quickly and accurately.

When rates are framed honestly—as official reference rates verified across multiple global banking sources—staleness stops being a defect. It becomes an educational bridge: *"Free rates update daily. Need live interbank tick-by-tick rates? Upgrade to Pro ($9/month)."*

---

## 3. Where would $5/day of premium calls create the most conversion value, and why?
Finance approved up to **$5/day (~5,000 calls at $0.001/call)**.
With 10,000 daily active free users, a naive broadcast strategy (fetching premium on every page load or running background polling) would exhaust all 5,000 calls before midday, squandering the budget on casual window shoppers.

To maximize ROI and free-to-paid conversion, the premium budget must be deployed strictly at **high-intent moments**:
1. **High-Value Conversions (Amount $\ge$ 1,000 in base currency):**
   A user checking $20 is a casual tourist. A user converting $2,500 or $10,000 is a freelancer or small business owner about to move real capital. They have immediate financial skin in the game. Routing their request through the premium feed gives them instant live precision at the exact moment they need it most.
2. **Explicit User Action ("Refresh Now"):**
   When a user clicks "Refresh now", they are expressing an active desire for updated data. Fulfilling this with a live rate—while labeling it *"Live premium preview applied (X of 10 daily previews)"*—creates a tangible "aha!" moment for the Pro tier.
3. **Strict Abuse Safeguards:**
   - Global daily limit of 5,000 calls (hard stop).
   - Per-user (IP/client) rate limit of 10 premium calls/day to prevent scrapers or single sessions from burning the budget.
   - Graceful fail-open: If the premium quota is exhausted or times out (>2.5s), the system seamlessly falls back to the consensus free snapshot without user friction.

---

## 4. What will I build first, and what will I deliberately NOT build?
### What I will build first:
1. **Resilient Multi-Source Aggregator:** Parallel fetch (`Promise.allSettled`) across 3 independent free APIs (`open.er-api.com`, `fawazahmed0/currency-api`, `frankfurter.dev`), with a 3-second timeout per source.
2. **In-Flight Deduplication & 5-Minute In-Memory Caching:** Collapses concurrent requests for the same base currency, shielding public rate limits and ensuring sub-10ms response times for users.
3. **Median Consensus & Outlier Detection:** If the freshest provider deviates by >2% from the median of peer providers, distrust it and use the median rate, flagging the rate with an alert indicator.
4. **Last-Known-Good Fallback:** If all external sources fail simultaneously, serve the last-known-good cached data with an explicit, reassuring degraded-state banner.
5. **Trust-First Frontend:** Clean, professional UI displaying exact data age, provider status, consensus badges, and a clear path to upgrade to Pro.

### What I will deliberately NOT build (Hard Cuts to Ship on Time):
- **User Authentication / DB Schemas:** Not needed for the free experience and adds significant complexity.
- **External Redis Cluster:** In-memory caching is fast, lightweight, and sufficient for single-instance container deployment.
- **Historical Charts / Sparklines:** Large engineering investment; better positioned as a headline feature of the $9/mo paid tier.
- **Multi-Route SPAs:** A focused single-view application minimizes bundle size and loads instantly.

---

## 5. What does the user see when things go wrong?
Graceful degradation is a core UX requirement, not an edge case:
- **Case 1: One upstream provider is down (e.g. Frankfurter returns 500):**
  The user notices zero lag or errors. The service combines the healthy feeds, renders the rates, and shows a subtle note in the status footer: *"Rates verified with 2/3 sources (frankfurter unavailable)"*.
- **Case 2: An upstream provider outputs corrupted / rogue data (>2% anomaly):**
  The median filter catches the outlier. The user receives the safe median rate, annotated with a `⚠` tooltip indicating multi-source consensus was applied.
- **Case 3: All upstream APIs are down or network is degraded:**
  The frontend continues displaying the existing rates on screen without wiping the table. A clear amber/yellow banner states: *"Our rate providers are currently unreachable. Showing rates successfully recorded 12 minutes ago."*
- **Case 4: Cold boot total outage (no cache yet):**
  A clean, branded error state with a "Retry" button. Never an unhandled JSON error, stack trace, or raw 500 white screen.

---

## 6. How will I know if this worked? (Metrics & Instrumentation)
- **Primary Business Metric:**
  - **Free-to-Paid Conversion Rate:** Measure progression from current baseline of 2.0% toward the 5.0% industry standard over 30 days.
- **Customer Experience Metric:**
  - **Support Tickets:** Reduction in "wrong rates" or "service down" tickets from 40/week down to <5/week.
- **Product Engagement Metrics:**
  - **High-Intent Upgrade Funnel:** Click-through rate on the Pro upgrade CTA following high-intent premium rate previews.
  - **7-Day Retention:** Percentage of free users returning to check rates within 7 days (measuring restored trust).
