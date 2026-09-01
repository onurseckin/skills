import type { Manifest } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import {
  formatSummaryMarkdown,
  type MarkdownFormatterInput,
} from "../../../olt/scripts/src/summary/markdown/index.ts";
import type { GraphDataset } from "../../../olt/scripts/src/summary/graph/index.ts";
import type { RollupMetrics } from "../../../olt/scripts/src/summary/metrics/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | null = null;
let rootCounter = 0;

export function setupVirtualFormattersFS(): VirtualMemoryFS {
  cleanupRoots();
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupRoots(): void {
  if (session) {
    session.cleanup();
    session = null;
  }
  vfs = new VirtualMemoryFS();
}

export function getVirtualFormattersFS(): VirtualMemoryFS {
  if (!session) {
    setupVirtualFormattersFS();
  }
  return vfs;
}

export function tempRoot(): string {
  if (!session) {
    setupVirtualFormattersFS();
  }
  rootCounter += 1;
  const root = `/virtual/harness-md-${rootCounter}`;
  vfs.mkdirSync(root, { recursive: true });
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
