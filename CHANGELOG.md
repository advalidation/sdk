# Changelog

## 1.0.0

Initial release.

- Single-call validation: `client.validate()` handles the full workflow (resolve adspec, create campaign, upload, poll, build result)
- Summary and detailed result modes
- Fetch existing results with `client.getResults()`
- Three creative input types: URL, tag, file
- Target by campaign ID, adspec ID, or type
- Verbose progress output to stderr
- Detailed test tree output for VAST with variations and media files
- Error hierarchy: AuthenticationError, ApiError, InputError, TimeoutError, RateLimitError, ScanFailedError, ScanCancelledError, AbortError
- Dual output: ESM + CommonJS
- Zero runtime dependencies, requires Node >= 18
