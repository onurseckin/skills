import { statSync } from "node:fs";
import type { EvidenceClass } from "../core/contracts/evidence.ts";
import { readBrowserRunReport, type BrowserReportFacts } from "./browser-run-report.ts";
import { findBrowserReportCandidates } from "./browser-run-scanner.ts";
import { writeBrowserRunRecord } from "./browser-run-store.ts";
import type { BrowserRunIngestOptions, BrowserRunRecord } from "./browser-run-types.ts";
import { findVisualReportCandidates } from "./screenshot-scanner.ts";

const REPORTED: EvidenceClass = "agent_reported";

const RUN_CATEGORY = "browser-automation";

function measuredDuration(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): number | undefined {
  if (!startedAt || !finishedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return end - start;
}

function statusFromExit(exitCode: number | null | undefined): string | undefined {
  if (exitCode === null || exitCode === undefined) return undefined;
  return exitCode === 0 ? "passed" : "failed";
}

const CLOCK_SLACK_MS = 1000;

function writtenByCommand(
  path: string,
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): boolean {
  if (!startedAt) return false;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return false;
  const finished = finishedAt ? Date.parse(finishedAt) : Number.NaN;
  const end = Number.isNaN(finished) || finished < start ? Date.now() : finished;
  try {
    const { mtimeMs } = statSync(path);
    return mtimeMs >= start - CLOCK_SLACK_MS && mtimeMs <= end + CLOCK_SLACK_MS;
  } catch {
    return false;
  }
}

function firstReport(options: BrowserRunIngestOptions): BrowserReportFacts | undefined {
  const searchDirs = options.searchDirs ?? [];
  const candidates = [
    ...findBrowserReportCandidates(
      searchDirs,
      options.stdout,
      options.stderr,
      options.explicitPaths,
    ),
    ...findVisualReportCandidates(
      [...searchDirs],
      options.stdout,
      options.stderr,
      options.explicitPaths ? [...options.explicitPaths] : undefined,
    ),
  ];
  for (const candidate of candidates) {
    if (!writtenByCommand(candidate, options.startedAt, options.finishedAt)) continue;
    const facts = readBrowserRunReport(candidate);
    if (facts) return facts;
  }
  return undefined;
}

export function ingestBrowserRun(options: BrowserRunIngestOptions): BrowserRunRecord | null {
  const facts = firstReport(options);
  if (!facts) return null;

  const durationMs = measuredDuration(options.startedAt, options.finishedAt);
  const exitStatus = statusFromExit(options.exitCode);
  const status = facts.status ?? exitStatus;
  const evidenceClasses: Record<string, EvidenceClass> = {};

  evidenceClasses.category = "derived";
  if (facts.extras !== undefined) evidenceClasses.extras = REPORTED;
  if (facts.runner !== undefined) evidenceClasses.runner = REPORTED;
  if (facts.testFile !== undefined) evidenceClasses.test_file = REPORTED;
  if (facts.browser !== undefined) evidenceClasses.browser = REPORTED;
  if (facts.viewport !== undefined) evidenceClasses.viewport = REPORTED;
  if (facts.viewports !== undefined) evidenceClasses.viewports = REPORTED;
  if (facts.traces !== undefined) evidenceClasses.traces = REPORTED;
  if (facts.videos !== undefined) evidenceClasses.videos = REPORTED;
  if (durationMs !== undefined) evidenceClasses.duration_ms = "harness_observed";
  if (status !== undefined) {
    evidenceClasses.status = facts.status !== undefined ? REPORTED : "harness_observed";
  }

  const record: BrowserRunRecord = {
    command_id: options.commandId,
    ...(options.taskId === undefined ? {} : { task_id: options.taskId }),
    ...(options.actor === undefined ? {} : { actor: options.actor }),
    report_path: facts.sourcePath,
    category: RUN_CATEGORY,
    ...(facts.extras === undefined ? {} : { extras: facts.extras }),
    ...(facts.runner === undefined ? {} : { runner: facts.runner }),
    ...(facts.testFile === undefined ? {} : { test_file: facts.testFile }),
    ...(facts.browser === undefined ? {} : { browser: facts.browser }),
    ...(status === undefined ? {} : { status }),
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    ...(facts.viewport === undefined ? {} : { viewport: facts.viewport }),
    ...(facts.viewports === undefined ? {} : { viewports: facts.viewports }),
    ...(facts.traces === undefined ? {} : { traces: facts.traces }),
    ...(facts.videos === undefined ? {} : { videos: facts.videos }),
    evidence_classes: evidenceClasses,
  };

  writeBrowserRunRecord(options.runRoot, record);
  return record;
}
