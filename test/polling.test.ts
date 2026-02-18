import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pollUntilDone } from "../src/polling.js";
import { HttpClient } from "../src/http.js";
import {
  ScanFailedError,
  ScanCancelledError,
  TimeoutError,
  AbortError,
} from "../src/errors.js";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeCreativeResponse(processingStatus: string, nbIssues: number | null = null) {
  return {
    data: {
      id: 200,
      campaignId: 100,
      name: "test",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      parentId: null,
      sourceType: "html-tag",
      sourceTypeLabel: "HTML Tag",
      shareURL: "",
      livePreviewURL: "",
      previewAnimationURL: null,
      width: 300,
      height: 250,
      userId: 1,
      nbVariations: null,
      nbMediaFiles: null,
      latestScanStatus: {
        id: 300,
        processingStatus,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        finishedAt: processingStatus === "finished" ? "2024-01-01T00:00:01Z" : null,
        sequenceType: "initial",
        nbIssues,
        tests: null,
        isInconclusive: false,
        inconclusiveReason: null,
      },
    },
  };
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pollUntilDone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createHttpClient(): HttpClient {
    return new HttpClient({ apiKey: "test-key", baseUrl: "https://app.advalidation.io/v2" });
  }

  it("returns creative when scan finishes on first poll", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeCreativeResponse("finished", 0)));

    const http = createHttpClient();
    const promise = pollUntilDone(http, 200, { timeout: 60_000 });

    // Advance past first poll delay (5s)
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result.id).toBe(200);
    expect(result.latestScanStatus?.processingStatus).toBe("finished");
  });

  it("polls multiple times until finished", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.resolve(jsonResponse(makeCreativeResponse("processing")));
      }
      return Promise.resolve(jsonResponse(makeCreativeResponse("finished", 0)));
    });

    const http = createHttpClient();
    const promise = pollUntilDone(http, 200, { timeout: 120_000 });

    // First poll at 5s
    await vi.advanceTimersByTimeAsync(5_000);
    // Second poll at 30s
    await vi.advanceTimersByTimeAsync(30_000);
    // Third poll at 60s
    await vi.advanceTimersByTimeAsync(60_000);

    const result = await promise;
    expect(result.latestScanStatus?.processingStatus).toBe("finished");
    expect(callCount).toBe(3);
  });

  it("throws ScanFailedError when scan fails", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeCreativeResponse("failed")));

    const http = createHttpClient();
    const promise = pollUntilDone(http, 200, { timeout: 60_000 });
    const assertion = expect(promise).rejects.toThrow(ScanFailedError);

    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it("throws ScanCancelledError when scan is cancelled", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeCreativeResponse("cancelled")));

    const http = createHttpClient();
    const promise = pollUntilDone(http, 200, { timeout: 60_000 });
    const assertion = expect(promise).rejects.toThrow(ScanCancelledError);

    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it("throws TimeoutError when timeout is exceeded", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeCreativeResponse("processing")));

    const http = createHttpClient();
    const promise = pollUntilDone(http, 200, { timeout: 3_000 });
    const assertion = expect(promise).rejects.toThrow(TimeoutError);

    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });

  it("throws AbortError when signal is aborted", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeCreativeResponse("processing")));

    const http = createHttpClient();
    const controller = new AbortController();
    const promise = pollUntilDone(http, 200, {
      timeout: 120_000,
      signal: controller.signal,
    });
    const assertion = expect(promise).rejects.toThrow(AbortError);

    // Abort during the first sleep
    setTimeout(() => controller.abort(), 2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  it("uses correct polling schedule", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount < 4) {
        return Promise.resolve(jsonResponse(makeCreativeResponse("processing")));
      }
      return Promise.resolve(jsonResponse(makeCreativeResponse("finished", 0)));
    });

    const http = createHttpClient();
    const promise = pollUntilDone(http, 200, { timeout: 300_000 });

    // Poll 1 at 5s
    await vi.advanceTimersByTimeAsync(5_000);
    expect(callCount).toBe(1);

    // Poll 2 at 5s + 20s = 25s
    await vi.advanceTimersByTimeAsync(20_000);
    expect(callCount).toBe(2);

    // Poll 3 at 25s + 20s = 45s
    await vi.advanceTimersByTimeAsync(20_000);
    expect(callCount).toBe(3);

    // Poll 4 at 45s + 20s = 65s (this one returns finished)
    await vi.advanceTimersByTimeAsync(20_000);
    expect(callCount).toBe(4);

    const result = await promise;
    expect(result.latestScanStatus?.processingStatus).toBe("finished");
  });
});
