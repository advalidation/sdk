import { AuthenticationError, ApiError, RateLimitError } from "./errors.js";
import { sleep } from "./sleep.js";
import { RequestGate } from "./request-gate.js";

const RATE_LIMIT = {
  baseDelayMs: 1_000,
  maxDelayMs: 5_000,
  maxRetries: 5,
};

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
  gate?: RequestGate;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly signal?: AbortSignal;
  private readonly gate: RequestGate;
  private _requestCount = 0;

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.signal = options.signal;
    this.gate = options.gate ?? new RequestGate();
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: "GET" });
    return response as T;
  }

  async post<T>(
    path: string,
    body: unknown,
    contentType = "application/json",
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      ...extraHeaders,
    };

    let requestBody: string | Buffer | ArrayBuffer | Uint8Array;
    if (contentType === "application/json") {
      requestBody = JSON.stringify(body);
    } else {
      requestBody = body as Buffer | ArrayBuffer | Uint8Array;
    }

    const response = await this.request(path, {
      method: "POST",
      headers,
      body: requestBody,
    });
    return response as T;
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<unknown> {
    return this.gate.run(async () => {
      const url = `${this.baseUrl}${path}`;

      const headers = new Headers(init.headers);
      headers.set("X-API-Key", this.apiKey);
      headers.set("Accept", "application/json");

      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, {
          ...init,
          headers,
          signal: this.signal,
        });

        if (response.status === 429) {
          this.gate.activateBackoff();
          if (attempt >= RATE_LIMIT.maxRetries) {
            throw new RateLimitError(RATE_LIMIT.maxRetries);
          }
          const maxDelay = Math.min(
            RATE_LIMIT.baseDelayMs * (attempt + 1),
            RATE_LIMIT.maxDelayMs,
          );
          const delay = Math.random() * maxDelay;
          await sleep(delay, this.signal);
          continue;
        }

        if (response.status === 401) {
          throw new AuthenticationError();
        }

        if (!response.ok) {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            body = await response.text();
          }
          throw new ApiError(response.status, body);
        }

        this.gate.updateFromHeaders(response.headers);
        this._requestCount++;
        return response.json();
      }
    }, this.signal);
  }

  get requestCount(): number {
    return this._requestCount;
  }
}
