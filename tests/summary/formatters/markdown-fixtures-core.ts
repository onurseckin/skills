import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import {
  formatSummaryMarkdown,
  type MarkdownFormatterInput,
} from "../../../olt/scripts/src/summary/markdown/index.ts";
import type { GraphDataset } from "../../../olt/scripts/src/summary/graph/index.ts";
import type { RollupMetrics } from "../../../olt/scripts/src/summary/metrics/index.ts";

const roots: string[] = [];

/** Each test file registers this in its own afterEach; the temp roots are shared, not global state. */
export function cleanupRoots(): void {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
}

export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-md-"));
  roots.push(root);
  return root;
}

export const manifest: Manifest = {
  schema: "harness.manifest",
  version: 1,
  run_id: "unit-run",
  capsule_id: "capsule-1",
  prompt_sha256: "abc123",
  prompt_bytes: 12,
  capture_mode: "file",
  source_verified: true,
  assurance: "source-verified",
  bun_version: "1.3.14",
  runtime_version: "0.1.0",
};

export const metrics: RollupMetrics = {
  run_id: "unit-run",
  total_tasks: 0,
  satisfied_tasks: 0,
  failed_tasks: 0,
  repair_rounds_total: 0,
  pushbacks_total: 0,
  pushback_rounds: [],
  resolved_findings_total: 0,
  open_findings_total: 0,
  total_media_assets: 0,
  wall_duration_ms: 45_000,
  active_command_duration_ms: 5_000,
  total_commands_executed: 0,
  total_gates_passed: 0,
  estimated_tokens: { tokens_in: 1000, tokens_out: 500, total_tokens: 1500 },
  files_touched: [],
};

export function task(overrides: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    status: "ready",
    requirement_ids: [],
    write_scope: ["src"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...overrides,
  };
}

/** No graph was computed for this render — every section that reads `context.graph`-derived
 * fields (files changed, action provenance) sees the same absence a real run with no events would. */
export const emptyGraph: GraphDataset = {
  id: "unit-run-graph",
  title: "unit-run-graph",
  nodes: [],
  edges: [],
};

export function render(state: JsonObject, extra: Partial<MarkdownFormatterInput> = {}): string {
  return formatSummaryMarkdown({
    runId: "unit-run",
    runRoot: extra.runRoot ?? tempRoot(),
    manifest,
    promptText: "Do the thing.",
    metrics,
    timeline: [],
    commands: {},
    graph: emptyGraph,
    ...extra,
    state: state as unknown as MarkdownFormatterInput["state"],
  });
}

export const emptyState: JsonObject = {
  tasks: {},
  requirements: [],
  gates: [],
  commands: {},
  orphan_evidence: [],
};
