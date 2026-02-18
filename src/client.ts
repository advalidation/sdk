import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { HttpClient } from "./http.js";
import { RequestGate } from "./request-gate.js";
import { InputError, AbortError } from "./errors.js";
import { pollUntilDone } from "./polling.js";
import { buildResult } from "./result-builder.js";
import type {
  ValidateInput,
  ValidationResult,
  AdSpec,
  ApiAdSpecification,
  ApiCampaign,
  ApiCreative,
  ApiListResponse,
  ApiSingleResponse,
} from "./types.js";

const DEFAULT_TIMEOUT = 300_000;
const DEFAULT_BASE_URL = "https://app.advalidation.io";

interface AdvalidationOptions {
  /** API key for authentication. Falls back to `ADVALIDATION_API_KEY` env var. */
  apiKey?: string;
  /**
   * Base URL of the Advalidation instance (e.g. `https://app.advalidation.io`).
   * Falls back to `ADVALIDATION_BASE_URL` env var, then the default `https://app.advalidation.io`.
   * The SDK appends `/v2` internally — provide the app URL only.
   */
  baseUrl?: string;
}

/**
 * Advalidation SDK client.
 *
 * Create an instance with your API key, then call {@link validate} to upload
 * and scan a creative, or {@link getResults} to fetch results for an existing creative.
 *
 * @example
 * const client = new Advalidation({ apiKey: 'your-api-key' });
 * const result = await client.validate({ url: 'https://example.com/ad.mp4', type: 'video' });
 */
export class Advalidation {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly gate = new RequestGate();

  /**
   * API key can also be set via the `ADVALIDATION_API_KEY` environment variable.
   * Base URL can also be set via the `ADVALIDATION_BASE_URL` environment variable.
   */
  constructor(options?: AdvalidationOptions) {
    const key = options?.apiKey ?? process.env.ADVALIDATION_API_KEY;
    if (!key) {
      throw new InputError(
        "API key is required. Pass it as apiKey option or set ADVALIDATION_API_KEY environment variable.",
      );
    }
    this.apiKey = key;
    this.baseUrl = (
      options?.baseUrl ??
      process.env.ADVALIDATION_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, "");
  }

  /**
   * Upload a creative, poll until scanning completes, and return validation results.
   *
   * @example
   * const result = await client.validate({
   *   url: 'https://example.com/vast.xml',
   *   type: 'video',
   * });
   *
   * @see getResults
   */
  async validate(input: ValidateInput): Promise<ValidationResult> {
    validateParams(input);

    const { signal, timeout = DEFAULT_TIMEOUT, name, spec, type, campaign, verbose, details = false, ...creative } = input;
    const totalStart = Date.now();
    const log = verbose
      ? (msg: string) => console.error(msg)
      : undefined;

    if (signal?.aborted) {
      throw new AbortError();
    }

    const http = new HttpClient({
      apiKey: this.apiKey,
      baseUrl: `${this.baseUrl}/v2`,
      signal,
      gate: this.gate,
    });

    let campaignId: number;
    let adspec: AdSpec;
    let t = Date.now();

    if (campaign) {
      const existing = await fetchCampaign(http, campaign);
      campaignId = existing.id;
      adspec = await resolveAdSpec(http, { spec: String(existing.adspecId) });
      log?.(`Using existing campaign ${campaignId} -> adspec "${adspec.name}" (${adspec.tests.length} tests) ${ms(t)}`);
    } else {
      adspec = await resolveAdSpec(http, { spec, type });
      log?.(`Resolving ad specification... (${spec ? `id: ${spec}` : `type: ${type}`}) -> "${adspec.name}" (${adspec.tests.length} tests) ${ms(t)}`);

      t = Date.now();
      const campaignName = name ?? generateCampaignName(creative);
      const newCampaign = await createCampaign(
        http,
        campaignName,
        adspec.type,
        adspec.id,
      );
      campaignId = newCampaign.id;
      log?.(`Creating campaign... (id: ${campaignId}) ${ms(t)}`);
    }

    t = Date.now();
    const inputType = "url" in creative && creative.url ? "url" : "file" in creative && creative.file ? "file" : "data" in creative && creative.data ? "data" : "tag";
    const creativeResponse = await uploadCreative(http, campaignId, creative);
    log?.(`Uploading creative... (${inputType}) ${ms(t)}`);

    const finishedCreative = await pollUntilDone(http, creativeResponse.id, {
      timeout,
      signal,
      log,
    });

    if (details) {
      t = Date.now();
      log?.(`Scan complete. Building results...`);
      const result = await buildResult(http, finishedCreative, adspec, log);
      const summary = result.issues > 0 ? `${result.issues} issues found.` : "All tests passed.";
      log?.(`Done. ${summary} ${http.requestCount} requests, total: ${ms(totalStart)}`);
      return result;
    }

    const result = buildSummaryResult(finishedCreative);
    const summary = result.issues > 0 ? `${result.issues} issues found.` : "All tests passed.";
    log?.(`Done. ${summary} ${result.reportUrl} — ${http.requestCount} requests, total: ${ms(totalStart)}`);
    return result;
  }

  /**
   * Fetch validation results for a previously scanned creative.
   *
   * @example
   * // Summary (default)
   * const result = await client.getResults(12345);
   *
   * @example
   * // Full test breakdown
   * const result = await client.getResults(12345, { details: true });
   *
   * @see validate
   */
  async getResults(
    creativeId: number,
    options?: { verbose?: boolean; details?: boolean },
  ): Promise<ValidationResult> {
    const details = options?.details ?? false;
    const totalStart = Date.now();
    const log = options?.verbose
      ? (msg: string) => console.error(msg)
      : undefined;

    const http = new HttpClient({
      apiKey: this.apiKey,
      baseUrl: `${this.baseUrl}/v2`,
      gate: this.gate,
    });

    let t = Date.now();
    const creativeRes = await http.get<ApiSingleResponse<ApiCreative>>(
      `/creatives/${creativeId}`,
    );
    const creative = creativeRes.data;
    log?.(`Fetching creative ${creativeId}... ${ms(t)}`);

    if (!details) {
      const result = buildSummaryResult(creative);
      const summary = result.issues > 0 ? `${result.issues} issues found.` : "All tests passed.";
      log?.(`Done. ${summary} ${result.reportUrl} — ${http.requestCount} requests, total: ${ms(totalStart)}`);
      return result;
    }

    t = Date.now();
    const campaign = await fetchCampaign(http, creative.campaignId);
    log?.(`Fetching campaign ${creative.campaignId}... ${ms(t)}`);

    t = Date.now();
    const adspec = await resolveAdSpec(http, {
      spec: String(campaign.adspecId),
    });
    log?.(`Fetching adspec ${campaign.adspecId}... ${ms(t)}`);

    log?.(`Building results for "${adspec.name}" (${adspec.tests.length} tests)...`);
    const result = await buildResult(http, creative, adspec, log);
    const summary = result.issues > 0 ? `${result.issues} issues found.` : "All tests passed.";
    log?.(`Done. ${summary} ${http.requestCount} requests, total: ${ms(totalStart)}`);
    return result;
  }
}

// --- Parameter validation ---

function validateParams(input: ValidateInput): void {
  const inputKeys = (["url", "file", "tag", "data"] as const).filter(
    (k) => input[k] !== undefined,
  );

  if (inputKeys.length === 0) {
    throw new InputError(
      "Creative input is required. Provide one of: { url }, { file }, { tag }, or { data }.",
    );
  }

  if (inputKeys.length > 1) {
    throw new InputError(
      "Only one creative input allowed. Provide exactly one of: { url }, { file }, { tag }, or { data }.",
    );
  }

  if ("data" in input && input.data !== undefined && !(input.data instanceof Uint8Array)) {
    throw new InputError(
      "The 'data' field must be a Buffer or Uint8Array.",
    );
  }

  const targetKeys = (["campaign", "spec", "type"] as const).filter(
    (k) => input[k] !== undefined,
  );

  if (targetKeys.length === 0) {
    throw new InputError(
      "Either 'campaign', 'spec', or 'type' is required.",
    );
  }

  if (targetKeys.length > 1) {
    throw new InputError(
      `Cannot specify both '${targetKeys[0]}' and '${targetKeys[1]}'. Provide exactly one of: 'campaign', 'spec', or 'type'.`,
    );
  }
}

// --- AdSpec resolution ---

async function resolveAdSpec(
  http: HttpClient,
  options: { spec?: string; type?: "display" | "video" },
): Promise<AdSpec> {
  if (options.spec) {
    const response = await http.get<ApiSingleResponse<ApiAdSpecification>>(
      `/ad-specifications/${options.spec}`,
    );
    return mapAdSpec(response.data);
  }

  // Find default adspec for the given type
  const response = await http.get<ApiListResponse<ApiAdSpecification>>(
    "/ad-specifications",
  );
  const defaultSpec = response.data.find(
    (spec) => spec.type === options.type && spec.isDefault,
  );

  if (!defaultSpec) {
    throw new InputError(
      `No default ad specification found for type '${options.type}'.`,
    );
  }

  // Fetch full adspec with tests
  const fullResponse = await http.get<ApiSingleResponse<ApiAdSpecification>>(
    `/ad-specifications/${defaultSpec.id}`,
  );
  return mapAdSpec(fullResponse.data);
}

function mapAdSpec(api: ApiAdSpecification): AdSpec {
  return {
    id: api.id,
    name: api.name,
    type: api.type,
    isDefault: api.isDefault,
    tests: (api.tests ?? [])
      .filter((t) => t.enabled !== false)
      .map((t) => ({
        name: t.name,
        conditionsString:
          typeof t.conditionsString === "string"
            ? t.conditionsString
            : null,
      })),
  };
}

// --- Campaign fetching ---

async function fetchCampaign(
  http: HttpClient,
  campaignId: number,
): Promise<ApiCampaign> {
  const response = await http.get<ApiSingleResponse<ApiCampaign>>(
    `/campaigns/${campaignId}`,
  );
  return response.data;
}

// --- Campaign creation ---

async function createCampaign(
  http: HttpClient,
  name: string,
  type: "display" | "video",
  adspecId: number,
): Promise<ApiCampaign> {
  const response = await http.post<ApiSingleResponse<ApiCampaign>>(
    "/campaigns",
    { name, type, adspecId },
  );
  return response.data;
}

// --- Creative upload ---

async function uploadCreative(
  http: HttpClient,
  campaignId: number,
  input: { url?: string; file?: string; tag?: string; data?: Buffer | Uint8Array; fileName?: string },
): Promise<ApiCreative> {
  const path = `/campaigns/${campaignId}/creatives`;

  const payload = input.url ?? input.tag;
  if (payload) {
    const response = await http.post<ApiListResponse<ApiCreative>>(path, {
      payload,
    });
    return response.data[0];
  }

  if (input.file) {
    const fileBuffer = await readFile(input.file);
    const fileName = basename(input.file);
    const response = await http.post<ApiListResponse<ApiCreative>>(
      path,
      fileBuffer,
      "application/octet-stream",
      { "X-Filename": fileName },
    );
    return response.data[0];
  }

  if (input.data) {
    const headers: Record<string, string> = {};
    if (input.fileName) {
      headers["X-Filename"] = input.fileName;
    }
    const response = await http.post<ApiListResponse<ApiCreative>>(
      path,
      input.data,
      "application/octet-stream",
      headers,
    );
    return response.data[0];
  }

  throw new InputError("Invalid creative input.");
}

// --- Summary result builder ---

function buildSummaryResult(creative: ApiCreative): ValidationResult {
  const scan = creative.latestScanStatus!;
  const issues = scan.nbIssues ?? 0;
  return {
    campaignId: creative.campaignId,
    creativeId: creative.id,
    scanId: scan.id,
    passed: issues === 0,
    reportUrl: creative.shareURL,
    issues,
    tests: [],
    mediaFiles: [],
    variations: [],
  };
}

// --- Helpers ---

function generateCampaignName(input: { url?: string; file?: string; tag?: string; data?: Buffer | Uint8Array; fileName?: string }): string {
  const date = new Date().toISOString().split("T")[0];
  let summary = "unknown";

  if ("url" in input && input.url) {
    summary = input.url.length > 60 ? input.url.substring(0, 60) + "..." : input.url;
  } else if ("file" in input && input.file) {
    summary = basename(input.file);
  } else if ("tag" in input && input.tag) {
    summary =
      input.tag.length > 60 ? input.tag.substring(0, 60) + "..." : input.tag;
  } else if ("data" in input && input.data) {
    summary = input.fileName ?? "binary upload";
  }

  return `SDK validation - ${summary} - ${date}`;
}

function ms(start: number): string {
  const elapsed = Date.now() - start;
  if (elapsed < 1000) return `(${elapsed}ms)`;
  return `(${(elapsed / 1000).toFixed(1)}s)`;
}
