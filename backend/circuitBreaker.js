// FP-13: Circuit Breaker & FP-14: Exponential Backoff Retries

export class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3;
    this.cooldownMs = options.cooldownMs || 30000; // 30s before half-open attempt
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
    this.successCount = 0;
    this.totalFailures = 0;
  }

  isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.successCount++;
  }

  recordFailure() {
    this.consecutiveFailures++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  getStats() {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      successCount: this.successCount
    };
  }
}

export async function retryWithBackoff(fn, { maxRetries = 1, baseBackoffMs = 150 } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries) {
        throw err;
      }
      attempt++;
      const delay = baseBackoffMs * Math.pow(2, attempt - 1);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}
