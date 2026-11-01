// Budgeted premium access for free users. Integration point only: enabled when PREMIUM_API_URL is set.
// Expected response: { rates: {CUR: number}, timestamp: unix_seconds }
const DAILY_LIMIT = Number(process.env.PREMIUM_DAILY_CALLS || 5000); // ~$5/day at $0.001/call
const PER_USER_DAILY = Number(process.env.PREMIUM_PER_USER || 10);

let day = '', used = 0;
const perUser = new Map();

const rollDay = () => {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; perUser.clear(); }
};

export const premiumStatus = () => { rollDay(); return { enabled: !!process.env.PREMIUM_API_URL, used, limit: DAILY_LIMIT }; };

export async function tryPremium(base, clientId) {
  rollDay();
  if (!process.env.PREMIUM_API_URL) return null;
  if (used >= DAILY_LIMIT) return null;
  if ((perUser.get(clientId) || 0) >= PER_USER_DAILY) return null;
  used++; perUser.set(clientId, (perUser.get(clientId) || 0) + 1);
  try {
    const r = await fetch(`${process.env.PREMIUM_API_URL}?base=${base}`, {
      headers: { Authorization: `Bearer ${process.env.PREMIUM_API_KEY || ''}` },
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return { rates: d.rates, asOf: (d.timestamp || Date.now() / 1000) * 1000 };
  } catch { return null; } // fall through to free sources
}
