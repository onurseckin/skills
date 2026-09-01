import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  activeAgentBadge,
  dagViewCommand,
  executeDagViewCommand,
  findLatestCapsuleIn,
  renderAsciiDag,
  renderNodeBox,
  renderVisualDag,
  resolveCapsuleRun,
  statusBadge,
  statusGlyph,
  type DagNodeSummary,
  type DagViewResult,
} from "../../../../../olt/scripts/src/cli/commands/dag-view.ts";
import {
  buildSugiyamaDagReport,
  assignSugiyamaRanks,
  minimizeCrossingsBarycenter,
  insertVirtualDummyNodes,
  type SugiyamaNode,
  type SugiyamaEdge,
  type SugiyamaLayer,
} from "../../../../../olt/scripts/src/reporting/sugiyama-dag/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

async function createBaseRun(name: string): Promise<{ repo: string; run: string }> {
  const repo = `/virtual/cli/harness-dag-comp-${name}`;
  roots.push(repo);
  await mkdir(repo, { recursive: true });
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(
    promptPath,
    "Build multi-tier system with backend, frontend, database, and documentation components.",
  );

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  return { repo, run: init.run_root as string };
}

describe("dag-view comprehensive unit test suite", () => {
  test("findLatestCapsuleIn and resolveCapsuleRun resolution paths", async () => {
    const { repo, run } = await createBaseRun("resolve-capsule");

    expect(findLatestCapsuleIn(repo)).toBe(run);
    expect(findLatestCapsuleIn("/non/existent/path")).toBeNull();

    expect(resolveCapsuleRun(repo, run)).toBe(run);
    expect(resolveCapsuleRun(repo, undefined, "resolve-capsule")).toContain("resolve-capsule");
    expect(resolveCapsuleRun(repo)).toBe(run);

    const emptyRepo = `/virtual/cli/empty-repo-${Date.now()}`;
    await mkdir(emptyRepo, { recursive: true });
    roots.push(emptyRepo);
    expect(() => resolveCapsuleRun(emptyRepo)).toThrow("no active capsule found");
  });

  test("statusGlyph, statusBadge, and activeAgentBadge renderers cover all node states", () => {
    const statuses = [
      "done",
      "satisfied",
      "leased",
      "running",
      "validating",
      "validated",
      "ready",
      "retry_ready",
      "draft",
      "changes_requested",
      "failed",
      "escalated",
      "proposed",
      "blocked",
      "unknown",
    ];

    for (const st of statuses) {
      const glyph = statusGlyph(st, false);
      expect(glyph.length).toBeGreaterThan(0);
      expect(statusBadge(st)).toBe(glyph);
    }
    expect(statusGlyph("draft", true)).toBe("(⏳ BLOCKED)");

    const dummyNode: DagNodeSummary = {
      id: "node-1",
      label: "Node 1",
      status: "leased",
      priority: 50,
      writeScope: ["src/a.ts"],
      resourceScope: [],
      gate: "bun test a",
      dependencies: [],
      assignedAgent: "agent-alpha",
      assignedRole: "implementer",
      assignedTool: "write_file",
      attempt: 1,
      wave: 1,
      criticalDepth: 1,
      descendantCount: 0,
    };

    expect(activeAgentBadge(dummyNode)).toContain("[⚡ LEASED: agent-alpha (implementer)]");

    const valNode: DagNodeSummary = {
      ...dummyNode,
      status: "validating",
      assignedAgent: "agent-val",
      assignedRole: "validator",
    };
    expect(activeAgentBadge(valNode)).toContain("[⚡ VALIDATING: agent-val (validator)]");

    const unassignedNode: DagNodeSummary = { ...dummyNode, status: "ready", assignedAgent: null };
    expect(activeAgentBadge(unassignedNode)).toBe("");
  });

  test("renderNodeBox, renderVisualDag, and renderAsciiDag formatting", () => {
    expect(renderVisualDag([])).toContain("No tasks declared");

    const nodeA: DagNodeSummary = {
      id: "task-a",
      label: "Task Alpha",
      status: "done",
      priority: 50,
      writeScope: ["src/core"],
      resourceScope: [],
      gate: "bun test a",
      dependencies: [],
      assignedAgent: "impl-a",
      attempt: 1,
      wave: 1,
      criticalDepth: 1,
      descendantCount: 1,
      effort: 2,
    };

    const nodeB: DagNodeSummary = {
      id: "task-b",
      label: "Task Beta",
      status: "ready",
      priority: 50,
      writeScope: ["src/feature"],
      resourceScope: [],
      gate: "bun test b",
      dependencies: ["task-a"],
      depReasons: { "task-a": "needs models" },
      assignedAgent: null,
      attempt: null,
      wave: 2,
      criticalDepth: 0,
      descendantCount: 0,
      effort: 3,
    };

    const boxLines = renderNodeBox(nodeB, { detailed: true, hasDownConnector: true });
    expect(boxLines.some((l) => l.includes("task-b"))).toBe(true);
    expect(boxLines.some((l) => l.includes("needs models"))).toBe(true);
    expect(boxLines[boxLines.length - 1]).toContain("┬");

    const waves = [
      { wave: 1, tasks: [nodeA] },
      { wave: 2, tasks: [nodeB] },
    ];
    const ascii = renderAsciiDag(waves, true);
    expect(ascii).toContain("WAVE 1");
    expect(ascii).toContain("WAVE 2");
    expect(ascii).toContain("▼");
  });

  test("Sugiyama layout algorithm computes ranks, crossings, and dummy routes", () => {
    const sNodes: SugiyamaNode[] = [
      { id: "s1", label: "S1", status: "done", writeScope: ["src/1"], dependencies: [] },
      { id: "s2", label: "S2", status: "ready", writeScope: ["src/2"], dependencies: ["s1"] },
      { id: "s3", label: "S3", status: "ready", writeScope: ["src/3"], dependencies: ["s1"] },
      {
        id: "s4",
        label: "S4",
        status: "blocked",
        writeScope: ["src/4"],
        dependencies: ["s2", "s3"],
      },
    ];
    const sEdges: SugiyamaEdge[] = [
      { from: "s1", to: "s2", type: "dependency" },
      { from: "s1", to: "s3", type: "dependency" },
      { from: "s2", to: "s4", type: "dependency" },
      { from: "s3", to: "s4", type: "dependency" },
    ];

    const ranks = assignSugiyamaRanks(sNodes, sEdges);
    expect(ranks.get("s1")).toBe(0);
    expect(ranks.get("s4")).toBe(2);

    const initialLayers: SugiyamaLayer[] = [
      {
        rank: 0,
        nodes: [{ ...sNodes[0]!, rank: 0, order: 0, criticalDepth: 2, descendantCount: 3 }],
      },
      {
        rank: 1,
        nodes: [
          { ...sNodes[1]!, rank: 1, order: 0, criticalDepth: 1, descendantCount: 1 },
          { ...sNodes[2]!, rank: 1, order: 1, criticalDepth: 1, descendantCount: 1 },
        ],
      },
      {
        rank: 2,
        nodes: [{ ...sNodes[3]!, rank: 2, order: 0, criticalDepth: 0, descendantCount: 0 }],
      },
    ];

    const withDummies = insertVirtualDummyNodes(initialLayers, sEdges);
    expect(withDummies.layers.length).toBe(3);

    const reordered = minimizeCrossingsBarycenter(withDummies.layers, withDummies.edges);
    expect(reordered.length).toBe(3);

    const report = buildSugiyamaDagReport(sNodes, sEdges, { detailed: true });
    expect(report.metrics.totalWaves).toBe(3);
    expect(report.metrics.criticalPathLength).toBe(3);
    expect(report.renderedDag.length).toBeGreaterThan(0);
  });

  test("dagViewCommand and executeDagViewCommand support JSON and CLI options", async () => {
    const { run } = await createBaseRun("full-dag-run");

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-root",
      "--label",
      "Root Architecture",
      "--scope",
      "src/root",
      "--gate",
      "bun test root",
      "--actor",
      "planner",
      "--effort",
      "2",
    ]);

    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-leaf",
      "--label",
      "Leaf Feature",
      "--scope",
      "src/leaf",
      "--gate",
      "bun test leaf",
      "--deps",
      "task-root",
      "--dep-reason",
      "task-root:Depends on base types",
      "--actor",
      "planner",
      "--effort",
      "4",
    ]);

    const resultJson = dagViewCommand({ run, json: true, detailed: true, all: true });
    const report = resultJson as unknown as DagViewResult;

    expect(report.json).toBe(true);
    expect(report.total_tasks).toBe(2);
    expect(report.metrics.totalWork).toBe(6);
    expect(report.metrics.criticalPathLength).toBe(2);
    expect(report.metrics.parallelismFactor).toBe(3);
    expect(report.nodes.length).toBe(2);
    expect(report.waves.length).toBe(2);
    expect(report.dependency_forensics.length).toBe(1);
    expect(report.serialization_analysis.length).toBe(2);

    const execReport = executeDagViewCommand(["--run", run, "--detailed"]);
    expect(execReport.total_tasks).toBe(2);
    expect(execReport.is_compiled).toBe(false);

    const execFlagsReport = executeDagViewCommand({ run });
    expect(execFlagsReport.total_tasks).toBe(2);
  });
});
