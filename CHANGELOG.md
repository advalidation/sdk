# Changelog

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
