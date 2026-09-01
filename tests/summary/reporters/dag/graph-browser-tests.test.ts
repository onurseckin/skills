import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { buildNodeBrowserTests } from "../../../../olt/scripts/src/summary/formatters/index.ts";
import { generateGraphDataset } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { writeBrowserRunRecord } from "../../../../olt/scripts/src/reporting/browser-run-store.ts";
import type { BrowserRunRecord } from "../../../../olt/scripts/src/reporting/browser-run-types.ts";
import type { GraphNodeData } from "../../../../olt/scripts/src/summary/graph/index.ts";
import { makeCommand, makeState, makeTask } from "./graph-fixtures.ts";

const vfs = new Map<string, string>();
const vdirs = new Set<string>();
let rootCounter = 0;
const spies: Array<{ mockRestore: () => void }> = [];
const norm = (p: fs.PathLike) => String(p).replace(/\/+$/, "");

beforeEach(() => {
  const oe = fs.existsSync.bind(fs),
    or = fs.readFileSync.bind(fs),
    ow = fs.writeFileSync.bind(fs);
  const om = fs.mkdirSync.bind(fs),
    orm = fs.rmSync.bind(fs),
    oreaddir = fs.readdirSync.bind(fs);

  spies.push(
    spyOn(fs, "existsSync").mockImplementation((p) => {
      const s = norm(p);
      return s.startsWith("/virtual/")
        ? vfs.has(s) || vdirs.has(s) || Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`))
        : oe(p);
    }),
    spyOn(fs, "readFileSync").mockImplementation((p, opt) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const c = vfs.get(s);
        if (!c) throw new Error(`ENOENT: ${s}`);
        return opt === "utf-8" || opt === "utf8" || (typeof opt === "object" && opt)
          ? c
          : Buffer.from(c, "utf-8");
      }
      return or(p, opt as Parameters<typeof or>[1]);
    }),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.set(
          s,
          typeof d === "string"
            ? d
            : Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString("utf-8"),
        );
        return;
      }
      ow(p, d);
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vdirs.add(s);
        return undefined;
      }
      return om(p) as string | undefined;
    }),
    spyOn(fs, "rmSync").mockImplementation((p) => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        vfs.delete(s);
        vdirs.delete(s);
        for (const k of Array.from(vfs.keys())) if (k.startsWith(`${s}/`)) vfs.delete(k);
        return;
      }
      orm(p, { recursive: true, force: true });
    }),
    spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike, opt?: unknown): unknown => {
      const s = norm(p);
      if (s.startsWith("/virtual/")) {
        const prefix = `${s}/`;
        const entries = new Map<string, boolean>();
        for (const k of vfs.keys()) {
          if (k.startsWith(prefix) && k.length > prefix.length) {
            const rel = k.slice(prefix.length);
            const firstSeg = rel.split("/")[0]!;
            entries.set(firstSeg, rel.includes("/"));
          }
        }
        for (const d of vdirs) {
          if (d.startsWith(prefix) && d.length > prefix.length) {
            const rel = d.slice(prefix.length);
            entries.set(rel.split("/")[0]!, true);
          }
        }
        const withTypes =
          typeof opt === "object" &&
          opt !== null &&
          "withFileTypes" in opt &&
          Boolean((opt as { withFileTypes?: boolean }).withFileTypes);
        if (withTypes) {
          return Array.from(entries.entries()).map(([name, isDir]) => ({
            name,
            isDirectory: () => isDir,
            isFile: () => !isDir,
            isSymbolicLink: () => false,
          })) as unknown as fs.Dirent[];
        }
        return Array.from(entries.keys());
      }
      return oreaddir(p, opt as Parameters<typeof oreaddir>[1]);
    }),
  );
});

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
  vdirs.clear();
});

function runRootWith(records: readonly BrowserRunRecord[]): string {
  rootCounter += 1;
  const root = `/virtual/graph-browser-${rootCounter}`;
  vdirs.add(root);
  vdirs.add(join(root, "evidence"));
  for (const record of records) writeBrowserRunRecord(root, record);
  return root;
}

function run(overrides: Partial<BrowserRunRecord> = {}): BrowserRunRecord {
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

function nodeById(nodes: readonly GraphNodeData[], id: string): GraphNodeData | undefined {
  return nodes.find((node) => node.id === id);
}

describe("browser runs in the graph", () => {
  test("the node whose agent ran the command carries the run, in the graph's own field names", () => {
    const runRoot = runRootWith([run()]);
    const dataset = generateGraphDataset({
      runId: "run-browser",
      state: makeState([makeTask("T-1")]),
      commands: { "C-1": makeCommand("C-1", { task_id: "T-1" }) },
      runRoot,
    });

    const browserTests = nodeById(dataset.nodes, "node-task-T-1")?.browserTests;

    expect(browserTests).toHaveLength(1);
    expect(browserTests?.[0]).toEqual({
      commandId: "C-1",
      runner: "gvui-visual-suite",
      testFile: "tests/browser/login.spec.ts",
      browser: "chromium",
      status: "passed",
      durationMs: 1500,
      viewport: { width: 1440, height: 900 },
      traces: ["/artifacts/trace.zip"],
      videos: ["/artifacts/session.webm"],
      reportPath: "/repo/test-results/report.json",
      evidence: {
        runner: "agent_reported",
        testFile: "agent_reported",
        browser: "agent_reported",
        viewport: "agent_reported",
        traces: "agent_reported",
        videos: "agent_reported",
        durationMs: "harness_observed",
        status: "harness_observed",
      },
    });
  });

  test("a gate run belongs to the validator node and to no other", () => {
    const runRoot = runRootWith([run({ command_id: "C-gate", actor: "validator-1" })]);
    const dataset = generateGraphDataset({
      runId: "run-browser-gate",
      state: makeState([
        makeTask("T-1", {
          validations: [
            {
              domain: "code-quality",
              validator_id: "validator-1",
              started_at: "2026-08-14T20:00:00.000Z",
            },
          ],
        }),
      ]),
      commands: {
        "C-1": makeCommand("C-1", { task_id: "T-1" }),
        "C-gate": makeCommand("C-gate", {
          task_id: "T-1",
          gate_id: "gate-1",
          actor: "validator-1",
        }),
      },
      runRoot,
    });

    expect(nodeById(dataset.nodes, "node-validator-T-1")?.browserTests).toHaveLength(1);
    expect(nodeById(dataset.nodes, "node-task-T-1")?.browserTests).toBeUndefined();
  });

  test("the critic's own browser run lands on the critic node", () => {
    const runRoot = runRootWith([run({ command_id: "C-critic", actor: "critic-1" })]);
    const dataset = generateGraphDataset({
      runId: "run-browser-critic",
      state: makeState([makeTask("T-1")], {
        completion_critic: {
          critic_id: "critic-1",
          authorized_at: "2026-08-14T21:00:00.000Z",
          authorized_by: "coordinator",
          token_sha256: "digest",
        },
      }),
      commands: { "C-critic": makeCommand("C-critic", { actor: "critic-1" }) },
      runRoot,
    });

    expect(nodeById(dataset.nodes, "node-critic-authority")?.browserTests).toHaveLength(1);
  });

  test("a branch sub-agent's browser run lands on its own node", () => {
    const runRoot = runRootWith([run({ command_id: "C-sub", task_id: "B-1-visual" })]);
    const dataset = generateGraphDataset({
      runId: "run-browser-branch",
      state: makeState([makeTask("T-parent")], {
        branches: [
          {
            id: "B-1",
            parent_task_id: "T-parent",
            parent_agent_id: "worker-1",
            reason: "The drawer needed its own visual proof",
            depth: 1,
            status: "collected",
            opened_at: "2026-08-14T20:05:00.000Z",
            sub_tasks: [
              {
                id: "B-1-visual",
                label: "Prove the drawer renders",
                write_scope: ["src/ui.tsx"],
                status: "submitted",
                agent_id: "sub-1",
              },
            ],
          },
        ],
      }),
      commands: {
        "C-sub": makeCommand("C-sub", { task_id: "B-1-visual", actor: "sub-1" }),
      },
      runRoot,
    });

    expect(nodeById(dataset.nodes, "node-branch-B-1-B-1-visual")?.browserTests).toHaveLength(1);
  });

  test("a node whose commands drove no browser run carries no browser scaffold", () => {
    const runRoot = runRootWith([]);
    const dataset = generateGraphDataset({
      runId: "run-no-browser",
      state: makeState([makeTask("T-1")]),
      commands: { "C-1": makeCommand("C-1", { task_id: "T-1" }) },
      runRoot,
    });

    const node = nodeById(dataset.nodes, "node-task-T-1");

    expect(node?.browserTests).toBeUndefined();
    expect(Object.keys(node ?? {})).not.toContain("browserTests");
  });

  test("a run recorded against another command never lands on this node", () => {
    const runRoot = runRootWith([run({ command_id: "C-other" })]);

    expect(buildNodeBrowserTests([makeCommand("C-1")], runRoot)).toEqual([]);
  });

  test("only the fields the capsule recorded reach the graph", () => {
    const runRoot = runRootWith([
      {
        command_id: "C-1",
        status: "failed",
        evidence_classes: { status: "harness_observed" },
      },
    ]);

    const [built] = buildNodeBrowserTests([makeCommand("C-1")], runRoot);

    expect(built).toEqual({
      commandId: "C-1",
      status: "failed",
      evidence: { status: "harness_observed" },
    });
  });

  test("without a capsule path or a command there is nothing to read", () => {
    expect(buildNodeBrowserTests([makeCommand("C-1")])).toEqual([]);
    expect(buildNodeBrowserTests([], runRootWith([run()]))).toEqual([]);
  });
});
