# REST API Reference

The ForexPulse API provides a unified, high-resilience endpoint for querying multi-source consensus currency exchange rates.

---

## Base URL
```http
http://localhost:3001/api
```
*(In production, replace with your deployed root domain)*

---

## Endpoints

### 1. Health Check
```http
GET /health
```

#### Response (`200 OK`)
```json
{
  "status": "ok",
  "uptime": 124.58
}
```

---

### 2. Get Exchange Rates
```http
GET /api/rates
```

#### Query Parameters
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `base` | `string` | No | `USD` | 3-letter ISO-4217 base currency (e.g. `USD`, `EUR`, `GBP`, `INR`). Validated against whitelist. |
| `symbols` | `string` | No | Top 9 fiat | Comma-separated target currencies (e.g. `EUR,GBP,INR,JPY`). |
| `intent` | `string` | No | `normal` | Pass `high` for high-value conversions or manual user refreshes to trigger premium budget allocation. |

---

#### Success Response (`200 OK`)
```json
{
  "base": "USD",
  "rates": {
    "EUR": {
      "rate": 0.8955,
      "source": "open.er-api.com",
      "asOf": 1793491351000,
      "agreeingSources": 3,
      "disputed": false
    },
    "GBP": {
      "rate": 0.7469,
      "source": "open.er-api.com",
      "asOf": 1793491351000,
      "agreeingSources": 3,
      "disputed": false
    },
    "INR": {
      "rate": 95.0501,
      "source": "open.er-api.com",
      "asOf": 1793491351000,
      "agreeingSources": 3,
      "disputed": false
    }
  },
  "meta": {
    "status": "fresh",
    "freshnessLabel": "Daily Central Bank & Market Rate",
    "degraded": false,
    "message": "Free-tier rates update about once a day. Upgrade for real-time.",
    "asOf": 1793491351000,
    "asOfFormatted": "Sun, 01 Nov 2026 00:02:31 GMT",
    "ageSeconds": 330,
    "lastCheckedAt": 1793524666311,
    "lastCheckedSeconds": 2,
    "servedFromCache": true,
    "premiumUsed": false,
    "sourcesOk": [
      "open.er-api.com",
      "fawazahmed0/currency-api",
      "frankfurter (ECB)"
    ],
    "sourcesFailed": [],
    "premiumBudget": {
      "enabled": false,
      "used": 0,
      "limit": 5000
    }
  }
}
```

---

#### Error Responses

##### `400 Bad Request` — Invalid or Unsupported Currency
```json
{
  "error": "Unsupported or invalid base currency 'XYZ'. Supported: USD, EUR, GBP, INR, JPY, AUD, CAD, CHF, AED, SGD, NZD, CNY, HKD, SEK, NOK, MXN, BRL, ZAR, KRW, THB",
  "code": "INVALID_BASE"
}
```

##### `503 Service Unavailable` — Total Upstream Outage on Cold Boot
```json
{
  "error": "Rates are temporarily unavailable. Please try again in a minute.",
  "code": "ALL_SOURCES_DOWN"
}
```
