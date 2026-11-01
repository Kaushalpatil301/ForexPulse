import { useEffect, useState, useCallback, useRef } from 'react';

const BASES = [
  'USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'SGD', 'AED',
  'NZD', 'CNY', 'HKD', 'SEK', 'NOK', 'MXN', 'BRL', 'ZAR', 'KRW', 'THB'
];

const PRESET_AMOUNTS = [100, 500, 1000, 5000];
const HIGH_INTENT_AMOUNT = 1000;

const formatAgo = (seconds) => {
  if (seconds == null || isNaN(seconds)) return 'just now';
  if (seconds < 45) return 'just now';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

const BADGE_MAP = {
  live: { label: 'Live Pro Rate', style: 'badge-live', icon: '⚡' },
  fresh: { label: 'Up to Date', style: 'badge-fresh', icon: '●' },
  aging: { label: 'Aging Reference', style: 'badge-aging', icon: '▲' },
  stale: { label: 'Outdated', style: 'badge-stale', icon: '✕' },
};

export default function App() {
  const [base, setBase] = useState('USD');
  const [target, setTarget] = useState('EUR');
  const [amount, setAmount] = useState('100');
  const [searchFilter, setSearchFilter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProModal, setShowProModal] = useState(false);
  const [proModalReason, setProModalReason] = useState('general');
  const [copiedCur, setCopiedCur] = useState(null);

  // FP-40 & FP-41: Favorites & Conversion History in LocalStorage
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem('fp_favorites');
      return saved ? JSON.parse(saved) : ['EUR', 'GBP', 'INR'];
    } catch {
      return ['EUR', 'GBP', 'INR'];
    }
  });

  const [recents, setRecents] = useState(() => {
    try {
      const saved = localStorage.getItem('fp_recents');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // FP-07: AbortController and sequence ordering to prevent race conditions
  const abortControllerRef = useRef(null);
  const requestIdRef = useRef(0);
  const lastFetchTimeRef = useRef(Date.now());

  const fetchRates = useCallback(async (intent = false) => {
    const currentReqId = ++requestIdRef.current;

    // Abort previous in-flight network request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      const query = new URLSearchParams({ base });
      if (intent) query.set('intent', 'high');

      const res = await fetch(`/api/rates?${query.toString()}`, {
        signal: controller.signal
      });

      const json = await res.json();

      // Discard stale response if a newer request was dispatched (FP-07)
      if (currentReqId !== requestIdRef.current) return;

      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      setData(json);
      setError(null);
      lastFetchTimeRef.current = Date.now();

      // Record to recent conversion history (FP-41)
      setRecents((prev) => {
        const item = `${base} → ${target}`;
        const updated = [item, ...prev.filter((i) => i !== item)].slice(0, 5);
        try { localStorage.setItem('fp_recents', JSON.stringify(updated)); } catch {}
        return updated;
      });
    } catch (err) {
      if (err.name === 'AbortError') return; // Expected cancellation
      if (currentReqId === requestIdRef.current) {
        setError(err.message);
      }
    } finally {
      if (currentReqId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [base, target]);

  // FP-05: High-value amount correctly triggers premium intent with debounce
  useEffect(() => {
    const isHighValue = Number(amount) >= HIGH_INTENT_AMOUNT;
    const timer = setTimeout(() => {
      fetchRates(isHighValue);
    }, 350);
    return () => clearTimeout(timer);
  }, [amount, base, fetchRates]);

  // Tab visibility: pause polling when hidden, resume on active
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchRates(false);
      }
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastFetchTimeRef.current > 120000) {
          fetchRates(false);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchRates]);

  const handleSwap = () => {
    if (base === target) return;
    const oldBase = base;
    const oldTarget = target;
    setBase(oldTarget);
    setTarget(oldBase);
  };

  // FP-44: Robust Clipboard Handling with graceful fallback
  const handleCopy = async (text, cur) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedCur(cur);
      setTimeout(() => setCopiedCur(null), 2000);
    } catch {
      // Graceful no-op on permission deny
    }
  };

  const toggleFavorite = (cur) => {
    setFavorites((prev) => {
      const updated = prev.includes(cur) ? prev.filter((c) => c !== cur) : [...prev, cur];
      try { localStorage.setItem('fp_favorites', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const openUpgradeModal = (reason = 'general') => {
    setProModalReason(reason);
    setShowProModal(true);
  };

  const meta = data?.meta;
  const badge = meta ? (BADGE_MAP[meta.status] || BADGE_MAP.fresh) : null;
  const numericAmount = isNaN(Number(amount)) || Number(amount) < 0 ? 0 : Number(amount);
  const targetRateObj = data?.rates?.[target];
  const targetRate = targetRateObj?.rate || 0;
  const targetConverted = (numericAmount * targetRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Filter rates table by search term and prioritize favorites
  const filteredRates = Object.entries(data?.rates || {})
    .filter(([cur]) => !searchFilter || cur.toLowerCase().includes(searchFilter.toLowerCase()))
    .sort(([a], [b]) => {
      const aFav = favorites.includes(a);
      const bFav = favorites.includes(b);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return a.localeCompare(b);
    });

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header" role="banner">
        <div className="brand">
          <div className="logo-icon" aria-hidden="true">💱</div>
          <div>
            <h1>ForexPulse</h1>
            <p className="subtitle">Resilient Currency Aggregation & Trust Engine</p>
          </div>
        </div>
        <div className="tier-tag">
          <span className="pill pill-free">Free Tier</span>
          <button
            className="btn-upgrade"
            onClick={() => openUpgradeModal('header')}
            aria-label="Upgrade to Pro plan"
          >
            Upgrade to Pro ($9/mo)
          </button>
        </div>
      </header>

      {/* Main Single-Pair Converter Card */}
      <section className="card converter-card" aria-label="Currency converter controls">
        <div className="converter-top-row">
          <div className="input-group">
            <label htmlFor="amount-input">Amount</label>
            <input
              id="amount-input"
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100"
              aria-label="Conversion amount"
            />
          </div>

          <div className="input-group">
            <label htmlFor="base-select">From</label>
            <select
              id="base-select"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              aria-label="Base currency"
            >
              {BASES.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div className="swap-group">
            <button
              type="button"
              className="btn-swap"
              onClick={handleSwap}
              title="Swap From and To currencies"
              aria-label="Swap currencies"
            >
              ⇄
            </button>
          </div>

          <div className="input-group">
            <label htmlFor="target-select">To</label>
            <select
              id="target-select"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Target currency"
            >
              {BASES.filter((b) => b !== base).map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>

          <div className="action-group">
            <button
              className="btn-refresh"
              onClick={() => fetchRates(true)}
              disabled={loading}
              title="Queries fresh data with high-intent priority"
              aria-label="Refresh rates"
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Quick Amount Presets */}
        <div className="presets-row">
          <span className="preset-label">Quick amounts:</span>
          {PRESET_AMOUNTS.map((p) => (
            <button
              key={p}
              type="button"
              className={`btn-chip ${numericAmount === p ? 'active' : ''}`}
              onClick={() => setAmount(String(p))}
            >
              {p >= 1000 ? `${p.toLocaleString()} ⭐` : p}
            </button>
          ))}
          {numericAmount >= HIGH_INTENT_AMOUNT && (
            <span className="high-intent-chip" title="Large conversions trigger premium routing">
              ⚡ High-Intent Priority Active
            </span>
          )}
        </div>

        {/* Single Pair Conversion Spotlight */}
        {targetRateObj && (
          <div className="spotlight-row" role="region" aria-label="Spotlight conversion result">
            <div className="spotlight-converted">
              <span className="spotlight-label">{numericAmount.toLocaleString()} {base} =</span>
              <span className="spotlight-value">{targetConverted} {target}</span>
              <button
                className="btn-copy-mini"
                onClick={() => handleCopy(`${targetConverted} ${target}`, target)}
                title="Copy to clipboard"
                aria-label="Copy spotlight conversion result"
              >
                {copiedCur === target ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <div className="spotlight-rate">
              1 {base} = {targetRate.toFixed(4)} {target}
              <span className="spotlight-source">({targetRateObj.source})</span>
            </div>
          </div>
        )}

        {/* Recent Pairs (FP-41) */}
        {recents.length > 0 && (
          <div className="recents-row">
            <span className="recents-label">Recent pairs:</span>
            {recents.map((pair) => {
              const [f, t] = pair.split(' → ');
              return (
                <button
                  key={pair}
                  type="button"
                  className="btn-recent-chip"
                  onClick={() => { setBase(f); setTarget(t); }}
                >
                  {pair}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Freshness, Dual Timestamps, & Trust Banner */}
      {meta && (
        <section className={`status-banner ${meta.status}`} role="status">
          <div className="banner-header">
            <span className={`status-badge ${badge.style}`}>
              <span className="badge-dot" aria-hidden="true">{badge.icon}</span> {meta.freshnessLabel || badge.label}
            </span>

            <span className="timestamp">
              <strong>Rates as of:</strong> {formatAgo(meta.ageSeconds)}
            </span>
            <span className="separator" aria-hidden="true">·</span>
            <span className="timestamp">
              <strong>Last checked:</strong> {formatAgo(meta.lastCheckedSeconds)}
            </span>

            {meta.servedFromCache && (
              <span className="cache-pill">Cached (5m TTL)</span>
            )}
            {meta.isSWR && (
              <span className="cache-pill">SWR Background Refresh</span>
            )}
            {meta.premiumUsed && (
              <span className="premium-pill">⚡ Live Rate Preview Applied</span>
            )}
          </div>
          <p className="banner-msg">{meta.message}</p>
        </section>
      )}

      {/* Contextual High-Intent Upgrade Hint */}
      {(numericAmount >= HIGH_INTENT_AMOUNT || meta?.premiumUsed) && (
        <section className="high-intent-banner" role="complementary">
          <div className="high-intent-icon" aria-hidden="true">⚡</div>
          <div className="high-intent-text">
            <strong>High-Value Conversion Detected ({numericAmount.toLocaleString()} {base})</strong>
            <p>
              {meta?.premiumUsed
                ? 'Previewing live interbank rate (1 of 10 free daily previews). Unlock unlimited real-time execution rates on Pro.'
                : 'Market spreads fluctuate by up to 1.2% during volatile hours. For live interbank streaming rates and rate drop alerts, upgrade to Pro.'}
            </p>
          </div>
          <button className="btn-intent-upgrade" onClick={() => openUpgradeModal('high_intent')}>
            Unlock Pro ($9/mo)
          </button>
        </section>
      )}

      {/* Degraded State & Error Notice */}
      {error && (
        <section className="error-banner" role="alert">
          <div className="error-header">
            <span>⚠️ Service Notice</span>
          </div>
          <p>
            {data
              ? `Temporary refresh error (${error}). Retaining last verified exchange rates.`
              : `Unable to connect to upstream rate feeds (${error}).`}
          </p>
          {!data && (
            <button className="btn-retry" onClick={() => fetchRates(false)}>
              Retry Connection
            </button>
          )}
        </section>
      )}

      {/* Comprehensive Rates Table */}
      {data?.rates && (
        <section className="card table-card" aria-label="Currency exchange rates table">
          <div className="table-header">
            <div>
              <h3>Consensus Exchange Rates</h3>
              <span className="feed-count">
                Verified across {meta.sourcesOk?.length || 1} independent source{meta.sourcesOk?.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="table-actions">
              {/* FP-39: Currency search filter */}
              <input
                type="text"
                className="input-search"
                placeholder="Search currency…"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                aria-label="Filter currencies"
              />

              <button
                className="btn-alert-stub"
                onClick={() => openUpgradeModal('rate_alerts')}
                title="Set email/SMS rate drop notifications"
              >
                🔔 Rate Alert (Pro)
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="rates-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>Fav</th>
                  <th>Currency</th>
                  <th>1 {base} =</th>
                  <th>{numericAmount.toLocaleString()} {base} =</th>
                  <th>Consensus Source</th>
                  <th>Historical</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRates.map(([cur, r]) => {
                  const convertedVal = (r.rate * numericAmount).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  });
                  const isFav = favorites.includes(cur);

                  return (
                    <tr key={cur} className={r.disputed ? 'row-disputed' : ''}>
                      <td className="fav-cell">
                        <button
                          type="button"
                          className={`btn-fav ${isFav ? 'active' : ''}`}
                          onClick={() => toggleFavorite(cur)}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                          aria-label={`Favorite ${cur}`}
                        >
                          {isFav ? '★' : '☆'}
                        </button>
                      </td>
                      <td className="currency-cell">
                        <span className="cur-code">{cur}</span>
                      </td>
                      <td className="rate-cell">
                        {r.rate.toFixed(4)}
                        {r.disputed && (
                          <span
                            className="dispute-warn"
                            title="An upstream provider deviated >2%; mathematical median consensus applied for safety"
                          >
                            ⚠️ median
                          </span>
                        )}
                      </td>
                      <td className="total-cell">
                        <strong>{convertedVal}</strong> {cur}
                      </td>
                      <td className="source-cell">
                        <span className="source-tag">{r.source}</span>
                      </td>

                      {/* FP-09: Honest locked preview indicator */}
                      <td className="sparkline-cell">
                        <div
                          className="sparkline-lock"
                          onClick={() => openUpgradeModal('historical_chart')}
                          title="10-year historical charts are available on Pro ($9/mo)"
                        >
                          <span className="lock-tag">🔒 Pro (10-Yr History)</span>
                        </div>
                      </td>

                      <td className="action-cell">
                        <button
                          className="btn-copy-table"
                          onClick={() => handleCopy(`${convertedVal} ${cur}`, cur)}
                          title="Copy amount to clipboard"
                          aria-label={`Copy converted ${cur} amount`}
                        >
                          {copiedCur === cur ? '✓' : 'Copy'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Pro Tier Conversion Banner */}
      <section className="card pro-banner">
        <div className="pro-content">
          <h4>Need sub-second live interbank streaming rates?</h4>
          <p>
            Free tier rates reflect official daily central bank fixing snapshots. For real-time tick-by-tick forex feeds, rate drop SMS alerts, and 10-year historical charts, upgrade to Pro.
          </p>
        </div>
        <button className="btn-pro-cta" onClick={() => openUpgradeModal('banner')}>
          Unlock Pro for $9/mo
        </button>
      </section>

      {/* Footer & Compliance Attributions */}
      <footer className="footer" role="contentinfo">
        <p className="attribution">
          <a
            href="https://www.exchangerate-api.com"
            target="_blank"
            rel="noreferrer"
          >
            Rates By Exchange Rate API
          </a>
          {' · '}
          <span>European Central Bank Reference Baseline</span>
          {' · '}
          <span>jsDelivr Global CDN Edge</span>
        </p>
        {meta && (
          <p className="sources-audit">
            Active feeds: <strong>{meta.sourcesOk.join(', ')}</strong>
            {meta.sourcesFailed?.length > 0 && (
              <span className="failed-sources">
                {' · '}Unavailable: {meta.sourcesFailed.map((s) => s.name).join(', ')}
              </span>
            )}
          </p>
        )}
      </footer>

      {/* Pro Upgrade Modal */}
      {showProModal && (
        <div className="modal-backdrop" onClick={() => setShowProModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <button className="btn-modal-close" onClick={() => setShowProModal(false)} aria-label="Close modal">✕</button>
            <div className="modal-badge">FOREX PRO PLAN</div>
            <h2>Unlock Real-Time Forex Pro</h2>
            <p className="modal-price"><strong>$9</strong> / month</p>
            
            {proModalReason === 'high_intent' && (
              <div className="modal-context-note">
                ⚡ <em>Recommended for high-volume transactions to guarantee live execution spreads.</em>
              </div>
            )}
            {proModalReason === 'rate_alerts' && (
              <div className="modal-context-note">
                🔔 <em>Automated rate alerts via SMS, Email, and Webhooks are included in Pro.</em>
              </div>
            )}
            {proModalReason === 'historical_chart' && (
              <div className="modal-context-note">
                📈 <em>Full 10-year interactive historical charts and trend analytics are included in Pro.</em>
              </div>
            )}

            <ul className="modal-features">
              <li>✓ Sub-second interbank live rates from Bloomberg/Reuters feeds</li>
              <li>✓ 99.99% guaranteed SLA uptime with dedicated API gateway</li>
              <li>✓ Instant WhatsApp & Email rate drop alerts</li>
              <li>✓ Full 10-year historical rate charts & CSV export</li>
              <li>✓ Zero rate-limiting for high-volume freelancers & businesses</li>
            </ul>
            <button
              className="btn-modal-submit"
              onClick={() => {
                alert('Thank you for exploring Forex Pro! In production, this redirects to Stripe Checkout.');
                setShowProModal(false);
              }}
            >
              Start 14-Day Free Trial
            </button>
            <p className="modal-subtext">Cancel anytime. No commitment.</p>
          </div>
        </div>
      )}
    </div>
  );
}
