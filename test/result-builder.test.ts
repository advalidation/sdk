import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildResult } from "../src/result-builder.js";
import { HttpClient } from "../src/http.js";
import type { AdSpec, ApiCreative, ApiScan } from "../src/types.js";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createHttpClient(): HttpClient {
  return new HttpClient({ apiKey: "test-key", baseUrl: "https://app.advalidation.io/v2" });
}

// --- Fixtures ---

const ADSPEC: AdSpec = {
  id: 42,
  name: "Test Spec",
  type: "display",
  isDefault: true,
  tests: [
    { name: "Test_Display_Filesize", conditionsString: "150 KB" },
    { name: "Test_Display_Dimensions", conditionsString: "300x250" },
    { name: "Test_Display_SslCompliance", conditionsString: null },
  ],
};

const VIDEO_ADSPEC: AdSpec = {
  id: 43,
  name: "Video Spec",
  type: "video",
  isDefault: true,
  tests: [
    { name: "Test_Video_Duration", conditionsString: "15.00 seconds, 30.00 seconds" },
    { name: "Test_Video_Filesize", conditionsString: "2 MB" },
    { name: "Test_Video_VastVersion", conditionsString: "VAST 4.0, VAST 4.1, VAST 4.2" },
  ],
};

function makeScan(overrides: Partial<ApiScan> = {}): ApiScan {
  return {
    id: 300,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    finishedAt: "2024-01-01T00:00:01Z",
    sequenceType: "initial",
    nbIssues: 0,
    processingStatus: "finished",
    isInconclusive: false,
    inconclusiveReason: null,
    tests: null,
    ...overrides,
  };
}

function makeCreative(overrides: Partial<ApiCreative> = {}): ApiCreative {
  return {
    id: 200,
    campaignId: 100,
    name: "test-creative",
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
    latestScanStatus: makeScan(),
    ...overrides,
  };
}

// --- Tests ---

describe("buildResult", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Path 1: single scan (display)", () => {
    it("maps tests with adspec thresholds", async () => {
      const scanResponse = {
        data: makeScan({
          tests: [
            {
              name: "Test_Display_Filesize",
              value: "120000",
              valueFormatted: "120 KB",
              valuePhrase: "File size is 120 KB",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
            {
              name: "Test_Display_Dimensions",
              value: "300x250",
              valueFormatted: "300x250",
              valuePhrase: "Dimensions are 300x250",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
            {
              name: "Test_Display_SslCompliance",
              value: "true",
              valueFormatted: "SSL compliant",
              valuePhrase: "All resources are SSL compliant",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(jsonResponse(scanResponse));

      const http = createHttpClient();
      const creative = makeCreative();
      const result = await buildResult(http, creative, ADSPEC);

      expect(result.campaignId).toBe(100);
      expect(result.creativeId).toBe(200);
      expect(result.scanId).toBe(300);
      expect(result.passed).toBe(true);
      expect(result.issues).toBe(0);
      expect(result.tests).toHaveLength(3);

      // Check threshold merging
      expect(result.tests[0].name).toBe("Test_Display_Filesize");
      expect(result.tests[0].spec).toBe("150 KB");
      expect(result.tests[0].valueFormatted).toBe("120 KB");

      expect(result.tests[1].name).toBe("Test_Display_Dimensions");
      expect(result.tests[1].spec).toBe("300x250");

      // No conditionsString for SSL compliance
      expect(result.tests[2].name).toBe("Test_Display_SslCompliance");
      expect(result.tests[2].spec).toBeNull();

      expect(result.mediaFiles).toEqual([]);
      expect(result.variations).toEqual([]);
    });

    it("marks result as failed when there are issues", async () => {
      const scanResponse = {
        data: makeScan({
          nbIssues: 1,
          tests: [
            {
              name: "Test_Display_Filesize",
              value: "200000",
              valueFormatted: "200 KB",
              valuePhrase: "File size is 200 KB",
              result: "fail" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(jsonResponse(scanResponse));

      const http = createHttpClient();
      const creative = makeCreative({
        latestScanStatus: makeScan({ nbIssues: 1 }),
      });
      const result = await buildResult(http, creative, ADSPEC);

      expect(result.passed).toBe(false);
      expect(result.issues).toBe(1);
      expect(result.tests[0].result).toBe("fail");
    });
  });

  describe("Path 1: single scan (video file)", () => {
    it("maps video tests with adspec thresholds", async () => {
      const scanResponse = {
        data: makeScan({
          id: 301,
          tests: [
            {
              name: "Test_Video_Duration",
              value: "15.04",
              valueFormatted: "15.04 seconds",
              valuePhrase: "Duration is 15.04 seconds",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
            {
              name: "Test_Video_Filesize",
              value: "1500000",
              valueFormatted: "1.5 MB",
              valuePhrase: "File size is 1.5 MB",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(jsonResponse(scanResponse));

      const http = createHttpClient();
      const creative = makeCreative({
        sourceType: "video-file",
        latestScanStatus: makeScan({ id: 301 }),
      });
      const result = await buildResult(http, creative, VIDEO_ADSPEC);

      expect(result.tests[0].spec).toBe("15.00 seconds, 30.00 seconds");
      expect(result.tests[1].spec).toBe("2 MB");
      expect(result.mediaFiles).toEqual([]);
    });
  });

  describe("Path 2: VAST without variations", () => {
    it("returns VAST tests and media file tests", async () => {
      const vastScanResponse = {
        data: makeScan({
          id: 300,
          tests: [
            {
              name: "Test_Video_VastVersion",
              value: "4.1",
              valueFormatted: "VAST 4.1",
              valuePhrase: "VAST version is 4.1",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      const mediaFilesResponse = {
        meta: { pagination: { count: 1, totalCount: 1, page: 1, totalPages: 1 } },
        data: [
          makeCreative({
            id: 201,
            parentId: 200,
            sourceType: "video-file",
            nbVariations: null,
            nbMediaFiles: null,
            latestScanStatus: makeScan({ id: 301 }),
          }),
        ],
      };

      const mediaFileScanResponse = {
        data: makeScan({
          id: 301,
          tests: [
            {
              name: "Test_Video_Duration",
              value: "30.02",
              valueFormatted: "30.02 seconds",
              valuePhrase: "Duration is 30.02 seconds",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      let fetchCallCount = 0;
      mockFetch.mockImplementation((url: string) => {
        fetchCallCount++;
        const urlStr = url.toString();

        if (urlStr.includes("/scans/300")) {
          return Promise.resolve(jsonResponse(vastScanResponse));
        }
        if (urlStr.includes("/media-files")) {
          return Promise.resolve(jsonResponse(mediaFilesResponse));
        }
        if (urlStr.includes("/scans/301")) {
          return Promise.resolve(jsonResponse(mediaFileScanResponse));
        }

        return Promise.resolve(jsonResponse({ error: "not found" }, 404));
      });

      const http = createHttpClient();
      const creative = makeCreative({
        nbMediaFiles: 1,
        latestScanStatus: makeScan({ id: 300 }),
      });
      const result = await buildResult(http, creative, VIDEO_ADSPEC);

      expect(result.tests).toHaveLength(1);
      expect(result.tests[0].name).toBe("Test_Video_VastVersion");
      expect(result.tests[0].spec).toBe("VAST 4.0, VAST 4.1, VAST 4.2");

      expect(result.mediaFiles).toHaveLength(1);
      expect(result.mediaFiles[0].creativeId).toBe(201);
      expect(result.mediaFiles[0].scanId).toBe(301);
      expect(result.mediaFiles[0].issues).toBe(0);
      expect(result.mediaFiles[0].tests).toHaveLength(1);
      expect(result.mediaFiles[0].tests[0].name).toBe("Test_Video_Duration");
      expect(result.mediaFiles[0].tests[0].spec).toBe("15.00 seconds, 30.00 seconds");

      expect(result.variations).toEqual([]);
    });
  });

  describe("Path 3: VAST with variations", () => {
    it("returns nested variation structure", async () => {
      const variationsListResponse = {
        meta: { pagination: { count: 1, totalCount: 1, page: 1, totalPages: 1 } },
        data: [
          {
            id: 1,
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-01T00:00:00Z",
            creativeId: 210,
            label: "Variation 1",
            nbObservations: 1,
            vastAdExtId: "ad-1",
            vastCreativeExtId: "creative-1",
          },
        ],
      };

      const variationDetailResponse = {
        meta: { pagination: { count: 2, totalCount: 2, page: 1, totalPages: 1 } },
        data: [
          // VAST XML creative
          makeCreative({
            id: 210,
            parentId: 200,
            sourceType: "vast-xml",
            nbVariations: null,
            nbMediaFiles: null,
            latestScanStatus: makeScan({ id: 310 }),
          }),
          // Video file (media file)
          makeCreative({
            id: 211,
            parentId: 210,
            sourceType: "video-file",
            nbVariations: null,
            nbMediaFiles: null,
            latestScanStatus: makeScan({ id: 311 }),
          }),
        ],
      };

      const vastXmlScanResponse = {
        data: makeScan({
          id: 310,
          tests: [
            {
              name: "Test_Video_VastVersion",
              value: "4.0",
              valueFormatted: "VAST 4.0",
              valuePhrase: "VAST version is 4.0",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      const videoScanResponse = {
        data: makeScan({
          id: 311,
          nbIssues: 1,
          tests: [
            {
              name: "Test_Video_Duration",
              value: "45.5",
              valueFormatted: "45.50 seconds",
              valuePhrase: "Duration is 45.50 seconds",
              result: "fail" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockImplementation((url: string) => {
        const urlStr = url.toString();

        if (urlStr.includes("/variations/210")) {
          return Promise.resolve(jsonResponse(variationDetailResponse));
        }
        if (urlStr.includes("/variations")) {
          return Promise.resolve(jsonResponse(variationsListResponse));
        }
        if (urlStr.includes("/scans/310")) {
          return Promise.resolve(jsonResponse(vastXmlScanResponse));
        }
        if (urlStr.includes("/scans/311")) {
          return Promise.resolve(jsonResponse(videoScanResponse));
        }

        return Promise.resolve(jsonResponse({ error: "not found" }, 404));
      });

      const http = createHttpClient();
      const creative = makeCreative({
        nbVariations: 1,
        latestScanStatus: makeScan({ id: 300, nbIssues: 1 }),
      });
      const result = await buildResult(http, creative, VIDEO_ADSPEC);

      expect(result.tests).toEqual([]);
      expect(result.mediaFiles).toEqual([]);

      expect(result.variations).toHaveLength(1);
      const variation = result.variations[0];
      expect(variation.creativeId).toBe(210);
      expect(variation.label).toBe("Variation 1");
      expect(variation.issues).toBe(1);
      expect(variation.tests).toHaveLength(1);
      expect(variation.tests[0].name).toBe("Test_Video_VastVersion");
      expect(variation.tests[0].spec).toBe("VAST 4.0, VAST 4.1, VAST 4.2");

      expect(variation.mediaFiles).toHaveLength(1);
      expect(variation.mediaFiles[0].creativeId).toBe(211);
      expect(variation.mediaFiles[0].scanId).toBe(311);
      expect(variation.mediaFiles[0].issues).toBe(1);
      expect(variation.mediaFiles[0].tests[0].result).toBe("fail");
      expect(variation.mediaFiles[0].tests[0].spec).toBe("15.00 seconds, 30.00 seconds");

      // Top-level issues from API's nbIssues (matches UI, accounts for media file matching)
      expect(result.passed).toBe(false);
      expect(result.issues).toBe(1);
    });
  });

  describe("conditionsString merging", () => {
    it("returns null spec for tests not in adspec", async () => {
      const scanResponse = {
        data: makeScan({
          tests: [
            {
              name: "Test_Unknown_Check",
              value: "something",
              valueFormatted: "something",
              valuePhrase: "Unknown check",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(jsonResponse(scanResponse));

      const http = createHttpClient();
      const creative = makeCreative();
      const result = await buildResult(http, creative, ADSPEC);

      expect(result.tests[0].spec).toBeNull();
    });

    it("parses numeric values correctly", async () => {
      const scanResponse = {
        data: makeScan({
          tests: [
            {
              name: "Test_Video_Duration",
              value: "15.04",
              valueFormatted: "15.04 seconds",
              valuePhrase: "Duration is 15.04 seconds",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(jsonResponse(scanResponse));

      const http = createHttpClient();
      const creative = makeCreative();
      const result = await buildResult(http, creative, VIDEO_ADSPEC);

      expect(result.tests[0].value).toBe(15.04);
    });

    it("parses boolean values correctly", async () => {
      const scanResponse = {
        data: makeScan({
          tests: [
            {
              name: "Test_Display_SslCompliance",
              value: "true",
              valueFormatted: "SSL compliant",
              valuePhrase: "All resources are SSL compliant",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(jsonResponse(scanResponse));

      const http = createHttpClient();
      const creative = makeCreative();
      const result = await buildResult(http, creative, ADSPEC);

      expect(result.tests[0].value).toBe(true);
    });

    it("preserves string values that are not numeric or boolean", async () => {
      const scanResponse = {
        data: makeScan({
          tests: [
            {
              name: "Test_Display_Dimensions",
              value: "300x250",
              valueFormatted: "300x250",
              valuePhrase: "Dimensions are 300x250",
              result: "pass" as const,
              attributes: [],
              extended: null,
            },
          ],
        }),
      };

      mockFetch.mockResolvedValue(jsonResponse(scanResponse));

      const http = createHttpClient();
      const creative = makeCreative();
      const result = await buildResult(http, creative, ADSPEC);

      expect(result.tests[0].value).toBe("300x250");
    });
  });
});
