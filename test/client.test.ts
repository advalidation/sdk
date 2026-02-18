import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Advalidation } from "../src/client.js";
import { InputError, AuthenticationError } from "../src/errors.js";

// --- Mock fetch globally ---
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// --- Fixtures ---

const API_KEY = "test-api-key-123";

const ADSPEC_DETAIL = {
  data: {
    id: 42,
    name: "Test Spec",
    type: "display",
    isDefault: true,
    isPublic: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: null,
    shareURL: "https://example.com/share",
    tests: [
      {
        name: "Test_Display_Filesize",
        evaluationExpression: null,
        conditionsString: "150 KB",
        conditionsTemplate: null,
        enabled: true,
        attributes: [],
      },
      {
        name: "Test_Display_Dimensions",
        evaluationExpression: null,
        conditionsString: "300x250",
        conditionsTemplate: null,
        enabled: true,
        attributes: [],
      },
      {
        name: "Test_Disabled",
        evaluationExpression: null,
        conditionsString: "anything",
        conditionsTemplate: null,
        enabled: false,
        attributes: [],
      },
    ],
  },
};

const ADSPEC_LIST = {
  meta: { pagination: { count: 2, totalCount: 2, page: 1, totalPages: 1 } },
  data: [
    { id: 42, name: "Default Display", type: "display", isDefault: true },
    { id: 43, name: "Default Video", type: "video", isDefault: true },
  ],
};

const CAMPAIGN_RESPONSE = {
  data: {
    id: 100,
    name: "Test Campaign",
    type: "display",
    adspecId: 42,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    shareURL: "https://example.com/campaign",
    userId: 1,
  },
};

const CREATIVE_UPLOAD_RESPONSE = {
  meta: { pagination: { count: 1, totalCount: 1, page: 1, totalPages: 1 } },
  data: [
    {
      id: 200,
      campaignId: 100,
      name: "test-creative",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      parentId: null,
      sourceType: "html-tag",
      sourceTypeLabel: "HTML Tag",
      shareURL: "https://example.com/creative",
      livePreviewURL: "https://example.com/preview",
      previewAnimationURL: null,
      width: 300,
      height: 250,
      userId: 1,
      nbVariations: null,
      nbMediaFiles: null,
      latestScanStatus: {
        id: 300,
        processingStatus: "queued",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: null,
        finishedAt: null,
        sequenceType: "initial",
        nbIssues: null,
        tests: null,
        isInconclusive: null,
        inconclusiveReason: null,
      },
    },
  ],
};

const CREATIVE_FINISHED = {
  data: {
    ...CREATIVE_UPLOAD_RESPONSE.data[0],
    latestScanStatus: {
      id: 300,
      processingStatus: "finished",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      finishedAt: "2024-01-01T00:00:01Z",
      sequenceType: "initial",
      nbIssues: 0,
      tests: null,
      isInconclusive: false,
      inconclusiveReason: null,
    },
  },
};

const SCAN_RESPONSE = {
  data: {
    id: 300,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    finishedAt: "2024-01-01T00:00:01Z",
    sequenceType: "initial",
    nbIssues: 0,
    processingStatus: "finished",
    isInconclusive: false,
    inconclusiveReason: null,
    tests: [
      {
        name: "Test_Display_Filesize",
        value: "120000",
        valueFormatted: "120 KB",
        valuePhrase: "File size is 120 KB",
        result: "pass",
        attributes: [],
        extended: null,
      },
      {
        name: "Test_Display_Dimensions",
        value: "300x250",
        valueFormatted: "300x250",
        valuePhrase: "Dimensions are 300x250",
        result: "pass",
        attributes: [],
        extended: null,
      },
    ],
  },
};

// --- Helpers ---

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupHappyPath() {
  mockFetch.mockImplementation((url: string, init: RequestInit) => {
    const path = new URL(url).pathname;

    if (path.includes("/ad-specifications/42") && init.method === "GET") {
      return Promise.resolve(jsonResponse(ADSPEC_DETAIL));
    }
    if (path.includes("/ad-specifications") && init.method === "GET") {
      return Promise.resolve(jsonResponse(ADSPEC_LIST));
    }
    if (path.includes("/campaigns") && init.method === "POST" && !path.includes("/creatives")) {
      return Promise.resolve(jsonResponse(CAMPAIGN_RESPONSE));
    }
    if (path.includes("/creatives") && init.method === "POST") {
      return Promise.resolve(jsonResponse(CREATIVE_UPLOAD_RESPONSE));
    }
    if (path.match(/\/creatives\/\d+$/) && init.method === "GET") {
      return Promise.resolve(jsonResponse(CREATIVE_FINISHED));
    }
    if (path.includes("/scans/") && init.method === "GET") {
      return Promise.resolve(jsonResponse(SCAN_RESPONSE));
    }

    return Promise.resolve(jsonResponse({ error: "not found" }, 404));
  });
}

// --- Tests ---

describe("Advalidation", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("throws InputError when no API key provided", () => {
      delete process.env.ADVALIDATION_API_KEY;
      expect(() => new Advalidation()).toThrow(InputError);
    });

    it("accepts API key from options", () => {
      const client = new Advalidation({ apiKey: API_KEY });
      expect(client).toBeInstanceOf(Advalidation);
    });

    it("accepts API key from environment variable", () => {
      process.env.ADVALIDATION_API_KEY = API_KEY;
      const client = new Advalidation();
      expect(client).toBeInstanceOf(Advalidation);
      delete process.env.ADVALIDATION_API_KEY;
    });
  });

  describe("validate() param validation", () => {
    const client = new Advalidation({ apiKey: API_KEY });

    it("throws InputError when no input provided", async () => {
      await expect(
        client.validate({ spec: "42" } as any),
      ).rejects.toThrow(InputError);
    });

    it("throws InputError when both spec and type provided", async () => {
      await expect(
        client.validate({ url: "https://example.com", spec: "42", type: "display" }),
      ).rejects.toThrow(InputError);
    });

    it("throws InputError when neither spec nor type provided", async () => {
      await expect(
        client.validate({ url: "https://example.com" } as any),
      ).rejects.toThrow(InputError);
    });
  });

  describe("validate() with spec ID (full flow)", () => {
    const client = new Advalidation({ apiKey: API_KEY });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("fetches adspec by ID and returns result", async () => {
      setupHappyPath();

      const promise = client.validate({
        url: "https://example.com/ad.html",
        spec: "42",
        timeout: 60_000,
        details: true,
      });

      // Advance past the first polling delay (5s)
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await promise;

      expect(result.campaignId).toBe(100);
      expect(result.creativeId).toBe(200);
      expect(result.scanId).toBe(300);
      expect(result.passed).toBe(true);
      expect(result.issues).toBe(0);
      expect(result.tests).toHaveLength(2);
      expect(result.tests[0].name).toBe("Test_Display_Filesize");
      expect(result.tests[0].spec).toBe("150 KB");
      expect(result.tests[1].name).toBe("Test_Display_Dimensions");
      expect(result.tests[1].spec).toBe("300x250");
      expect(result.mediaFiles).toEqual([]);
      expect(result.variations).toEqual([]);
    });

    it("sends correct API key header", async () => {
      setupHappyPath();

      const promise = client.validate({
        url: "https://example.com/ad.html",
        spec: "42",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const firstCall = mockFetch.mock.calls[0];
      const headers = firstCall[1].headers;
      expect(headers.get("X-API-Key")).toBe(API_KEY);
    });

    it("filters disabled adspec tests", async () => {
      setupHappyPath();

      const promise = client.validate({
        url: "https://example.com/ad.html",
        spec: "42",
        timeout: 60_000,
        details: true,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      // "Test_Disabled" should not appear as a spec threshold
      // Only the 2 enabled tests should have spec values
      const specValues = result.tests.map((t) => t.spec);
      expect(specValues).toEqual(["150 KB", "300x250"]);
    });
  });

  describe("validate() with type (default adspec)", () => {
    const client = new Advalidation({ apiKey: API_KEY });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("finds default adspec for type and uses it", async () => {
      setupHappyPath();

      const promise = client.validate({
        url: "https://example.com/ad.html",
        type: "display",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.passed).toBe(true);

      // Should have called /ad-specifications (list) first, then /ad-specifications/42 (detail)
      const fetchCalls = mockFetch.mock.calls.map((c: unknown[]) => new URL(c[0] as string).pathname);
      expect(fetchCalls[0]).toBe("/v2/ad-specifications");
      expect(fetchCalls[1]).toBe("/v2/ad-specifications/42");
    });
  });

  describe("validate() creative input types", () => {
    const client = new Advalidation({ apiKey: API_KEY });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends URL as JSON payload", async () => {
      setupHappyPath();

      const promise = client.validate({
        url: "https://example.com/ad.html",
        spec: "42",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const creativeCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes("/creatives") && (c[1] as RequestInit).method === "POST",
      );
      const body = JSON.parse(creativeCall![1].body as string);
      expect(body.payload).toBe("https://example.com/ad.html");
    });

    it("sends tag as JSON payload", async () => {
      setupHappyPath();

      const promise = client.validate({
        tag: '<script src="https://example.com/ad.js"></script>',
        spec: "42",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const creativeCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes("/creatives") && (c[1] as RequestInit).method === "POST",
      );
      const body = JSON.parse(creativeCall![1].body as string);
      expect(body.payload).toBe('<script src="https://example.com/ad.js"></script>');
    });
  });

  describe("validate() data input", () => {
    const client = new Advalidation({ apiKey: API_KEY });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends Buffer as application/octet-stream with X-Filename", async () => {
      setupHappyPath();
      const buf = Buffer.from("fake-video-data");

      const promise = client.validate({
        data: buf,
        fileName: "test.mp4",
        spec: "42",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const creativeCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes("/creatives") && (c[1] as RequestInit).method === "POST",
      );
      const init = creativeCall![1] as RequestInit;
      expect(init.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(init.headers.get("X-Filename")).toBe("test.mp4");
      expect(init.body).toBe(buf);
    });

    it("sends Uint8Array as binary", async () => {
      setupHappyPath();
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

      const promise = client.validate({
        data: bytes,
        fileName: "pixels.bin",
        spec: "42",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const creativeCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes("/creatives") && (c[1] as RequestInit).method === "POST",
      );
      const init = creativeCall![1] as RequestInit;
      expect(init.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(init.body).toBe(bytes);
    });

    it("omits X-Filename header when fileName not provided", async () => {
      setupHappyPath();
      const buf = Buffer.from("fake-data");

      const promise = client.validate({
        data: buf,
        spec: "42",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const creativeCall = mockFetch.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes("/creatives") && (c[1] as RequestInit).method === "POST",
      );
      const init = creativeCall![1] as RequestInit;
      expect(init.headers.has("X-Filename")).toBe(false);
    });

    it("throws InputError when data is not a Buffer or Uint8Array", async () => {
      await expect(
        client.validate({ data: "not-binary" as any, spec: "42" }),
      ).rejects.toThrow(InputError);
    });
  });

  describe("validate() authentication", () => {
    const client = new Advalidation({ apiKey: "bad-key" });

    it("throws AuthenticationError on 401", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: { responseCode: 401, issues: [] } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(
        client.validate({ url: "https://example.com", spec: "42" }),
      ).rejects.toThrow(AuthenticationError);
    });
  });

  describe("validate() details option", () => {
    const client = new Advalidation({ apiKey: API_KEY });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns summary result by default (details: false)", async () => {
      setupHappyPath();

      const promise = client.validate({
        url: "https://example.com/ad.html",
        spec: "42",
        timeout: 60_000,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.campaignId).toBe(100);
      expect(result.creativeId).toBe(200);
      expect(result.scanId).toBe(300);
      expect(result.passed).toBe(true);
      expect(result.issues).toBe(0);
      expect(result.reportUrl).toBe("https://example.com/creative");
      expect(result.tests).toEqual([]);
      expect(result.mediaFiles).toEqual([]);
      expect(result.variations).toEqual([]);

      // Summary mode should NOT fetch scan details
      const scanCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes("/scans/"),
      );
      expect(scanCalls).toHaveLength(0);
    });

    it("returns full result when details: true", async () => {
      setupHappyPath();

      const promise = client.validate({
        url: "https://example.com/ad.html",
        spec: "42",
        timeout: 60_000,
        details: true,
      });

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(result.tests).toHaveLength(2);
      expect(result.tests[0].name).toBe("Test_Display_Filesize");

      // Detail mode SHOULD fetch scan details
      const scanCalls = mockFetch.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).includes("/scans/"),
      );
      expect(scanCalls.length).toBeGreaterThan(0);
    });
  });

  describe("constructor baseUrl resolution", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      delete process.env.ADVALIDATION_BASE_URL;
    });

    it("uses default base URL when none provided", async () => {
      setupHappyPath();
      const client = new Advalidation({ apiKey: API_KEY });

      const promise = client.validate({ url: "https://example.com/ad.html", spec: "42", timeout: 60_000 });
      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls.every((u) => u.startsWith("https://app.advalidation.com/v2/"))).toBe(true);
    });

    it("uses constructor baseUrl over env var and default", async () => {
      process.env.ADVALIDATION_BASE_URL = "https://env.example.com";
      setupHappyPath();
      const client = new Advalidation({ apiKey: API_KEY, baseUrl: "https://custom.example.com" });

      const promise = client.validate({ url: "https://example.com/ad.html", spec: "42", timeout: 60_000 });
      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls.every((u) => u.startsWith("https://custom.example.com/v2/"))).toBe(true);
    });

    it("uses env var when no constructor option provided", async () => {
      process.env.ADVALIDATION_BASE_URL = "https://env.example.com";
      setupHappyPath();
      const client = new Advalidation({ apiKey: API_KEY });

      const promise = client.validate({ url: "https://example.com/ad.html", spec: "42", timeout: 60_000 });
      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls.every((u) => u.startsWith("https://env.example.com/v2/"))).toBe(true);
    });

    it("strips trailing slashes from baseUrl", async () => {
      setupHappyPath();
      const client = new Advalidation({ apiKey: API_KEY, baseUrl: "https://custom.example.com///" });

      const promise = client.validate({ url: "https://example.com/ad.html", spec: "42", timeout: 60_000 });
      await vi.advanceTimersByTimeAsync(5_000);
      await promise;

      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls.every((u) => u.startsWith("https://custom.example.com/v2/"))).toBe(true);
    });
  });
});
