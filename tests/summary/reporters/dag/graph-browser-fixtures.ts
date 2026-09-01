import * as fs from "node:fs";
import { join } from "node:path";
import { writeBrowserRunRecord } from "../../../../olt/scripts/src/reporting/browser-run-store.ts";
import type { BrowserRunRecord } from "../../../../olt/scripts/src/reporting/browser-run-types.ts";
import type { GraphNodeData } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { cleanupVirtualSummaryFS, setupVirtualSummaryFS } from "../../fixture.ts";

let rootCounter = 0;

export function setupBrowserVirtualFS(): void {
  setupVirtualSummaryFS();
}

export function cleanupBrowserVirtualFS(): void {
  cleanupVirtualSummaryFS();
}

export function runRootWith(records: readonly BrowserRunRecord[]): string {
  rootCounter += 1;
  const root = `/virtual/graph-browser-${rootCounter}`;
  fs.mkdirSync(join(root, "evidence"), { recursive: true });
  for (const record of records) writeBrowserRunRecord(root, record);
  return root;
}

export function makeBrowserRun(overrides: Partial<BrowserRunRecord> = {}): BrowserRunRecord {
  return {
    command_id: "C-1",
    task_id: "T-1",
    actor: "worker-1",
    report_path: "/repo/test-results/report.json",
    runner: "gvui-visual-suite",
    test_file: "tests/browser/login.spec.ts",
    browser: "chromium",
    status: "passed",
    duration_ms: 1500,
    viewport: { width: 1440, height: 900 },
    traces: ["/artifacts/trace.zip"],
    videos: ["/artifacts/session.webm"],
    evidence_classes: {
      runner: "agent_reported",
      test_file: "agent_reported",
      browser: "agent_reported",
      viewport: "agent_reported",
      traces: "agent_reported",
      videos: "agent_reported",
      duration_ms: "harness_observed",
      status: "harness_observed",
    },
    ...overrides,
  };
}

export function nodeById(nodes: readonly GraphNodeData[], id: string): GraphNodeData | undefined {
  return nodes.find((node) => node.id === id);
}
