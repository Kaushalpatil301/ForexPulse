// FP-16: IP Rate Limiting Middleware (Sliding Window)

export function createRateLimiter({ windowMs = 60000, maxRequests = 120 } = {}) {
  const clients = new Map();

  // Periodic cleanup of stale client records every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of clients.entries()) {
      if (now > entry.resetTime) {
        clients.delete(ip);
      }
    }
  }, 300000).unref();

  return function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || '127.0.0.1';
    const now = Date.now();

    let entry = clients.get(ip);
    if (!entry || now > entry.resetTime) {
      entry = { count: 1, resetTime: now + windowMs };
      clients.set(ip, entry);
    } else {
      entry.count++;
    }

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetTime / 1000));

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'Too many requests. Please slow down and try again shortly.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: retryAfter
      });
    }

    next();
  };
}
