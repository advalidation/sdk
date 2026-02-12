import { HttpClient } from "./http.js";
import { ApiError } from "./errors.js";
import type {
  AdSpec,
  ApiCheckResult,
  ApiCreative,
  ApiCreativeVariation,
  ApiListResponse,
  ApiScan,
  ApiSingleResponse,
  MediaFile,
  Test,
  ValidationResult,
  Variation,
} from "./types.js";

export async function buildResult(
  http: HttpClient,
  creative: ApiCreative,
  adspec: AdSpec,
  log?: (msg: string) => void,
): Promise<ValidationResult> {
  const thresholds = buildThresholdMap(adspec);

  if (!creative.latestScanStatus) {
    throw new ApiError(500, "Creative has no scan status");
  }
  const scan = creative.latestScanStatus;

  const hasVariations =
    creative.nbVariations !== null && creative.nbVariations > 0;
  const hasMediaFiles =
    !hasVariations &&
    creative.nbMediaFiles !== null &&
    creative.nbMediaFiles > 0;

  let result: ValidationResult;

  if (hasVariations) {
    log?.(`Result path: VAST with variations (${creative.nbVariations} variations)`);
    result = await buildVastWithVariations(http, creative, scan, thresholds, log);
  } else if (hasMediaFiles) {
    log?.(`Result path: VAST without variations (${creative.nbMediaFiles} media files)`);
    result = await buildVastWithoutVariations(http, creative, scan, thresholds, log);
  } else {
    log?.("Result path: single scan");
    result = await buildSingleScan(http, creative, scan, thresholds, log);
  }

  return result;
}

// --- Path 1: Single scan (most creatives) ---

async function buildSingleScan(
  http: HttpClient,
  creative: ApiCreative,
  scan: ApiScan,
  thresholds: Map<string, string>,
  log?: (msg: string) => void,
): Promise<ValidationResult> {
  const fullScan = await fetchScan(http, scan.id);
  const tests = mapTests(fullScan.tests ?? [], thresholds);
  const issues = scan.nbIssues ?? 0;
  log?.(`Creative #${creative.id} — ${testSummary(tests)}`);
  if (log) logFails(tests, "  ", log);

  return {
    campaignId: creative.campaignId,
    creativeId: creative.id,
    scanId: scan.id,
    passed: issues === 0,
    reportUrl: creative.shareURL,
    issues,
    tests,
    mediaFiles: [],
    variations: [],
  };
}

// --- Path 2: VAST without variations ---

async function buildVastWithoutVariations(
  http: HttpClient,
  creative: ApiCreative,
  scan: ApiScan,
  thresholds: Map<string, string>,
  log?: (msg: string) => void,
): Promise<ValidationResult> {
  const fullScan = await fetchScan(http, scan.id);
  const vastTests = mapTests(fullScan.tests ?? [], thresholds);

  const mediaFilesResponse = await http.get<ApiListResponse<ApiCreative>>(
    `/creatives/${creative.id}/media-files`,
  );
  const mfData = mediaFilesResponse.data;

  log?.(`Creative #${creative.id} — ${testSummary(vastTests)}`);
  if (log) logFails(vastTests, "│  ", log);

  const mediaFiles: MediaFile[] = [];
  for (let i = 0; i < mfData.length; i++) {
    const mf = mfData[i];
    const mfScan = await fetchScan(http, mf.latestScanStatus!.id);
    const tests = mapTests(mfScan.tests ?? [], thresholds);
    const isLast = i === mfData.length - 1;
    const connector = isLast ? "└──" : "├──";
    const indent = isLast ? "    " : "│   ";
    log?.(`${connector} ${mediaFileLabel(mf)} — ${testSummary(tests)}`);
    if (log) logFails(tests, indent, log);
    mediaFiles.push({
      creativeId: mf.id,
      scanId: mfScan.id,
      issues: mf.latestScanStatus?.nbIssues ?? 0,
      tests,
    });
  }

  const issues = scan.nbIssues ?? 0;

  return {
    campaignId: creative.campaignId,
    creativeId: creative.id,
    scanId: scan.id,
    passed: issues === 0,
    reportUrl: creative.shareURL,
    issues,
    tests: vastTests,
    mediaFiles,
    variations: [],
  };
}

// --- Path 3: VAST with variations ---

async function buildVastWithVariations(
  http: HttpClient,
  creative: ApiCreative,
  scan: ApiScan,
  thresholds: Map<string, string>,
  log?: (msg: string) => void,
): Promise<ValidationResult> {
  const variationsResponse = await http.get<
    ApiListResponse<ApiCreativeVariation>
  >(`/creatives/${creative.id}/variations`);
  const varData = variationsResponse.data;

  const parentIssues = scan.nbIssues ?? 0;
  log?.(`Creative #${creative.id} — 0 tests, ${c.red(`${parentIssues} issues`)} total`);

  const variations: Variation[] = [];
  for (let i = 0; i < varData.length; i++) {
    const variation = varData[i];
    const isLast = i === varData.length - 1;
    const connector = isLast ? "└──" : "├──";
    const indent = isLast ? "    " : "│   ";

    const variationItems = await http.get<ApiListResponse<ApiCreative>>(
      `/creatives/${creative.id}/variations/${variation.creativeId}`,
    );

    const vastItem = variationItems.data.find(
      (item) => item.id === variation.creativeId,
    );
    const mediaFileItems = variationItems.data.filter(
      (item) => item.id !== variation.creativeId,
    );

    let vastTests: Test[] = [];
    if (vastItem?.latestScanStatus) {
      const vastScan = await fetchScan(http, vastItem.latestScanStatus.id);
      vastTests = mapTests(vastScan.tests ?? [], thresholds);
    }

    log?.(`${connector} Variation "${variation.label}" #${variation.creativeId} — ${testSummary(vastTests)}`);
    if (log) logFails(vastTests, `${indent}│  `, log);

    const mediaFiles: MediaFile[] = [];
    const scannedItems = mediaFileItems.filter(
      (item) => item.latestScanStatus !== null,
    );
    for (let j = 0; j < scannedItems.length; j++) {
      const item = scannedItems[j];
      const mfScan = await fetchScan(http, item.latestScanStatus!.id);
      const tests = mapTests(mfScan.tests ?? [], thresholds);
      const mfIsLast = j === scannedItems.length - 1;
      const mfConnector = mfIsLast ? "└──" : "├──";
      const mfIndent = mfIsLast ? `${indent}    ` : `${indent}│   `;
      log?.(`${indent}${mfConnector} ${mediaFileLabel(item)} — ${testSummary(tests)}`);
      if (log) logFails(tests, mfIndent, log);
      mediaFiles.push({
        creativeId: item.id,
        scanId: mfScan.id,
        issues: mfScan.nbIssues ?? 0,
        tests,
      });
    }

    variations.push({
      creativeId: variation.creativeId,
      label: variation.label,
      issues: computeTotalIssues(vastTests, mediaFiles),
      tests: vastTests,
      mediaFiles,
    });
  }

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
    variations,
  };
}

// --- Helpers ---

async function fetchScan(http: HttpClient, scanId: number): Promise<ApiScan> {
  const response = await http.get<ApiSingleResponse<ApiScan>>(
    `/scans/${scanId}?include_checks=true`,
  );
  return response.data;
}

function buildThresholdMap(adspec: AdSpec): Map<string, string> {
  const map = new Map<string, string>();
  for (const test of adspec.tests) {
    if (test.conditionsString !== null) {
      map.set(test.name, test.conditionsString);
    }
  }
  return map;
}

function mapTests(
  checks: ApiCheckResult[],
  thresholds: Map<string, string>,
): Test[] {
  return checks.map((check) => ({
    name: check.name,
    value: parseValue(check.value),
    valueFormatted: check.valueFormatted || null,
    result: check.result,
    spec: thresholds.get(check.name) ?? null,
  }));
}

function parseValue(raw: unknown): string | number | boolean | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw;
  const str = String(raw);
  if (str === "true") return true;
  if (str === "false") return false;
  const num = Number(str);
  if (!isNaN(num) && str.trim() !== "") return num;
  return str;
}

function computeTotalIssues(tests: Test[], mediaFiles: MediaFile[]): number {
  const topLevelIssues = tests.filter((t) => t.result === "fail").length;
  const mediaFileIssues = mediaFiles.reduce(
    (sum, mf) => sum + mf.tests.filter((t) => t.result === "fail").length,
    0,
  );
  return topLevelIssues + mediaFileIssues;
}

// --- Verbose output helpers ---

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function testSummary(tests: Test[]): string {
  if (tests.length === 0) return c.dim("0 tests");
  const fail = tests.filter((t) => t.result === "fail").length;
  const warn = tests.filter((t) => t.result === "warn").length;
  if (fail === 0 && warn === 0) return c.green(`${tests.length} tests passed`);
  const parts: string[] = [];
  if (fail > 0) parts.push(c.red(`${fail} fail`));
  if (warn > 0) parts.push(c.yellow(`${warn} warn`));
  return `${tests.length} tests (${parts.join(", ")})`;
}

function logFails(
  tests: Test[],
  indent: string,
  log: (msg: string) => void,
): void {
  const fails = tests.filter((t) => t.result === "fail");
  for (const t of fails) {
    const value = t.valueFormatted ?? String(t.value ?? "");
    const spec = t.spec ? c.dim(` [${t.spec}]`) : "";
    log(`${indent}${c.red("✗")} ${t.name}: ${value}${spec}`);
  }
}

function mediaFileLabel(mf: ApiCreative): string {
  const dims =
    mf.width && mf.height ? ` ${mf.width}x${mf.height}` : "";
  return `Media file #${mf.id}${dims}`;
}

