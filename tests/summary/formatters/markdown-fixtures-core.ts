import { spyOn } from "bun:test";
import * as fs from "node:fs";
import type { Manifest } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import {
  formatSummaryMarkdown,
  type MarkdownFormatterInput,
} from "../../../olt/scripts/src/summary/markdown/index.ts";
import type { GraphDataset } from "../../../olt/scripts/src/summary/graph/index.ts";
import type { RollupMetrics } from "../../../olt/scripts/src/summary/metrics/index.ts";

const vfs = new Map<string, string>();
const vdirs = new Set<string>();
let rootCounter = 0;

const origExists = fs.existsSync.bind(fs);
const origRead = fs.readFileSync.bind(fs);
const origWrite = fs.writeFileSync.bind(fs);
const origMkdir = fs.mkdirSync.bind(fs);
const origRm = fs.rmSync.bind(fs);

spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike): boolean => {
  const s = String(p);
  if (s.startsWith("/virtual/")) {
    if (vfs.has(s) || vdirs.has(s)) return true;
    for (const k of vfs.keys()) {
      if (k.startsWith(`${s}/`)) return true;
    }
    for (const d of vdirs) {
      if (d.startsWith(`${s}/`)) return true;
    }
    return false;
  }
  return origExists(p);
});

spyOn(fs, "readFileSync").mockImplementation(
  (p: fs.PathLike, opt?: unknown): string | Buffer => {
    const s = String(p);
    if (s.startsWith("/virtual/")) {
      const content = vfs.get(s);
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${s}'`);
      }
      if (
        opt === "utf-8" ||
        opt === "utf8" ||
        (typeof opt === "object" && opt !== null && "encoding" in opt && (opt as { encoding?: string }).encoding)
      ) {
        return content;
      }
      return Buffer.from(content, "utf-8");
    }
    return origRead(p, opt as Parameters<typeof origRead>[1]) as string | Buffer;
  },
);

spyOn(fs, "writeFileSync").mockImplementation(
  (p: fs.PathLike, data: string | NodeJS.ArrayBufferView): void => {
    const s = String(p);
    if (s.startsWith("/virtual/")) {
      vfs.set(
        s,
        typeof data === "string"
          ? data
          : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf-8"),
      );
      return;
    }
    origWrite(p, data);
  },
);

spyOn(fs, "mkdirSync").mockImplementation((p: fs.PathLike): string | undefined => {
  const s = String(p);
  if (s.startsWith("/virtual/")) {
    vdirs.add(s);
    return undefined;
  }
  return origMkdir(p) as string | undefined;
});

spyOn(fs, "rmSync").mockImplementation((p: fs.PathLike): void => {
  const s = String(p);
  if (s.startsWith("/virtual/")) {
    vfs.delete(s);
    vdirs.delete(s);
    for (const k of Array.from(vfs.keys())) {
      if (k.startsWith(`${s}/`)) vfs.delete(k);
    }
    for (const d of Array.from(vdirs)) {
      if (d.startsWith(`${s}/`)) vdirs.delete(d);
    }
    return;
  }
  origRm(p, { recursive: true, force: true });
});

export function cleanupRoots(): void {
  vfs.clear();
  vdirs.clear();
}

export function tempRoot(): string {
  rootCounter += 1;
  const root = `/virtual/harness-md-${rootCounter}`;
  vdirs.add(root);
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
