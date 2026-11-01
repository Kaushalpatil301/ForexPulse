import { useEffect, useState, useCallback, useRef } from 'react';

const BASES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'JPY', 'CHF', 'SGD', 'AED'];
const PRESET_AMOUNTS = [100, 500, 1000, 5000];
const HIGH_INTENT_AMOUNT = 1000; // converting a large amount = high intent -> triggers premium budget preview

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
  const [amount, setAmount] = useState(100);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProModal, setShowProModal] = useState(false);
  const [proModalReason, setProModalReason] = useState('general');
  const [copiedCur, setCopiedCur] = useState(null);
  const [highIntentTriggered, setHighIntentTriggered] = useState(false);

  const lastFetchTimeRef = useRef(Date.now());

  const fetchRates = useCallback(async (intent = false) => {
    setLoading(true);
    if (intent) setHighIntentTriggered(true);
    try {
      const query = new URLSearchParams({ base });
      if (intent) query.set('intent', 'high');
      const res = await fetch(`/api/rates?${query.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setData(json);
      setError(null);
      lastFetchTimeRef.current = Date.now();
    } catch (err) {
      setError(err.message);
      // Data remains intact to avoid showing a broken blank screen
    } finally {
      setLoading(false);
    }
  }, [base]);

  // Initial load or base currency switch (high intent if amount >= 1000)
  useEffect(() => {
    fetchRates(Number(amount) >= HIGH_INTENT_AMOUNT);
  }, [base, fetchRates]);

  // Pause polling when tab is hidden, resume when tab is active
  useEffect(() => {
    const interval = setInterval(() => {
      // Feature: pause polling when tab is hidden to save upstream bandwidth and battery
      if (document.visibilityState === 'visible') {
        fetchRates(false);
      }
    }, 60000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // If the user returns to the tab after > 2 minutes, refresh immediately
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

  // Swap base and target currencies
  const handleSwap = () => {
    if (base === target) return;
    const oldBase = base;
    const oldTarget = target;
    setBase(oldTarget);
    setTarget(oldBase);
  };

  // Copy converted amount to clipboard
  const handleCopy = (text, cur) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedCur(cur);
      setTimeout(() => setCopiedCur(null), 2000);
    }
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

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="header">
        <div className="brand">
          <div className="logo-icon">💱</div>
          <div>
            <h1>ForexPulse</h1>
            <p className="subtitle">Real-Time Currency Aggregation & Trust Engine</p>
          </div>
        </div>
        <div className="tier-tag">
          <span className="pill pill-free">Free Tier</span>
          <button className="btn-upgrade" onClick={() => openUpgradeModal('header')}>
            Upgrade to Pro ($9/mo)
          </button>
        </div>
      </header>

      {/* Main Single-Pair Converter Card with Swap */}
      <section className="card converter-card">
        <div className="converter-top-row">
          <div className="input-group">
            <label htmlFor="amount-input">Amount</label>
            <input
              id="amount-input"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="100"
            />
          </div>

          <div className="input-group">
            <label htmlFor="base-select">From</label>
            <select
              id="base-select"
              value={base}
              onChange={(e) => setBase(e.target.value)}
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
              onClick={() => setAmount(p)}
            >
              {p >= 1000 ? `${p.toLocaleString()} ⭐` : p}
            </button>
          ))}
          {numericAmount >= HIGH_INTENT_AMOUNT && (
            <span className="high-intent-chip" title="Large conversions trigger premium rate allocation">
              ⚡ High-Intent Mode Active
            </span>
          )}
        </div>

        {/* Single Pair Conversion Spotlight */}
        {targetRateObj && (
          <div className="spotlight-row">
            <div className="spotlight-converted">
              <span className="spotlight-label">{numericAmount.toLocaleString()} {base} =</span>
              <span className="spotlight-value">{targetConverted} {target}</span>
              <button
                className="btn-copy-mini"
                onClick={() => handleCopy(`${targetConverted} ${target}`, target)}
                title="Copy to clipboard"
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
      </section>

      {/* Freshness, Last Checked, & Trust Banner */}
      {meta && (
        <section className={`status-banner ${meta.status}`}>
          <div className="banner-header">
            <span className={`status-badge ${badge.style}`}>
              <span className="badge-dot">{badge.icon}</span> {meta.freshnessLabel || badge.label}
            </span>

            {/* Showing BOTH "Rates as of" and "Last checked" builds user trust */}
            <span className="timestamp">
              <strong>Rates as of:</strong> {formatAgo(meta.ageSeconds)}
            </span>
            <span className="separator">·</span>
            <span className="timestamp">
              <strong>Last checked:</strong> {formatAgo(meta.lastCheckedSeconds)}
            </span>

            {meta.servedFromCache && (
              <span className="cache-pill">Cached (5m TTL)</span>
            )}
            {meta.premiumUsed && (
              <span className="premium-pill">⚡ Live Rate Preview Applied</span>
            )}
          </div>
          <p className="banner-msg">{meta.message}</p>
        </section>
      )}

      {/* Contextual High-Intent Upgrade Hint (Shown only when amount >= 1000 or after high-intent refresh) */}
      {(numericAmount >= HIGH_INTENT_AMOUNT || meta?.premiumUsed) && (
        <section className="high-intent-banner">
          <div className="high-intent-icon">⚡</div>
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

      {/* Degraded State Notice */}
      {error && (
        <section className="error-banner">
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
        <section className="card table-card">
          <div className="table-header">
            <div>
              <h3>Consensus Exchange Rates</h3>
              <span className="feed-count">
                Verified across {meta.sourcesOk?.length || 1} independent source{meta.sourcesOk?.length === 1 ? '' : 's'}
              </span>
            </div>
            <button
              className="btn-alert-stub"
              onClick={() => openUpgradeModal('rate_alerts')}
              title="Set email/SMS rate drop notifications"
            >
              🔔 Create Rate Alert (Pro)
            </button>
          </div>
          <div className="table-wrapper">
            <table className="rates-table">
              <thead>
                <tr>
                  <th>Currency</th>
                  <th>1 {base} =</th>
                  <th>{numericAmount.toLocaleString()} {base} =</th>
                  <th>Consensus Source</th>
                  <th>30-Day Trend</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.rates).map(([cur, r]) => {
                  const convertedVal = (r.rate * numericAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                  return (
                    <tr key={cur} className={r.disputed ? 'row-disputed' : ''}>
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
                      {/* Product Feature: Locked Sparkline Teaser for Paid Tier */}
                      <td className="sparkline-cell">
                        <div
                          className="sparkline-lock"
                          onClick={() => openUpgradeModal('historical_chart')}
                          title="Historical charts are available on the Pro tier ($9/mo)"
                        >
                          <svg width="48" height="18" viewBox="0 0 48 18" className="mock-sparkline">
                            <path d="M 2 12 Q 10 4 18 10 T 34 6 T 46 8" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="2 2" />
                          </svg>
                          <span className="lock-tag">🔒 Pro</span>
                        </div>
                      </td>
                      <td className="action-cell">
                        <button
                          className="btn-copy-table"
                          onClick={() => handleCopy(`${convertedVal} ${cur}`, cur)}
                          title="Copy amount to clipboard"
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
      <footer className="footer">
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
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="btn-modal-close" onClick={() => setShowProModal(false)}>✕</button>
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
                📈 <em>Full 10-year interactive historical charts and trend analysis are included in Pro.</em>
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
