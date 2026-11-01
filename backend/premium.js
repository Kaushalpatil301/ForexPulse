// FP-01, FP-03, FP-04, FP-08, FP-10: Enterprise-grade Premium Engine
import { defaultQuotaStore } from './quotaStore.js';
import { validateProviderData } from './validator.js';

export const getPremiumStatus = () => {
  return {
    enabled: Boolean(process.env.PREMIUM_API_URL),
    ...defaultQuotaStore.getStatus()
  };
};

export async function tryPremium(base, clientId = 'anonymous') {
  if (!process.env.PREMIUM_API_URL) {
    return null;
  }

  // FP-10: Check quota allowance BEFORE calling the API, but do NOT decrement yet
  const allowance = defaultQuotaStore.canSpend(clientId);
  if (!allowance.allowed) {
    return null; // Budget exhausted or user limit reached -> graceful fail-open
  }

  try {
    const res = await fetch(`${process.env.PREMIUM_API_URL}?base=${base}`, {
      headers: {
        Authorization: `Bearer ${process.env.PREMIUM_API_KEY || ''}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(2500)
    });

    if (!res.ok) {
      throw new Error(`Premium HTTP ${res.status}`);
    }

    const raw = await res.json();

    // FP-08: Validate premium payload strictly
    const normalized = {
      rates: raw.rates,
      asOf: raw.timestamp ? raw.timestamp * 1000 : Date.now()
    };

    const validated = validateProviderData(normalized, 'premium');

    // FP-10: Atomically commit quota ONLY after successful upstream validation
    defaultQuotaStore.commitUsage(clientId);

    return {
      name: 'premium',
      isPremium: true,
      rates: validated.rates,
      asOf: validated.asOf
    };
  } catch (err) {
    // If premium fails or times out, quota is NOT consumed, falls back to free
    return null;
  }
}
