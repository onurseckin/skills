import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { generateSummarySuite } from "../../../orchestrating-long-tasks/scripts/src/summary/generate-summary.ts";
import { generateGraphDataset } from "../../../orchestrating-long-tasks/scripts/src/summary/graph-generator.ts";
import { assetUrlCounts, makeState, makeTask } from "./graph-fixtures.ts";

const capsulesRoot = join(import.meta.dir, "..", "..", "..", ".capsules");

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
  const capsules = readdirSync(capsulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(capsulesRoot, entry.name));

  test("every checked-in capsule exports a graph with singly-owned assets", () => {
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

    expect(dataset.nodes.find((node) => node.id === "node-validator-task-1")?.name).toBe(
      "Validator: validator-1",
    );
    expect(dataset.sections).toEqual([]);
    expect(dataset.edges.some((edge) => edge.kind === "probe")).toBe(false);
    expect(dataset.nodes.find((node) => node.id === "node-task-task-1")?.telemetry).toBeUndefined();
  });
});
