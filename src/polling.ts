import { HttpClient } from "./http.js";
import {
  ScanFailedError,
  ScanCancelledError,
  TimeoutError,
  AbortError,
} from "./errors.js";
import { sleep } from "./sleep.js";
import type { ApiCreative, ApiSingleResponse } from "./types.js";

/** Polling schedule in ms: 5s first, then every 20s */
const INITIAL_DELAY = 5_000;
const POLL_INTERVAL = 20_000;

function getDelay(attempt: number): number {
  return attempt === 0 ? INITIAL_DELAY : POLL_INTERVAL;
}

export interface PollOptions {
  timeout: number;
  signal?: AbortSignal;
  log?: (msg: string) => void;
}

export async function pollUntilDone(
  http: HttpClient,
  creativeId: number,
  options: PollOptions,
): Promise<ApiCreative> {
  const { timeout, signal, log } = options;
  const deadline = Date.now() + timeout;
  const pollStart = Date.now();
  let attempt = 0;

  while (true) {
    const delay = getDelay(attempt);
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      throw new TimeoutError(timeout);
    }

    const waitMs = Math.min(delay, remaining);
    log?.(`Waiting ${formatDelay(waitMs)} for scan to process...`);
    await sleep(waitMs, signal);

    if (signal?.aborted) {
      throw new AbortError();
    }

    const response = await http.get<ApiSingleResponse<ApiCreative>>(
      `/creatives/${creativeId}`,
    );
    const creative = response.data;
    const status = creative.latestScanStatus?.processingStatus;
    const elapsed = ((Date.now() - pollStart) / 1000).toFixed(1);

    log?.(`Polling for results... (attempt ${attempt + 1}, status: ${status}) (${elapsed}s)`);

    switch (status) {
      case "finished":
        return creative;
      case "failed":
        throw new ScanFailedError();
      case "cancelled":
        throw new ScanCancelledError();
      case "queued":
      case "processing":
        break;
      default:
        break;
    }

    attempt++;
  }
}

function formatDelay(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

