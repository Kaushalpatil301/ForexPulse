// Free, keyless public APIs. Each adapter normalizes to { rates: {CUR: number}, asOf: ms }.
const get = async (url, ms = 3000) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export const SOURCES = [
  {
    name: 'open.er-api.com',
    // Has a real "last updated" unix timestamp -> most honest freshness signal.
    fetch: async (base) => {
      const d = await get(`https://open.er-api.com/v6/latest/${base}`);
      if (d.result !== 'success') throw new Error('bad result');
      return { rates: d.rates, asOf: d.time_last_update_unix * 1000 };
    },
  },
  {
    name: 'fawazahmed0/currency-api',
    // CDN-hosted (jsDelivr) -> very high availability, daily data.
    fetch: async (base) => {
      const b = base.toLowerCase();
      const d = await get(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${b}.json`);
      const rates = Object.fromEntries(Object.entries(d[b]).map(([k, v]) => [k.toUpperCase(), v]));
      return { rates, asOf: Date.parse(d.date) };
    },
  },
  {
    name: 'frankfurter (ECB)',
    // Central-bank reference rates; trustworthy tie-breaker, weekdays only.
    fetch: async (base) => {
      const d = await get(`https://api.frankfurter.dev/v1/latest?base=${base}`);
      return { rates: { ...d.rates, [base]: 1 }, asOf: Date.parse(d.date) };
    },
  },
];

// Optional 4th source: Open Exchange Rates free tier = HOURLY updates (needs free key, USD base only).
// Enabled only if OXR_APP_ID is set. Cross-rates are derived via USD.
if (process.env.OXR_APP_ID) {
  SOURCES.push({
    name: 'openexchangerates (hourly)',
    fetch: async (base) => {
      const d = await get(`https://openexchangerates.org/api/latest.json?app_id=${process.env.OXR_APP_ID}`);
      const b = d.rates[base];
      if (!b) throw new Error('base unsupported');
      const rates = Object.fromEntries(Object.entries(d.rates).map(([k, v]) => [k, v / b]));
      return { rates, asOf: d.timestamp * 1000 };
    },
  });
}
