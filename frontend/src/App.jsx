import { useEffect, useState, useCallback } from 'react';

const BASES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD', 'JPY', 'CHF', 'SGD'];
const PRESET_AMOUNTS = [100, 500, 1000, 5000];
const HIGH_INTENT_AMOUNT = 1000; // converting a large amount = high intent -> allowed to use premium budget

const formatAgo = (seconds) => {
  if (seconds == null || isNaN(seconds)) return 'just now';
  if (seconds < 60) return 'just now';
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
  aging: { label: 'Slightly Old', style: 'badge-aging', icon: '▲' },
  stale: { label: 'Outdated', style: 'badge-stale', icon: '✕' },
};

export default function App() {
  const [base, setBase] = useState('USD');
  const [amount, setAmount] = useState(100);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showProModal, setShowProModal] = useState(false);

  const fetchRates = useCallback(async (intent = false) => {
    setLoading(true);
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

  // Auto-refresh periodically (free polling, low intent)
  useEffect(() => {
    const timer = setInterval(() => fetchRates(false), 60000);
    return () => clearInterval(timer);
  }, [fetchRates]);

  const meta = data?.meta;
  const badge = meta ? (BADGE_MAP[meta.status] || BADGE_MAP.fresh) : null;
  const numericAmount = isNaN(Number(amount)) || Number(amount) < 0 ? 0 : Number(amount);

  return (
    <div className="app-container">
      {/* Top Navigation / Brand */}
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
          <button className="btn-upgrade" onClick={() => setShowProModal(true)}>
            Upgrade to Pro ($9/mo)
          </button>
        </div>
      </header>

      {/* Main Converter Card */}
      <section className="card converter-card">
        <div className="controls-row">
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
            <label htmlFor="base-select">Base Currency</label>
            <select
              id="base-select"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            >
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="action-group">
            <label>&nbsp;</label>
            <button
              className="btn-refresh"
              onClick={() => fetchRates(true)}
              disabled={loading}
              title="Queries fresh data with high-intent priority"
            >
              {loading ? 'Refreshing…' : '↻ Refresh Now'}
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
      </section>

      {/* Freshness & Trust Indicator Banner */}
      {meta && (
        <section className={`status-banner ${meta.status}`}>
          <div className="banner-header">
            <span className={`status-badge ${badge.style}`}>
              <span className="badge-dot">{badge.icon}</span> {badge.label}
            </span>
            <span className="timestamp">
              Rates updated {formatAgo(meta.ageSeconds)}
            </span>
            {meta.servedFromCache && (
              <span className="cache-pill">Cached (5m TTL)</span>
            )}
            {meta.premiumUsed && (
              <span className="premium-pill">⚡ Premium Route Used</span>
            )}
          </div>
          <p className="banner-msg">{meta.message}</p>
        </section>
      )}

      {/* Degraded State or Error Notification */}
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

      {/* Rates Table */}
      {data?.rates && (
        <section className="card table-card">
          <div className="table-header">
            <h3>Consensus Exchange Rates</h3>
            <span className="feed-count">
              Verified across {meta.sourcesOk?.length || 1} independent source{meta.sourcesOk?.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="table-wrapper">
            <table className="rates-table">
              <thead>
                <tr>
                  <th>Currency</th>
                  <th>1 {base} =</th>
                  <th>{numericAmount.toLocaleString()} {base} =</th>
                  <th>Consensus Source</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.rates).map(([cur, r]) => (
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
                          ⚠️ consensus
                        </span>
                      )}
                    </td>
                    <td className="total-cell">
                      <strong>{(r.rate * numericAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> {cur}
                    </td>
                    <td className="source-cell">
                      <span className="source-tag">{r.source}</span>
                    </td>
                  </tr>
                ))}
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
        <button className="btn-pro-cta" onClick={() => setShowProModal(true)}>
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

      {/* Pro Modal */}
      {showProModal && (
        <div className="modal-backdrop" onClick={() => setShowProModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="btn-modal-close" onClick={() => setShowProModal(false)}>✕</button>
            <div className="modal-badge">PRO PLAN</div>
            <h2>Upgrade to Real-Time Forex Pro</h2>
            <p className="modal-price"><strong>$9</strong> / month</p>
            <ul className="modal-features">
              <li>✓ Sub-second interbank live rates from Bloomberg/Reuters feeds</li>
              <li>✓ 99.99% guaranteed SLA uptime with dedicated API gateway</li>
              <li>✓ Instant WhatsApp & Email volatility alerts</li>
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
