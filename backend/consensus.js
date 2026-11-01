// FP-01: Prioritize Premium, FP-02: Robust Median/MAD Outlier Detection, FP-06: Per-Currency Freshness

const HOUR_MS = 3600 * 1000;
const RELATIVE_DEVIATION_THRESHOLD = 0.02; // 2% cutoff

export function calculateMedian(numbers) {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calculateMAD(numbers, medianVal) {
  if (numbers.length <= 1) return 0;
  const deviations = numbers.map((n) => Math.abs(n - medianVal));
  return calculateMedian(deviations);
}

export function getFreshnessCategory(asOf) {
  const age = Date.now() - asOf;
  if (age <= 25 * HOUR_MS) return 'fresh';
  if (age <= 49 * HOUR_MS) return 'aging';
  return 'stale';
}

export function mergeSources(sourcesOk, symbols) {
  const rates = {};
  const perCurrencyAsOf = [];

  for (const sym of symbols) {
    // Find all providers with a valid numeric rate for this currency
    const candidates = sourcesOk
      .filter((s) => s.rates && typeof s.rates[sym] === 'number' && s.rates[sym] > 0)
      .map((s) => ({
        source: s.name,
        rate: s.rates[sym],
        asOf: s.asOf || Date.now(),
        isPremium: Boolean(s.isPremium || s.name === 'premium')
      }));

    if (!candidates.length) continue;

    // FP-01: Explicitly prioritize validated premium rates
    const premiumCandidate = candidates.find((c) => c.isPremium);
    
    if (premiumCandidate) {
      rates[sym] = {
        rate: Number(premiumCandidate.rate),
        source: 'premium (live)',
        asOf: premiumCandidate.asOf,
        ageSeconds: Math.max(0, Math.round((Date.now() - premiumCandidate.asOf) / 1000)),
        freshness: 'live',
        agreeingSources: candidates.length,
        disputed: false,
        isPremium: true
      };
      perCurrencyAsOf.push(premiumCandidate.asOf);
      continue;
    }

    // Sort free sources by newest timestamp
    candidates.sort((a, b) => b.asOf - a.asOf);
    const primary = candidates[0];

    // FP-02: Robust Consensus using Median & MAD
    let finalRate = primary.rate;
    let finalSource = primary.source;
    let isDisputed = false;

    if (candidates.length >= 2) {
      const allRates = candidates.map((c) => c.rate);
      const medianRate = calculateMedian(allRates);
      const mad = calculateMAD(allRates, medianRate);
      const relDev = Math.abs(primary.rate - medianRate) / medianRate;

      // Robust outlier check: modified Z-score if MAD > 0, else relative deviation
      let isOutlier = false;
      if (mad > 0) {
        const modifiedZ = (0.6745 * Math.abs(primary.rate - medianRate)) / mad;
        isOutlier = modifiedZ > 3.5 || relDev > RELATIVE_DEVIATION_THRESHOLD;
      } else {
        isOutlier = relDev > RELATIVE_DEVIATION_THRESHOLD;
      }

      if (isOutlier) {
        finalRate = medianRate;
        finalSource = 'median consensus';
        isDisputed = true;
      }
    }

    const curAsOf = primary.asOf;
    perCurrencyAsOf.push(curAsOf);

    rates[sym] = {
      rate: Number(finalRate),
      source: finalSource,
      asOf: curAsOf,
      ageSeconds: Math.max(0, Math.round((Date.now() - curAsOf) / 1000)),
      freshness: getFreshnessCategory(curAsOf),
      agreeingSources: candidates.length,
      disputed: isDisputed,
      isPremium: false
    };
  }

  // FP-06: Accurate multi-currency freshness metrics
  const newestAsOf = perCurrencyAsOf.length ? Math.max(...perCurrencyAsOf) : 0;
  const oldestAsOf = perCurrencyAsOf.length ? Math.min(...perCurrencyAsOf) : 0;
  const medianAsOf = perCurrencyAsOf.length ? calculateMedian(perCurrencyAsOf) : 0;

  return {
    rates,
    freshnessMetrics: {
      newestAsOf,
      oldestAsOf,
      medianAsOf,
      overallFreshness: getFreshnessCategory(oldestAsOf || Date.now())
    }
  };
}

