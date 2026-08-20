/**
 * Token-bucket rate limiting.
 *
 * Every inbound message class (chat, draw, everything else) gets its own bucket
 * per connection. Buckets refill continuously rather than on a fixed window, so
 * a burst is allowed but a sustained flood is not.
 */

export interface RateSpec {
  /** Maximum tokens the bucket can hold — i.e. the largest allowed burst. */
  readonly capacity: number;
  /** Tokens added per second. */
  readonly refillPerSec: number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly spec: RateSpec, now = Date.now()) {
    this.tokens = spec.capacity;
    this.last = now;
  }

  /** Consume one token. Returns false if the caller is over its limit. */
  take(now = Date.now(), cost = 1): boolean {
    const elapsed = (now - this.last) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.spec.capacity, this.tokens + elapsed * this.spec.refillPerSec);
      this.last = now;
    }
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
