import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RequestGate } from "../src/request-gate.js";

describe("RequestGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes concurrent requests", async () => {
    const gate = new RequestGate();
    const order: number[] = [];

    const p1 = gate.run(async () => {
      order.push(1);
      return "a";
    });
    const p2 = gate.run(async () => {
      order.push(2);
      return "b";
    });
    const p3 = gate.run(async () => {
      order.push(3);
      return "c";
    });

    const results = await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("releases lock even when fn throws", async () => {
    const gate = new RequestGate();

    const p1 = gate.run(async () => {
      throw new Error("boom");
    });

    await expect(p1).rejects.toThrow("boom");

    const result = await gate.run(async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("activates 1s backoff when remaining <= 2", async () => {
    const gate = new RequestGate();

    const headers = new Headers({ "X-RateLimit-IPRemaining": "2" });
    gate.updateFromHeaders(headers);

    const start = Date.now();
    const promise = gate.run(async () => Date.now());

    await vi.advanceTimersByTimeAsync(1000);
    const executionTime = await promise;
    expect(executionTime - start).toBeGreaterThanOrEqual(1000);
  });

  it("does not add delay when remaining > 2", async () => {
    const gate = new RequestGate();

    const headers = new Headers({ "X-RateLimit-IPRemaining": "10" });
    gate.updateFromHeaders(headers);

    const start = Date.now();
    const result = await gate.run(async () => Date.now() - start);
    expect(result).toBeLessThan(100);
  });

  it("deactivates backoff when remaining recovers above 2", async () => {
    const gate = new RequestGate();

    gate.updateFromHeaders(new Headers({ "X-RateLimit-IPRemaining": "1" }));
    gate.updateFromHeaders(new Headers({ "X-RateLimit-IPRemaining": "10" }));

    const start = Date.now();
    const result = await gate.run(async () => Date.now() - start);
    expect(result).toBeLessThan(100);
  });

  it("activateBackoff forces 1s delay", async () => {
    const gate = new RequestGate();
    gate.activateBackoff();

    const start = Date.now();
    const promise = gate.run(async () => Date.now());

    await vi.advanceTimersByTimeAsync(1000);
    const executionTime = await promise;
    expect(executionTime - start).toBeGreaterThanOrEqual(1000);
  });

  it("ignores non-numeric X-RateLimit-IPRemaining", async () => {
    const gate = new RequestGate();

    // First activate backoff
    gate.activateBackoff();

    // Non-numeric header should not clear the backoff
    gate.updateFromHeaders(new Headers({ "X-RateLimit-IPRemaining": "invalid" }));

    const start = Date.now();
    const promise = gate.run(async () => Date.now());

    await vi.advanceTimersByTimeAsync(1000);
    const executionTime = await promise;
    expect(executionTime - start).toBeGreaterThanOrEqual(1000);
  });

  it("ignores missing X-RateLimit-IPRemaining header", async () => {
    const gate = new RequestGate();

    // Activate backoff
    gate.activateBackoff();

    // Headers without the rate limit header should not clear backoff
    gate.updateFromHeaders(new Headers());

    const start = Date.now();
    const promise = gate.run(async () => Date.now());

    await vi.advanceTimersByTimeAsync(1000);
    const executionTime = await promise;
    expect(executionTime - start).toBeGreaterThanOrEqual(1000);
  });
});
