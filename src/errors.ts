/** Base class for all SDK errors. Catch this to handle any Advalidation error. */
export class AdvalidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvalidationError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/** Thrown when the API key is invalid or missing (HTTP 401). @see {@link AdvalidationError} */
export class AuthenticationError extends AdvalidationError {
  constructor(message = "Invalid or missing API key") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Thrown when input parameters are invalid (e.g. missing creative source or conflicting options). @see {@link AdvalidationError} */
export class InputError extends AdvalidationError {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

/** Thrown when the API returns a non-OK response. Exposes `status`, `type`, and raw `body`. @see {@link AdvalidationError} */
export class ApiError extends AdvalidationError {
  public readonly status: number;
  public readonly type: string | null;
  public readonly body: unknown;

  constructor(status: number, body: unknown) {
    const { message, type } = ApiError.parseBody(status, body);
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.body = body;
  }

  private static parseBody(
    status: number,
    body: unknown,
  ): { message: string; type: string | null } {
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as Record<string, unknown>).error === "object"
    ) {
      const error = (body as { error: { issues?: Array<{ type?: string; message?: string; relatedId?: string }> } }).error;
      const issue = error.issues?.[0];
      if (issue?.message) {
        const suffix = issue.relatedId ? ` (${issue.relatedId})` : "";
        return {
          message: `${issue.message}${suffix}`,
          type: issue.type ?? null,
        };
      }
    }
    return { message: `HTTP ${status}`, type: null };
  }
}

/** Thrown when the scan fails server-side during processing. @see {@link AdvalidationError} */
export class ScanFailedError extends AdvalidationError {
  constructor(message = "Scan processing failed") {
    super(message);
    this.name = "ScanFailedError";
  }
}

/** Thrown when the scan is cancelled server-side. @see {@link AdvalidationError} */
export class ScanCancelledError extends AdvalidationError {
  constructor(message = "Scan was cancelled") {
    super(message);
    this.name = "ScanCancelledError";
  }
}

/** Thrown when the scan does not complete within the configured timeout. @see {@link AdvalidationError} */
export class TimeoutError extends AdvalidationError {
  constructor(timeoutMs: number) {
    super(`Scan did not complete within ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

/** Thrown when the API rate-limits requests after multiple retries. @see {@link AdvalidationError} */
export class RateLimitError extends AdvalidationError {
  constructor() {
    super("Rate limited after multiple retries");
    this.name = "RateLimitError";
  }
}

/** Thrown when the operation is aborted via an `AbortSignal`. @see {@link AdvalidationError} */
export class AbortError extends AdvalidationError {
  constructor() {
    super("Operation was aborted");
    this.name = "AbortError";
  }
}
