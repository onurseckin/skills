import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { generateSummarySuite } from "../../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { assetUrlCounts, makeState, makeTask } from "./graph-fixtures.ts";
import { buildCompletenessRun } from "./completeness-run-fixture.ts";
import { buildRunReportCapsule } from "./markdown-run-report-fixture.ts";

function topology(waves: Array<{ wave: number; task_ids: string[] }>) {
  return {
    revision: 7,
    max_parallel: 2,
    waves,
    decisions: waves.flatMap((entry) =>
      entry.task_ids.map((taskId) => ({
        task_id: taskId,
        wave: entry.wave,
        parallel_with: entry.task_ids.filter((id) => id !== taskId),
        serialized_after: [],
        reason: "write_scope_conflict",
        rationale: "overlapping write scope",
        evidence_class: "agent_reported",
      })),
    ),
  };
}

describe("recorded topology drives the graph", () => {
  test("obeys recorded waves even when dependencies alone would parallelize", () => {
    const tasks = [makeTask("T-A"), makeTask("T-B")];
    const dataset = generateGraphDataset({
      runId: "run-topology",
      state: makeState(tasks, {
        topology: topology([
          { wave: 1, task_ids: ["T-A"] },
          { wave: 2, task_ids: ["T-B"] },
        ]),
      }),
    });

    const step = (id: string) => dataset.nodes.find((node) => node.id === id)?.step;
    expect(step("node-task-T-A")).toBe(2);
    expect(step("node-task-T-B")).toBe(4);

    const plan = dataset.nodes.find((node) => node.id === "node-orchestrator-plan");
    expect(plan?.metadata?.waveSource).toEqual({ value: "recorded", evidence_class: "derived" });
    expect(plan?.metadata?.topologyRevision).toBe(7);
    expect(plan?.badges).toContainEqual({ label: "2 recorded waves", variant: "info" });
  });

  test("labels a derived partition as derived rather than presenting it as recorded", () => {
    const dataset = generateGraphDataset({
      runId: "run-derived",
      state: makeState([makeTask("T-A"), makeTask("T-B")]),
    });
    const plan = dataset.nodes.find((node) => node.id === "node-orchestrator-plan");

    expect(plan?.metadata?.waveSource).toEqual({
      value: "derived",
      evidence_class: "derived",
      is_estimated: true,
    });
    expect(plan?.metadata?.topologyRevision).toBeNull();
    expect(plan?.badges).toContainEqual({ label: "1 derived waves", variant: "gray" });
  });
});

describe("pre-overhaul capsules still export", () => {
  /**
   * This used to `readdirSync` the repository's own live `.capsules/` root and treat whatever it
   * found as "the checked-in capsules" — but that directory is gitignored scratch (see
   * `.gitignore`), shared with every orchestration run this machine has going, including the one
   * driving this very session. A capsule mid-write there (a `.locks/` entry held, a `state.json`
   * half-flushed) made the test's result depend on what else happened to be running, not on
   * anything this test controlled — load-sensitive, not protective. The fixed set below is built
   * fresh through the harness's own CLI into a throwaway repo nothing else touches, so it is exactly
   * as deterministic as any other fixture in this directory while still exercising the thing the
   * old version actually cared about: a *real*, disk-backed capsule directory (state.json, a
   * commands/ ledger, findings/, evidence/) rather than the in-memory `state` object the legacy test
   * below builds by hand.
   */
  const CAPSULE_BUILD_TIMEOUT_MS = 300_000;

  describe("a fixed set of freshly built, disk-backed capsules", () => {
    let capsules: string[] = [];
    const roots: string[] = [];

    beforeAll(async () => {
      const completeness = await buildCompletenessRun("topology-capsule-completeness");
      const runReport = await buildRunReportCapsule();
      roots.push(completeness.repo, runReport.repo);
      capsules = [completeness.run, runReport.run];
    }, CAPSULE_BUILD_TIMEOUT_MS);

    afterAll(() => {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    });

    test(
      "every checked-in capsule exports a graph with singly-owned assets",
      () => {
        expect(capsules.length).toBeGreaterThan(0);
        for (const capsulePath of capsules) {
          const suite = generateSummarySuite({ capsulePath, writeToDisk: false });
          expect(suite.graph.nodes.length).toBeGreaterThan(0);
          expect(suite.graph.edges.length).toBeGreaterThan(0);
          for (const [url, count] of assetUrlCounts(suite.graph)) {
            expect(`${url}:${count}`).toBe(`${url}:1`);
          }
          expect(JSON.stringify(suite.graph)).not.toContain('"mediaAssets"');
        }
      },
      CAPSULE_BUILD_TIMEOUT_MS,
    );
  });

  test("a state written before probes, branches, grants and topology existed still exports", () => {
    const legacy = makeTask("task-1", {
      status: "done",
      report: { summary: "legacy", files_changed: ["src/legacy.ts"] },
      validation_history: [
        {
          validator_id: "validator-1",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-14T20:00:00.000Z",
          deadline_at: "2026-08-14T20:10:00.000Z",
          verdict: "reject",
        },
      ],
    });
    delete (legacy as { probe_round?: number }).probe_round;

    const dataset = generateGraphDataset({
      runId: "run-legacy",
      state: makeState([legacy]),
      promptText: "legacy prompt",
    });

    // validation_history's only entry is a rejection, so it is round 1 archived (B25.2) — the
    // identity lives at that round's own node, never duplicated onto the live id, since this
    // capsule records no live `validation` for the task to have actually gone through again.
    expect(dataset.nodes.find((node) => node.id === "node-validator-task-1-r1")?.name).toBe(
      "Validator: validator-1",
    );
    expect(dataset.nodes.find((node) => node.id === "node-validator-task-1")).toBeUndefined();
    expect(dataset.sections).toEqual([]);
    expect(dataset.edges.some((edge) => edge.kind === "probe")).toBe(false);
    expect(dataset.nodes.find((node) => node.id === "node-task-task-1")?.telemetry).toBeUndefined();
  });
});
