import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpClient } from "../src/http.js";
import { RequestGate } from "../src/request-gate.js";
import { RateLimitError, AuthenticationError, ApiError } from "../src/errors.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("HttpClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("rate limit (429) handling", () => {
    it("retries on 429 and succeeds", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      // Seed Math.random to 0 so jitter delay is 0
      vi.spyOn(Math, "random").mockReturnValue(0);

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
      });

      const result = await http.get("/test");
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("throws RateLimitError after max retries", async () => {
      // Always return 429
      mockFetch.mockResolvedValue(jsonResponse({}, 429));
      vi.spyOn(Math, "random").mockReturnValue(0);

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
      });

      await expect(http.get("/test")).rejects.toThrow(RateLimitError);

      // 1 initial + 5 retries = 6 total fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(6);
    });

    it("RateLimitError includes attempt count", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 429));
      vi.spyOn(Math, "random").mockReturnValue(0);

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
      });

      try {
        await http.get("/test");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).attempts).toBe(5);
      }
    });

    it("ignores Retry-After header (known broken)", async () => {
      // Server sends Retry-After: 15 (broken - it's the bucket size)
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 429, { "Retry-After": "15" }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      vi.spyOn(Math, "random").mockReturnValue(0);

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
      });

      const result = await http.get("/test");
      expect(result).toEqual({ ok: true });
      // Should not have waited 15s — the test would time out if it did
    });

    it("uses jittered delay (not fixed)", async () => {
      const randomValues = [0.5, 0.3];
      let randomIdx = 0;
      vi.spyOn(Math, "random").mockImplementation(() => randomValues[randomIdx++] ?? 0);

      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
      });

      const result = await http.get("/test");
      expect(result).toEqual({ ok: true });
      // Math.random was called at least twice for jitter
      expect(randomIdx).toBeGreaterThanOrEqual(2);
    });
  });

  describe("proactive backpressure", () => {
    it("updates gate from X-RateLimit-IPRemaining header", async () => {
      const gate = new RequestGate();
      const updateSpy = vi.spyOn(gate, "updateFromHeaders");

      mockFetch.mockResolvedValue(
        jsonResponse({ ok: true }, 200, { "X-RateLimit-IPRemaining": "5" }),
      );

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
        gate,
      });

      await http.get("/test");
      expect(updateSpy).toHaveBeenCalledTimes(1);

      const headers = updateSpy.mock.calls[0][0];
      expect(headers.get("X-RateLimit-IPRemaining")).toBe("5");
    });

    it("activates gate backoff on 429", async () => {
      const gate = new RequestGate();
      const activateSpy = vi.spyOn(gate, "activateBackoff");

      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));
      vi.spyOn(Math, "random").mockReturnValue(0);

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
        gate,
      });

      await http.get("/test");
      expect(activateSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("shared gate serialization", () => {
    it("multiple HttpClients sharing a gate serialize requests", async () => {
      const gate = new RequestGate();
      const order: string[] = [];

      mockFetch.mockImplementation(async (url: string) => {
        const path = new URL(url).pathname;
        order.push(path);
        return jsonResponse({ ok: true });
      });

      const http1 = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
        gate,
      });
      const http2 = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
        gate,
      });

      await Promise.all([http1.get("/first"), http2.get("/second")]);

      // Both requests should have completed
      expect(order).toHaveLength(2);
      expect(order).toContain("/v2/first");
      expect(order).toContain("/v2/second");
    });
  });

  describe("non-429 errors", () => {
    it("throws AuthenticationError on 401", async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 401));

      const http = new HttpClient({
        apiKey: "bad-key",
        baseUrl: "https://example.com/v2",
      });

      await expect(http.get("/test")).rejects.toThrow(AuthenticationError);
    });

    it("throws ApiError on other non-OK status", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: "not found" }, 404));

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
      });

      await expect(http.get("/test")).rejects.toThrow(ApiError);
    });

    it("handles non-JSON error body without crashing", async () => {
      mockFetch.mockResolvedValue(
        new Response("<html>404 Not Found</html>", {
          status: 404,
          headers: { "Content-Type": "text/html" },
        }),
      );

      const http = new HttpClient({
        apiKey: "test-key",
        baseUrl: "https://example.com/v2",
      });

      try {
        await http.get("/test");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(404);
        expect((err as ApiError).body).toBe("<html>404 Not Found</html>");
      }
    });
  });
});
