# Changelog

## 1.3.0

### Added

- **`submit()` method** -- split workflow that submits a creative without polling, returns `{ campaignId, creativeId }`.
- `SubmitInput`, `SubmitResult`, `GetResultsResponse` types.

### Changed

- `getResults()` now returns `GetResultsResponse` (discriminated union with `status` field) instead of `ValidationResult`. Check `response.status === "finished"` before accessing result fields.

### Fixed

- `getResults()` no longer crashes when the scan hasn't finished (removed non-null assertion on nullable `latestScanStatus`).

## 1.2.2

### Fixed

- **Repository URL** — corrected `package.json` repository URL to point to the public repo.

## 1.2.1

### Fixed

- **Default base URL** — corrected from `app.advalidation.com` to `app.advalidation.io`.
- **Non-JSON error responses** — API errors returning HTML (e.g. 404 pages) no longer crash with `TypeError: Body is unusable`. The SDK now reads the body once as text, then tries JSON.parse.

## 1.2.0

### Added

- **`data` input type** — pass a `Buffer` or `Uint8Array` directly to `validate()` instead of a file path. Useful when you already have bytes in memory (from S3, a database, HTTP response, etc.). Optional `fileName` sets the server-side filename.

## 1.1.0

### Added

- **Shared request gate** — all requests from one `Advalidation` instance serialize through a single lock, preventing concurrent bursts that would instantly exhaust the API's 15-request bucket.
- **Proactive backpressure** — reads `X-RateLimit-IPRemaining` from API responses; when tokens run low, inserts 1s delays between requests to match the server's refill rate. Prevents 429s before they happen.
- **Jittered 429 retry** — if rate-limited despite backpressure (e.g. multiple processes sharing an IP), retries with linear backoff and full jitter, up to 5 attempts.
- `RateLimitError` now includes an `attempts` property and an actionable error message.

### Fixed

- Ignored the broken `Retry-After` header (always sends `15`, the bucket size, not actual wait seconds). Previous behavior would sleep exactly 15s on every 429 and retry simultaneously — classic thundering herd.

## 1.0.0

Initial public release.
