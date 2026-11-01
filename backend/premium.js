// FP-01, FP-03, FP-04, FP-08, FP-10: Enterprise-grade Premium Engine
import { defaultQuotaStore } from './quotaStore.js';
import { validateProviderData } from './validator.js';

export const getPremiumStatus = () => {
  return {
    enabled: Boolean(process.env.PREMIUM_API_URL || process.env.EXCHANGERATE_API_KEY),
    ...defaultQuotaStore.getStatus()
  };
};

export async function tryPremium(base, clientId = 'anonymous') {
  const premiumKey = process.env.EXCHANGERATE_API_KEY || process.env.PREMIUM_API_KEY;
  const isEnabled = Boolean(process.env.PREMIUM_API_URL || premiumKey);

  if (!isEnabled) {
    return null;
  }

  // FP-10: Check quota allowance BEFORE calling the API, but do NOT decrement yet
  const allowance = defaultQuotaStore.canSpend(clientId);
  if (!allowance.allowed) {
    return null; // Budget exhausted or user limit reached -> graceful fail-open
  }

  try {
    let url = process.env.PREMIUM_API_URL;
    const headers = { 'Content-Type': 'application/json' };

    if (!url && premiumKey) {
      // Use authenticated ExchangeRate-API v6 endpoint as the premium live engine
      url = `https://v6.exchangerate-api.com/v6/${premiumKey}/latest/${base}`;
    } else if (premiumKey) {
      url = `${url}?base=${base}`;
      headers['Authorization'] = `Bearer ${premiumKey}`;
    }

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(2500)
    });

    if (!res.ok) {
      throw new Error(`Premium HTTP ${res.status}`);
    }

    const raw = await res.json();
    const rawRates = raw.conversion_rates || raw.rates;

    if (!rawRates || typeof rawRates !== 'object') {
      throw new Error('Invalid premium payload: missing rates');
    }

    // Filter to ISO-4217 3-letter currency codes
    const rates = Object.fromEntries(
      Object.entries(rawRates)
        .filter(([k]) => /^[A-Za-z]{3}$/.test(k))
        .map(([k, v]) => [k.toUpperCase(), Number(v)])
    );

    const asOf = raw.time_last_update_unix
      ? raw.time_last_update_unix * 1000
      : raw.timestamp
      ? raw.timestamp * 1000
      : Date.now();

    // FP-08: Validate premium payload strictly
    const validated = validateProviderData({ rates, asOf }, 'premium');

    // FP-10: Atomically commit quota ONLY after successful upstream validation
    defaultQuotaStore.commitUsage(clientId);

    return {
      name: 'premium',
      isPremium: true,
      rates: validated.rates,
      asOf: validated.asOf
    };
  } catch (err) {
    // If premium fails or times out, quota is NOT consumed, falls back to free consensus
    return null;
  }
}
