/** Token bucket. `allow()` returns false once the per-second budget is exhausted. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly perSecond: number) {
    this.tokens = perSecond;
  }

  allow(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.perSecond, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
