import { AuthenticationError, ApiError, RateLimitError } from "./errors.js";
import { sleep } from "./sleep.js";

const RETRY_DELAYS = [1_000, 2_000, 4_000];

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly signal?: AbortSignal;
  private lock: Promise<void> = Promise.resolve();
  private _requestCount = 0;

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.signal = options.signal;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.lock;
    this.lock = next;
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
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
    return this.withLock(async () => {
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
          if (attempt >= RETRY_DELAYS.length) {
            throw new RateLimitError();
          }
          const jitter = Math.random() * RETRY_DELAYS[attempt];
          await sleep(RETRY_DELAYS[attempt] + jitter, this.signal);
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

        this._requestCount++;
        return response.json();
      }
    });
  }

  get requestCount(): number {
    return this._requestCount;
  }
}
