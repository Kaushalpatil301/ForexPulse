// FP-12: Upstream Schema Validation, FP-13: Circuit Breakers, FP-14: Exponential Backoff Retries
import { validateProviderData } from './validator.js';
import { CircuitBreaker, retryWithBackoff } from './circuitBreaker.js';

const fetchWithTimeout = async (url, ms = 3000) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
};

export const PROVIDER_CIRCUIT_BREAKERS = {
  'open.er-api.com': new CircuitBreaker('open.er-api.com', { failureThreshold: 3, cooldownMs: 25000 }),
  'fawazahmed0/currency-api': new CircuitBreaker('fawazahmed0/currency-api', { failureThreshold: 3, cooldownMs: 25000 }),
  'frankfurter (ECB)': new CircuitBreaker('frankfurter (ECB)', { failureThreshold: 3, cooldownMs: 25000 }),
  'openexchangerates (hourly)': new CircuitBreaker('openexchangerates (hourly)', { failureThreshold: 3, cooldownMs: 25000 })
};

export const PROVIDER_METRICS = {
  latencies: {},
  lastChecked: {}
};

export const SOURCES = [
  {
    name: 'open.er-api.com',
    fetch: async (base) => {
      const breaker = PROVIDER_CIRCUIT_BREAKERS['open.er-api.com'];
      if (breaker.isOpen()) {
        throw new Error('Circuit breaker is OPEN (provider temporarily skipped)');
      }

      const start = Date.now();
      try {
        const raw = await retryWithBackoff(
          () => fetchWithTimeout(`https://open.er-api.com/v6/latest/${base}`, 3000),
          { maxRetries: 1, baseBackoffMs: 150 }
        );

        if (raw.result !== 'success' || !raw.rates) {
          throw new Error('Invalid payload structure: missing result or rates');
        }

        const rates = Object.fromEntries(
          Object.entries(raw.rates)
            .filter(([k]) => /^[A-Za-z]{3}$/.test(k))
            .map(([k, v]) => [k.toUpperCase(), Number(v)])
        );

        const normalized = {
          rates,
          asOf: raw.time_last_update_unix ? raw.time_last_update_unix * 1000 : Date.now()
        };

        const validated = validateProviderData(normalized, 'open.er-api.com');
        breaker.recordSuccess();
        PROVIDER_METRICS.latencies['open.er-api.com'] = Date.now() - start;
        PROVIDER_METRICS.lastChecked['open.er-api.com'] = Date.now();
        return validated;
      } catch (err) {
        breaker.recordFailure();
        throw err;
      }
    }
  },
  {
    name: 'fawazahmed0/currency-api',
    fetch: async (base) => {
      const breaker = PROVIDER_CIRCUIT_BREAKERS['fawazahmed0/currency-api'];
      if (breaker.isOpen()) {
        throw new Error('Circuit breaker is OPEN (provider temporarily skipped)');
      }

      const start = Date.now();
      try {
        const b = base.toLowerCase();
        const raw = await retryWithBackoff(
          () => fetchWithTimeout(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${b}.json`, 3000),
          { maxRetries: 1, baseBackoffMs: 150 }
        );

        if (!raw[b] || typeof raw[b] !== 'object') {
          throw new Error('Invalid payload structure: missing currency table');
        }

        const rates = Object.fromEntries(
          Object.entries(raw[b])
            .filter(([k]) => /^[A-Za-z]{3}$/.test(k))
            .map(([k, v]) => [k.toUpperCase(), Number(v)])
        );

        const normalized = {
          rates,
          asOf: raw.date ? Date.parse(raw.date) : Date.now()
        };

        const validated = validateProviderData(normalized, 'fawazahmed0/currency-api');
        breaker.recordSuccess();
        PROVIDER_METRICS.latencies['fawazahmed0/currency-api'] = Date.now() - start;
        PROVIDER_METRICS.lastChecked['fawazahmed0/currency-api'] = Date.now();
        return validated;
      } catch (err) {
        breaker.recordFailure();
        throw err;
      }
    }
  },
  {
    name: 'frankfurter (ECB)',
    fetch: async (base) => {
      const breaker = PROVIDER_CIRCUIT_BREAKERS['frankfurter (ECB)'];
      if (breaker.isOpen()) {
        throw new Error('Circuit breaker is OPEN (provider temporarily skipped)');
      }

      const start = Date.now();
      try {
        const raw = await retryWithBackoff(
          () => fetchWithTimeout(`https://api.frankfurter.dev/v1/latest?base=${base}`, 3000),
          { maxRetries: 1, baseBackoffMs: 150 }
        );

        if (!raw.rates || typeof raw.rates !== 'object') {
          throw new Error('Invalid payload structure: missing rates');
        }

        const rawRates = { ...raw.rates, [base]: 1 };
        const rates = Object.fromEntries(
          Object.entries(rawRates)
            .filter(([k]) => /^[A-Za-z]{3}$/.test(k))
            .map(([k, v]) => [k.toUpperCase(), Number(v)])
        );

        const normalized = {
          rates,
          asOf: raw.date ? Date.parse(raw.date) : Date.now()
        };

        const validated = validateProviderData(normalized, 'frankfurter (ECB)');
        breaker.recordSuccess();
        PROVIDER_METRICS.latencies['frankfurter (ECB)'] = Date.now() - start;
        PROVIDER_METRICS.lastChecked['frankfurter (ECB)'] = Date.now();
        return validated;
      } catch (err) {
        breaker.recordFailure();
        throw err;
      }
    }
  }
];

if (process.env.OXR_APP_ID) {
  SOURCES.push({
    name: 'openexchangerates (hourly)',
    fetch: async (base) => {
      const breaker = PROVIDER_CIRCUIT_BREAKERS['openexchangerates (hourly)'];
      if (breaker.isOpen()) {
        throw new Error('Circuit breaker is OPEN (provider temporarily skipped)');
      }

      const start = Date.now();
      try {
        const raw = await retryWithBackoff(
          () => fetchWithTimeout(`https://openexchangerates.org/api/latest.json?app_id=${process.env.OXR_APP_ID}`, 3000),
          { maxRetries: 1, baseBackoffMs: 150 }
        );

        const bRate = raw.rates?.[base];
        if (!bRate) throw new Error(`Base ${base} unsupported by OXR`);

        const rates = Object.fromEntries(
          Object.entries(raw.rates).map(([k, v]) => [k, Number(v) / bRate])
        );

        const normalized = {
          rates,
          asOf: raw.timestamp ? raw.timestamp * 1000 : Date.now()
        };

        const validated = validateProviderData(normalized, 'openexchangerates (hourly)');
        breaker.recordSuccess();
        PROVIDER_METRICS.latencies['openexchangerates (hourly)'] = Date.now() - start;
        PROVIDER_METRICS.lastChecked['openexchangerates (hourly)'] = Date.now();
        return validated;
      } catch (err) {
        breaker.recordFailure();
        throw err;
      }
    }
  });
}
