import { statSync } from "node:fs";
import type { EvidenceClass } from "../contracts/evidence.ts";
import { readBrowserRunReport, type BrowserReportFacts } from "./browser-run-report.ts";
import { findBrowserReportCandidates } from "./browser-run-scanner.ts";
import { writeBrowserRunRecord } from "./browser-run-store.ts";
import type { BrowserRunIngestOptions, BrowserRunRecord } from "./browser-run-types.ts";
import { findVisualReportCandidates } from "./screenshot-scanner.ts";

/**
 * The tool told us; the harness did not measure it. A test runner is not the harness and not the
 * host, so everything read out of its report carries the same weight as anything else self-reported.
 */
const REPORTED: EvidenceClass = "agent_reported";

/**
 * A record exists only because a browser-automation report was read, so the category follows from
 * the ingestion path itself. It is computed from what the harness did, never from the runner's
 * name, which is why it is labelled derived rather than reported.
 */
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

/** The exit status the harness watched, said in the vocabulary a run reports its outcome in. */
function statusFromExit(exitCode: number | null | undefined): string | undefined {
  if (exitCode === null || exitCode === undefined) return undefined;
  return exitCode === 0 ? "passed" : "failed";
}

/**
 * Filesystem timestamps and the harness clock do not agree to the millisecond, and some filesystems
 * store whole seconds, so a report the command really did write can look a moment early.
 */
const CLOCK_SLACK_MS = 1000;

/**
 * A report this command could have written: last modified inside the window the harness watched the
 * command run. A suite that ran an hour ago leaves its report exactly where a suite that ran just
 * now would, so without this the harness credits every later command in the same repository with a
 * browser run it never drove — and publishes that command's wall clock as the run's duration. A
 * file stamped after the command ended is somebody else's for the same reason. When the harness has
 * no start time it cannot tell any of them apart, and refuses.
 */
function writtenByCommand(
  path: string,
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): boolean {
  if (!startedAt) return false;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return false;
  // Ingestion runs the moment the command returns, so "now" bounds a run whose end went unrecorded
  // or came back before its own start; an impossible end is no bound at all.
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
  // Runner reports first: they carry the artefacts and the browser, which a metrics report cannot.
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

/**
 * Records the browser run a command drove, or nothing at all. A run is recorded only when the tool
 * left a report the harness could read: without one there is no evidence a browser ran, and a
 * command line that merely mentions a browser is not that evidence.
 *
 * The clock and the exit status are the harness's own observations. The viewport, the browser, the
 * test file and the artefact paths are the tool's claims, and each field says which it is.
 */
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
