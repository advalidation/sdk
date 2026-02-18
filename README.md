# Advalidation TypeScript SDK

TypeScript SDK for the [Advalidation](https://advalidation.com) API. Upload a creative, get a full compliance report — pass/fail, issue breakdown, and a shareable report link. One call, all results.

Creatives run on real browsers in the cloud. The API measures what actually happens, not just what the files declare.

**Video and VAST** — audio volume (LKFS/LUFS), duration, bitrate, resolution, frame rate, chroma subsampling, required renditions, creative rotation, VAST structure, tracking pixels, blocking/monitoring tags and more.

**Display** — CPU usage, load time, true file size, dimensions, SSL compliance, tracking pixels, click-through validation and more.

Zero runtime dependencies. Just `fetch` and your API key.

Questions, need an API key, or want to discuss integration? Email us at [hello@advalidation.com](mailto:hello@advalidation.com)

## Install

This package is not yet published to npm. Install directly from GitHub:

```
npm install github:advalidation/sdk
```

## Quick start

```ts
import { Advalidation } from "advalidation";

const client = new Advalidation({ apiKey: "your-api-key" });

const result = await client.validate({
  url: "https://rtr.innovid.com/r1.66f3e735e66ba5.38642747;cb=[timestamp]",
  type: "video",
});

console.log(result.passed);    // true or false
console.log(result.issues);    // number of failed tests
console.log(result.reportUrl); // link to the full visual report
```

## Authentication

```ts
// Pass directly
const client = new Advalidation({
  apiKey: "your-api-key",
  baseUrl: "https://app.advalidation.io", // optional, this is the default
});

// Or use environment variables (ADVALIDATION_API_KEY, ADVALIDATION_BASE_URL)
const client = new Advalidation();
```

Constructor options take precedence over environment variables.  `baseUrl` defaults to `https://app.advalidation.io`.

## Summary vs detailed results

By default, `validate()` and `getResults()` return a **summary** with pass/fail, issue count, and report URL — no extra API calls beyond what's needed for scanning.

```ts
const result = await client.validate({ url: "https://example.com/ad.html", type: "display" });
console.log(result.passed);    // true
console.log(result.issues);    // 0
console.log(result.reportUrl); // "https://app.advalidation.io/share/..."
console.log(result.tests);     // [] (empty in summary mode)
```

Pass `details: true` to fetch the full test breakdown, including individual test results, VAST media files, and variations. This requires additional API calls (20+ for complex VAST creatives).

```ts
const result = await client.validate({
  url: "https://example.com/vast.xml",
  type: "video",
  details: true,
});
console.log(result.tests);      // full test results
console.log(result.mediaFiles); // VAST media files with their tests
```

You can also start with a summary and fetch details later using `getResults()`:

```ts
// Fast CI gate — summary only
const summary = await client.validate({ url: "https://example.com/ad.html", type: "display" });

if (!summary.passed) {
  // Fetch full details for the failure report
  const detailed = await client.getResults(summary.creativeId, { details: true });
  console.log(detailed.tests);
}
```

## Fetch existing results

Already have a creative ID from a previous run or the Advalidation UI? Skip the upload and poll:

```ts
const result = await client.getResults(creativeId);
const detailed = await client.getResults(creativeId, { details: true });
```

| Option    | Type      | Default | Description                                      |
|-----------|-----------|---------|--------------------------------------------------|
| `verbose` | `boolean` | `false` | Log progress to console.                         |
| `details` | `boolean` | `false` | Fetch full test breakdown including VAST variations and media files. |

## Creative input types

Exactly one of `url`, `tag`, `file`, or `data` must be provided.

**URL** — hosted creative, VAST XML endpoint, or ad tag URL. The file is fetched server-side by Advalidation, so there is no upload size limit.

```ts
await client.validate({ url: "https://example.com/ad.html", type: "display" });
```

**Tag** — raw HTML/JavaScript ad tag or VAST XML string.

```ts
await client.validate({ tag: "<script src='https://example.com/ad.js'></script>", type: "display" });
```

**File** — local file path. Supports ZIP archives, images, video files, and HTML files. Uploads are limited to **16 MB** — use `url` instead for larger files.

```ts
await client.validate({ file: "/path/to/video.mp4", type: "video" });
```

**Data** — raw bytes as `Buffer` or `Uint8Array`. Use this when you already have the file contents in memory (e.g. from S3, a database, or an HTTP response). Optional `fileName` sets the `X-Filename` header; the API defaults to `API-Upload-{timestamp}` when omitted. Same **16 MB** upload limit as `file`.

```ts
const buffer = await fs.readFile("/path/to/video.mp4");
await client.validate({ data: buffer, fileName: "video.mp4", type: "video" });
```

> **Note:** The creative must match the campaign type. Uploading a video file against a `type: "display"` spec (or vice versa) will fail with an `ApiError`.

## Target options

Every validation needs to know where to put the creative and which ad specification to use. Provide exactly one of `campaign`, `spec`, or `type`.

**Existing campaign** - upload into an existing campaign (adspec is inherited):

```ts
await client.validate({ url: "https://example.com/ad.html", campaign: 12345 });
```

**By spec ID** - use a specific ad specification (creates a new campaign):

```ts
await client.validate({ url: "https://example.com/ad.html", spec: "123" });
```

**By type** - use the default ad specification for a type (creates a new campaign):

```ts
await client.validate({ url: "https://example.com/ad.html", type: "display" });
await client.validate({ url: "https://example.com/ad.html", type: "video" });
```

> **Note:** `type` resolves to whichever ad specification is marked as default for that type in the Advalidation UI. If the default is changed in the UI, subsequent SDK runs will use the new one. Use `spec` with an explicit ID if you need a pinned ad specification.

## Options reference

All options are passed in the same object as the creative input.

| Field     | Type                       | Default   | Description                                      |
|-----------|----------------------------|-----------|--------------------------------------------------|
| `url`     | `string`                   | -         | URL of the hosted creative. Mutually exclusive with `file`, `tag`, and `data`. |
| `file`    | `string`                   | -         | Local file path. Mutually exclusive with `url`, `tag`, and `data`. |
| `tag`     | `string`                   | -         | Raw ad tag markup. Mutually exclusive with `url`, `file`, and `data`. |
| `data`    | `Buffer \| Uint8Array`     | -         | Raw file bytes. Mutually exclusive with `url`, `file`, and `tag`. |
| `fileName`| `string`                   | -         | Filename sent with `data` uploads. Only used with `data`. |
| `campaign`| `number`                   | -         | Existing campaign ID. Adspec is inherited. Mutually exclusive with `spec` and `type`. |
| `spec`    | `string`                   | -         | Ad specification ID. Creates a new campaign. Mutually exclusive with `campaign` and `type`. |
| `type`    | `"display" \| "video"`     | -         | Use the default ad specification for this type. Creates a new campaign. Mutually exclusive with `campaign` and `spec`. |
| `name`    | `string`                   | auto      | Campaign name. Auto-generated from the input if omitted. |
| `timeout` | `number`                   | `300000`  | Polling timeout in milliseconds (default 5 minutes). |
| `signal`  | `AbortSignal`              | -         | Standard `AbortSignal` for cancellation.         |
| `verbose` | `boolean`                  | `false`   | Log progress messages to console.                |
| `details` | `boolean`                  | `false`   | Fetch full test breakdown including VAST variations and media files. |

## Result shape

```ts
interface ValidationResult {
  campaignId: number;
  creativeId: number;
  scanId: number;
  passed: boolean;        // true if zero issues
  reportUrl: string;      // link to the full visual report
  issues: number;         // count of failed tests
  tests: Test[];          // test results for this creative
  mediaFiles: MediaFile[]; // VAST child video files (non-variation VAST only)
  variations: Variation[]; // VAST variations (multi-variation VAST only)
}

interface Test {
  name: string;                              // test identifier
  value: string | number | boolean | null;   // measured value
  valueFormatted: string | null;             // human-readable value
  result: "pass" | "fail" | "warn";          // outcome
  spec: string | null;                       // threshold from the adspec
}
```

For non-VAST creatives, `tests` has the results and both `mediaFiles` and `variations` are empty. For VAST creatives the result is nested:

```ts
// VAST without variations — media files at the top level
result.mediaFiles[0].tests          // tests for the first video rendition
result.mediaFiles[0].issues         // failed test count for that rendition

// VAST with variations — variations contain media files
result.variations[0].label          // "Variation A"
result.variations[0].mediaFiles[0].tests  // tests for that rendition
```

## Verbose output

Pass `verbose: true` to see progress in the console. In summary mode (default):

```
Resolving ad specification... (type: video) -> "Video" (27 tests) (466ms)
Creating campaign... (id: 199546) (88ms)
Uploading creative... (url) (112ms)
Polling for results... (attempt 1, status: processing)
Polling for results... (attempt 2, status: finished)
Done. 32 issues found. https://app2.advalidation.io/share/abc123 — 5 requests, total: (26.1s)
```

With `details: true`, the full test tree is included. Here's a real VAST creative with 2 variations and 11 renditions each:

```
Resolving ad specification... (type: video) -> "Video" (27 tests) (466ms)
Creating campaign... (id: 199546) (88ms)
Uploading creative... (url) (112ms)
Polling for results... (attempt 1, status: processing)
Polling for results... (attempt 2, status: finished)
Scan complete. Building results...
Creative #1561936 — 0 tests, 32 issues total
├── Variation "Variation A" #1561937 — 10 tests (2 fail)
│   ✗ Test_Video_VastSkipDetection: Not skippable
│   ✗ Test_Video_VastConnectionRules: 19 violations
│   ├── Media file #1561938 640x360 — 12 tests (2 fail, 1 warn)
│   │   ✗ Test_Video_AudioAverage: -26.70 LUFS [-23 +/- 1 LUFS]
│   │   ✗ Test_Video_ChromaSubsampling: 4:2:0 [4:2:2]
│   ├── Media file #1561941 1280x720 — 12 tests (2 fail)
│   │   ✗ Test_Video_AudioAverage: -26.70 LUFS [-23 +/- 1 LUFS]
│   │   ✗ Test_Video_ChromaSubsampling: 4:2:0 [4:2:2]
│   ├── ...8 more media files...
│   └── Media file #1561948 640x480 — 12 tests (3 fail)
│       ✗ Test_Video_AudioAverage: -26.70 LUFS [-23 +/- 1 LUFS]
│       ✗ Test_Video_ChromaSubsampling: 4:2:0 [4:2:2]
│       ✗ Test_Video_Boxing: Letterboxing (25%) [Letter/pillar/window boxing not allowed]
└── Variation "Variation B" #1561949 — 10 tests (2 fail)
    ✗ Test_Video_VastSkipDetection: Not skippable
    ✗ Test_Video_VastConnectionRules: 19 violations
    ├── Media file #1561950 640x360 — 12 tests (2 fail)
    │   ✗ Test_Video_Fps: 30 FPS [29.970 FPS, 23.976 FPS, 25 FPS]
    │   ✗ Test_Video_ChromaSubsampling: 4:2:0 [4:2:2]
    ├── ...9 more media files...
    └── Media file #1561960 640x480 — 12 tests (2 fail)
        ✗ Test_Video_ChromaSubsampling: 4:2:0 [4:2:2]
        ✗ Test_Video_Boxing: Letterboxing (25%) [Letter/pillar/window boxing not allowed]
Done. 32 issues found. 33 requests, total: (40.5s)
```

Verbose output goes to `stderr` so it won't interfere when piping `stdout` to a file.

## Error handling

All errors extend `AdvalidationError`.

| Error class          | When thrown                                                  |
|----------------------|--------------------------------------------------------------|
| `AuthenticationError`| API returns 401 (invalid or missing API key).                |
| `InputError`         | Invalid parameters (missing input, both `spec` and `type` provided, etc). |
| `ApiError`           | API returns a non-401 error. Has `status` and `body` properties. |
| `RateLimitError`     | Rate limited after 5 retries with jittered backoff. The API allows ~60 req/min per IP. Has `attempts` property. |
| `ScanFailedError`    | The scan finished with a `failed` status.                    |
| `ScanCancelledError` | The scan was cancelled.                                      |
| `TimeoutError`       | Scan did not complete within the timeout period.             |
| `AbortError`         | The operation was aborted via the provided `AbortSignal`.    |

```ts
import {
  Advalidation,
  AuthenticationError,
  InputError,
  ApiError,
  TimeoutError,
} from "advalidation";

try {
  const result = await client.validate({
    url: "https://example.com/ad.html",
    type: "display",
  });
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error("Bad API key");
  } else if (error instanceof InputError) {
    console.error("Invalid input:", error.message);
  } else if (error instanceof ApiError) {
    console.error(`API error ${error.status}:`, error.body);
  } else if (error instanceof TimeoutError) {
    console.error("Scan timed out");
  }
}
```

## Requirements

- Node.js >= 18 (uses native `fetch`)
- Zero runtime dependencies
