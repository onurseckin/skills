import type { CommandRecord } from "../contracts/commands.ts";
import type { EvidenceClass } from "../contracts/evidence.ts";
import { queryBrowserRuns } from "../reporting/browser-run-store.ts";
import type { BrowserRunRecord } from "../reporting/browser-run-types.ts";
import type { BrowserTestRun } from "./types.ts";

/** The capsule records a run in the field names it stores; the graph reads them in its own. */
const GRAPH_FIELD_BY_RECORD_FIELD: Readonly<Record<string, string>> = {
  category: "category",
  extras: "extras",
  runner: "runner",
  test_file: "testFile",
  browser: "browser",
  status: "status",
  duration_ms: "durationMs",
  viewport: "viewport",
  viewports: "viewports",
  traces: "traces",
  videos: "videos",
};

function graphEvidence(record: BrowserRunRecord): Record<string, EvidenceClass> {
  const evidence: Record<string, EvidenceClass> = {};
  for (const [recordField, graphField] of Object.entries(GRAPH_FIELD_BY_RECORD_FIELD)) {
    const evidenceClass = record.evidence_classes[recordField];
    if (evidenceClass !== undefined) evidence[graphField] = evidenceClass;
  }
  return evidence;
}

function toBrowserTestRun(record: BrowserRunRecord): BrowserTestRun {
  return {
    commandId: record.command_id,
    ...(record.category === undefined ? {} : { category: record.category }),
    ...(record.runner === undefined ? {} : { runner: record.runner }),
    ...(record.test_file === undefined ? {} : { testFile: record.test_file }),
    ...(record.browser === undefined ? {} : { browser: record.browser }),
    ...(record.status === undefined ? {} : { status: record.status }),
    ...(record.duration_ms === undefined ? {} : { durationMs: record.duration_ms }),
    ...(record.viewport === undefined ? {} : { viewport: record.viewport }),
    ...(record.viewports === undefined ? {} : { viewports: record.viewports }),
    ...(record.traces === undefined ? {} : { traces: record.traces }),
    ...(record.videos === undefined ? {} : { videos: record.videos }),
    ...(record.report_path === undefined ? {} : { reportPath: record.report_path }),
    ...(record.extras === undefined ? {} : { extras: { ...record.extras } }),
    evidence: graphEvidence(record),
  };
}

/**
 * The browser runs these commands drove, in command order. Ownership is the recorded command id and
 * nothing else, so a node carries a run only when its own agent ran the command that produced it.
 */
export function buildNodeBrowserTests(
  commands: readonly CommandRecord[],
  runRoot?: string,
): BrowserTestRun[] {
  if (!runRoot || commands.length === 0) return [];
  const recorded = new Map(queryBrowserRuns(runRoot).map((run) => [run.command_id, run]));
  const runs: BrowserTestRun[] = [];
  for (const command of commands) {
    const record = recorded.get(command.id);
    if (record) runs.push(toBrowserTestRun(record));
  }
  return runs;
}
