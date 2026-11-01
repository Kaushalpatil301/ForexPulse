// FP-03, FP-04, FP-10: Persistent & Atomic Quota Store
import fs from 'fs';
import path from 'path';

export class QuotaStore {
  constructor(options = {}) {
    this.dailyLimit = Number(options.dailyLimit || process.env.PREMIUM_DAILY_CALLS || 5000);
    this.perUserDaily = Number(options.perUserDaily || process.env.PREMIUM_PER_USER || 10);
    this.storagePath = options.storagePath || process.env.QUOTA_STORAGE_PATH || path.join(process.cwd(), '.data', 'quota.json');
    this.day = '';
    this.used = 0;
    this.perUser = new Map();
    this.init();
  }

  init() {
    this.rollDay();
    this.load();
  }

  getTodayString() {
    return new Date().toISOString().slice(0, 10);
  }

  rollDay() {
    const today = this.getTodayString();
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
      this.perUser.clear();
      this.persist();
    }
  }

  load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        if (data.day === this.day) {
          this.used = Number(data.used || 0);
          this.perUser = new Map(Object.entries(data.perUser || {}));
        }
      }
    } catch {
      // Fallback to fresh in-memory if file corrupted
    }
  }

  persist() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload = JSON.stringify({
        day: this.day,
        used: this.used,
        perUser: Object.fromEntries(this.perUser)
      });
      fs.writeFileSync(this.storagePath, payload, 'utf8');
    } catch {
      // Non-fatal if filesystem is read-only
    }
  }

  // Check if client can use premium WITHOUT consuming quota yet (FP-10)
  canSpend(clientId = 'anonymous') {
    this.rollDay();
    if (this.used >= this.dailyLimit) {
      return { allowed: false, reason: 'GLOBAL_DAILY_LIMIT_EXCEEDED' };
    }
    const userCount = this.perUser.get(clientId) || 0;
    if (userCount >= this.perUserDaily) {
      return { allowed: false, reason: 'USER_DAILY_LIMIT_EXCEEDED' };
    }
    return { allowed: true, remainingUser: this.perUserDaily - userCount, remainingGlobal: this.dailyLimit - this.used };
  }

  // Atomically commit quota ONLY after successful upstream validation (FP-10)
  commitUsage(clientId = 'anonymous') {
    this.rollDay();
    this.used++;
    const current = this.perUser.get(clientId) || 0;
    this.perUser.set(clientId, current + 1);
    this.persist();
    return {
      used: this.used,
      limit: this.dailyLimit,
      userUsed: current + 1,
      userLimit: this.perUserDaily
    };
  }

  getStatus() {
    this.rollDay();
    return {
      day: this.day,
      used: this.used,
      limit: this.dailyLimit,
      perUserLimit: this.perUserDaily
    };
  }
}

export const defaultQuotaStore = new QuotaStore();

