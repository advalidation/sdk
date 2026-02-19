// --- Input types ---

type CreativeInput =
  | { url: string; file?: never; tag?: never; data?: never; fileName?: never }
  | { file: string; url?: never; tag?: never; data?: never; fileName?: never }
  | { tag: string; url?: never; file?: never; data?: never; fileName?: never }
  | { data: Buffer | Uint8Array; fileName?: string; url?: never; file?: never; tag?: never };

interface ValidateOptions {
  /** Ad specification ID - determines type and thresholds */
  spec?: string;
  /** Use the default ad specification for this type */
  type?: "display" | "video";
  /** Existing campaign ID — skip campaign creation, adspec is inherited from the campaign */
  campaign?: number;
  /** Campaign name (auto-generated if omitted) */
  name?: string;
  /** Polling timeout in ms (default: 300_000 = 5 min) */
  timeout?: number;
  /** Standard AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Log progress to console (default: false) */
  verbose?: boolean;
  /**
   * Fetch full test breakdown including VAST variations and media files.
   * Requires additional API calls. Default: `false`.
   *
   * @example
   * // Summary mode (default) — fast, no extra API calls
   * const result = await client.validate({ url: '...', type: 'video' });
   * console.log(result.passed, result.issues);
   *
   * @example
   * // Detailed mode — full test results, media files, variations
   * const result = await client.validate({ url: '...', type: 'video', details: true });
   * console.log(result.tests); // full test breakdown
   */
  details?: boolean;
}

/**
 * Input for {@link Advalidation.validate}.
 *
 * Combines exactly one creative source (`url`, `file`, `tag`, or `data`) with
 * exactly one targeting option (`spec`, `type`, or `campaign`) plus
 * optional overrides for timeout, naming, and cancellation.
 */
export type ValidateInput = CreativeInput & ValidateOptions;

interface SubmitOptions {
  /** Ad specification ID - determines type and thresholds */
  spec?: string;
  /** Use the default ad specification for this type */
  type?: "display" | "video";
  /** Existing campaign ID — skip campaign creation, adspec is inherited from the campaign */
  campaign?: number;
  /** Campaign name (auto-generated if omitted) */
  name?: string;
  /** Standard AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Log progress to console (default: false) */
  verbose?: boolean;
}

/**
 * Input for {@link Advalidation.submit}.
 *
 * Same creative and targeting options as {@link ValidateInput}, but without
 * `timeout` and `details` (no polling is performed).
 *
 * @example
 * const { creativeId } = await client.submit({
 *   url: 'https://example.com/vast.xml',
 *   type: 'video',
 * });
 */
export type SubmitInput = CreativeInput & SubmitOptions;

/**
 * Result of {@link Advalidation.submit} — the IDs needed to poll with {@link Advalidation.getResults}.
 */
export interface SubmitResult {
  /** Campaign the creative was uploaded to. */
  campaignId: number;
  /** Creative that was submitted for scanning. */
  creativeId: number;
}

/**
 * Discriminated union returned by {@link Advalidation.getResults}.
 *
 * Check the `status` field before accessing result properties:
 * - `"finished"` — scan complete, all {@link ValidationResult} fields are available.
 * - `"pending"` — scan is queued or in progress, poll again later.
 * - `"failed"` — scan failed (server-side error).
 * - `"cancelled"` — scan was cancelled.
 *
 * @example
 * const response = await client.getResults(creativeId);
 * if (response.status === 'finished') {
 *   console.log(response.passed, response.issues);
 * }
 */
export type GetResultsResponse =
  | { status: "pending"; creativeId: number }
  | { status: "failed"; creativeId: number }
  | { status: "cancelled"; creativeId: number }
  | (ValidationResult & { status: "finished" });

// --- Result types ---

/**
 * Result of a creative validation scan.
 *
 * The structure depends on the creative type:
 * - **Standard (display/video):** `tests` is populated; `mediaFiles` and `variations` are `[]`.
 * - **VAST without variations:** `tests` has the parent-level results; `mediaFiles` has child video files.
 * - **VAST with variations:** `tests` is `[]`; `variations` contains each variation with its own tests and media files.
 */
export interface ValidationResult {
  /** Campaign the creative belongs to. */
  campaignId: number;
  /** Creative that was scanned. */
  creativeId: number;
  /** Scan run ID. */
  scanId: number;
  /** `true` when `issues === 0`. */
  passed: boolean;
  /** Direct link to the full visual report in the Advalidation web UI. */
  reportUrl: string;
  /** Total number of failed tests across all levels (top-level + media files/variations). */
  issues: number;
  /** Top-level test results. Empty `[]` for VAST with variations. */
  tests: Test[];
  /** Child video files for VAST without variations. Empty `[]` otherwise. */
  mediaFiles: MediaFile[];
  /** VAST variations, each with its own tests and media files. Empty `[]` for non-VAST creatives. */
  variations: Variation[];
}

/** A single check result from a scan. */
export interface Test {
  /** The internal test identifier, e.g. `"Test_Video_Duration"`. */
  name: string;
  /** Raw measured value. Number, string, boolean, or null depending on test type. */
  value: string | number | boolean | null;
  /** Human-readable value, e.g. `"15 seconds"` or `"3810 kb"`. Null when no formatted representation exists. */
  valueFormatted: string | null;
  /** Whether this test passed the ad spec threshold. */
  result: "pass" | "fail" | "warn";
  /**
   * The ad spec threshold this test was judged against,
   * e.g. `"6.00 seconds, 10.00 seconds, 15.00 seconds"`.
   * Null when the test has no configurable threshold (binary pass/fail checks).
   */
  spec: string | null;
}

/** A VAST variation — a distinct creative version within a VAST wrapper. */
export interface Variation {
  /** Creative ID for this variation (not the parent VAST creative). */
  creativeId: number;
  /** Human-readable label from the VAST XML, e.g. `"Variation A"`. */
  label: string;
  /** Sum of failed tests across this variation's tests and its media files. */
  issues: number;
  /** Test results for this variation. */
  tests: Test[];
  /** Child video files belonging to this variation. */
  mediaFiles: MediaFile[];
}

/** A child video file within a VAST creative. */
export interface MediaFile {
  /** ID of the media file creative (not the parent VAST creative). */
  creativeId: number;
  /** Scan run ID for this media file. */
  scanId: number;
  /** Count of failed tests for this media file only. */
  issues: number;
  /** Test results for this media file. */
  tests: Test[];
}

// --- AdSpec types ---

/** An ad specification that defines which tests to run and their thresholds. */
export interface AdSpec {
  /** Unique ad specification ID. */
  id: number;
  /** Ad specification name as shown in the Advalidation UI. */
  name: string;
  /** Creative type this ad spec applies to. */
  type: "display" | "video";
  /** Whether this is the default ad spec for its type. */
  isDefault: boolean;
  /** Enabled tests in this ad specification. */
  tests: AdSpecTest[];
}

/** A single test definition within an ad specification. */
export interface AdSpecTest {
  /** Test identifier, e.g. `"Test_Video_Resolution"`. */
  name: string;
  /** Human-readable threshold, e.g. `"29.970 FPS, 25 FPS"`. `null` if no threshold. */
  conditionsString: string | null;
}

// --- API response types (internal) ---

export interface ApiListResponse<T> {
  meta: {
    pagination: {
      count: number;
      totalCount: number;
      page: number;
      totalPages: number;
    };
  };
  data: T[];
}

export interface ApiSingleResponse<T> {
  data: T;
}

export interface ApiAdSpecification {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string | null;
  type: "display" | "video";
  shareURL: string;
  isDefault: boolean;
  isPublic: boolean;
  tests: ApiAdSpecificationTest[];
}

export interface ApiAdSpecificationTest {
  name: string;
  evaluationExpression: unknown;
  conditionsString: string | null;
  conditionsTemplate: unknown;
  enabled: boolean;
  attributes: unknown[];
}

export interface ApiCampaign {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  type: string;
  shareURL: string;
  adspecId: number;
  userId: number;
}

export interface ApiCreative {
  id: number;
  campaignId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  parentId: number | null;
  sourceType: string;
  sourceTypeLabel: string;
  shareURL: string;
  livePreviewURL: string;
  previewAnimationURL: string | null;
  width: number | null;
  height: number | null;
  userId: number;
  nbVariations: number | null;
  nbMediaFiles: number | null;
  latestScanStatus: ApiScan | null;
}

export interface ApiScan {
  id: number;
  createdAt: string;
  updatedAt: string | null;
  finishedAt: string | null;
  sequenceType: string;
  nbIssues: number | null;
  tests: ApiCheckResult[] | null;
  processingStatus: string;
  isInconclusive: boolean | null;
  inconclusiveReason: string | null;
}

export interface ApiCheckResult {
  name: string;
  value: string | number | boolean | null;
  valueFormatted: string;
  valuePhrase: string;
  result: "pass" | "fail" | "warn";
  attributes: ApiCheckResultProperty[];
  extended: unknown;
}

export interface ApiCheckResultProperty {
  name: string;
  description: string;
  value: string;
}

export interface ApiCreativeVariation {
  id: number;
  createdAt: string;
  updatedAt: string;
  creativeId: number;
  label: string;
  nbObservations: number;
  vastAdExtId: string;
  vastCreativeExtId: string;
}
