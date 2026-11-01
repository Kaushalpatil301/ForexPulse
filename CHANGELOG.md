# Changelog

All notable changes to the ForexPulse service are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.2.0] - 2026-11-01

### Added
- **FP-01**: Explicit prioritization of validated premium rates in consensus engine.
- **FP-02**: Robust outlier detection utilizing Median and Median Absolute Deviation (MAD) with modified Z-scores.
- **FP-03 & FP-04**: Persistent atomic quota store (`quotaStore.js`) protecting against server restart resets.
- **FP-08 & FP-12**: Comprehensive Zod runtime schema validation for all upstream providers and premium responses.
- **FP-10**: Correct quota accounting: budget committed strictly *after* successful validated upstream response.
- **FP-13**: Per-provider Circuit Breakers (`CircuitBreaker`) tripping offline after 3 consecutive failures.
- **FP-14**: Controlled retries with exponential backoff on transient network timeouts.
- **FP-15**: Stale-While-Revalidate (SWR) cache strategy with Last-Known-Good fallback.
- **FP-16**: IP-based sliding window rate limiter (120 req/min).
- **FP-18 & FP-19**: Structured JSON observability logging, `/health/live`, `/health/ready`, and `/metrics` telemetry endpoints.
- **FP-21 to FP-34**: Full automated reliability test suite covering all 14 failure and consensus test cases.
- **FP-39 to FP-41**: Frontend currency search, favorites management, and recent conversion history.
- **FP-50**: GitHub Actions continuous integration pipeline across Node 18, 20, and 22.

### Fixed
- **FP-05**: Debounced amount change handler to ensure high-value conversions ($\ge \$1,000$) consistently trigger premium routing.
- **FP-06**: Accurate per-currency freshness metrics calculating both oldest, newest, and median data ages.
- **FP-07**: `AbortController` cancellation and sequence IDs preventing race conditions on rapid currency switches.
- **FP-09**: Removed mock SVG curve; replaced with an honest `🔒 Pro (10-Yr History)` indicator.
- **FP-44**: Awaited clipboard API with fallback to `document.execCommand`.

---

## [1.1.0] - 2026-11-01

### Added
- Base-currency whitelist and input guards for upstream shielding.
- Dual timestamp transparency displaying both market fixing time and server verification time.
- Cache warm-up on process boot for `USD`, `EUR`, `GBP`.
- Tab visibility listener pausing background polling while browser is minimized.
- Single-pair currency spotlight with instant `⇄ Swap` button.

---

## [1.0.0] - 2026-11-01

### Added
- Initial release with multi-source ingestion (`open.er-api.com`, `fawazahmed0/currency-api`, `frankfurter.dev`).
- In-flight request deduplication and 5-minute memory cache.
- Render 1-click blueprint deployment.

