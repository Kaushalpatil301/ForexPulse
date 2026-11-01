import { z } from 'zod';

export const ALLOWED_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'AED', 'SGD',
  'NZD', 'CNY', 'HKD', 'SEK', 'NOK', 'MXN', 'BRL', 'ZAR', 'KRW', 'THB'
];

export const ALLOWED_CURRENCY_SET = new Set(ALLOWED_CURRENCIES);

const CurrencyCodeSchema = z.string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter currency code')
  .refine((code) => ALLOWED_CURRENCY_SET.has(code), {
    message: `Unsupported currency. Supported: ${ALLOWED_CURRENCIES.join(', ')}`
  });

export const RatesQuerySchema = z.object({
  base: CurrencyCodeSchema.default('USD'),
  symbols: z.string().optional().transform((val, ctx) => {
    if (!val) return ALLOWED_CURRENCIES.slice(0, 10);
    const split = val.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const valid = split.filter((s) => /^[A-Z]{3}$/.test(s) && ALLOWED_CURRENCY_SET.has(s));
    if (valid.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `No valid target symbols provided. Supported: ${ALLOWED_CURRENCIES.join(', ')}`
      });
      return z.NEVER;
    }
    return Array.from(new Set(valid)).slice(0, 30);
  }),
  intent: z.enum(['normal', 'high']).default('normal'),
  amount: z.coerce.number().min(0, 'Amount must be greater than or equal to 0').max(1e12, 'Amount exceeds maximum supported limit').default(1)
});

// Upstream Provider Validation Schema (FP-08 & FP-12)
export const ProviderRatesSchema = z.object({
  rates: z.record(
    z.string().regex(/^[A-Z]{3}$/),
    z.number().positive('Rate must be positive').finite('Rate must be a finite number')
  ).refine((r) => Object.keys(r).length > 0, 'Rates dictionary cannot be empty'),
  asOf: z.number().int().positive().refine((ts) => {
    const minTime = 1577836800000; // 2020-01-01
    const maxTime = Date.now() + 86400000; // At most 1 day in the future (timezone skew)
    return ts >= minTime && ts <= maxTime;
  }, 'Timestamp asOf is out of realistic epoch range')
});

export function validateProviderData(data, sourceName) {
  const result = ProviderRatesSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues || result.error.errors || [];
    const errors = issues.map((e) => `${(e.path || []).join('.')}: ${e.message}`).join('; ');
    throw new Error(`[Schema Validation Failed] ${sourceName}: ${errors}`);
  }
  return result.data;
}
