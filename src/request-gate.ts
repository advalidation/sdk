import { sleep } from "./sleep.js";

/**
 * Serializes all HTTP requests through a single lock and applies
 * rate-aware pacing based on API response headers.
 *
 * When multiple `validate()` calls share one gate, requests execute
 * one at a time. If the server signals low remaining tokens
 * (`X-RateLimit-IPRemaining <= 2`), the gate inserts a 1s delay
 * between requests to match the server's 1 token/s refill rate.
 */
export class RequestGate {
  private lock: Promise<void> = Promise.resolve();
  private backoffMs = 0;

  /**
   * Serialize execution through the lock, applying backpressure delay
   * between requests when the server signals low remaining tokens.
   */
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let release: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.lock;
    this.lock = next;
    await prev;

    if (this.backoffMs > 0) {
      await sleep(this.backoffMs, signal);
    }

    try {
      return await fn();
    } finally {
      release!();
    }
  }

  /**
   * Adjust pacing based on the `X-RateLimit-IPRemaining` response header.
   * When remaining tokens drop to 2 or below, activate 1s pacing.
   */
  updateFromHeaders(headers: Headers): void {
    const remaining = parseInt(
      headers.get("X-RateLimit-IPRemaining") ?? "",
      10,
    );
    if (!isNaN(remaining)) {
      this.backoffMs = remaining <= 2 ? 1000 : 0;
    }
  }

  /** Force 1s pacing after receiving a 429 response. */
  activateBackoff(): void {
    this.backoffMs = 1000;
  }
}
