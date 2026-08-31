import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunState } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { renderHandoff } from "../../../../olt/scripts/src/reporting/handoff.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { dispatchFailures, handoffArgv } from "../core/dispatchable.ts";

const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

const TASKS = {
  "task-1": {
    id: "task-1",
    status: "done",
    requirement_ids: ["R-1"],
    dependencies: [],
    write_scope: ["src/one/**"],
    attempts: [],
    history: [],
    repair_round: 0,
    probe_round: 1,
  },
  "task-2": {
    id: "task-2",
    status: "branched",
    requirement_ids: ["R-2"],
    dependencies: ["task-1"],
    write_scope: ["src/two/**"],
    attempts: [],
    history: [],
    repair_round: 1,
    findings: [
      { id: "F-1", status: "open", class: "defect", requirement_id: "R-2", round: 1 },
      { id: "F-2", status: "resolved", class: "probe_demand", requirement_id: "R-2", round: 1 },
    ],
  },
};

const BRANCH = {
  id: "B-1",
  parent_task_id: "task-2",
  parent_agent_id: "worker-2",
  reason: "the parser rewrite blocks the API change",
  depth: 1,
  status: "open",
  opened_at: "2026-08-13T12:00:00.000Z",
  sub_tasks: [
    {
      id: "S-1",
      label: "Fix the parser",
      write_scope: ["src/two/parser"],
      status: "claimed",
      agent_id: "sub-1",
    },
  ],
};

const TOPOLOGY = {
  revision: 1,
  max_parallel: 4,
  waves: [
    { wave: 1, task_ids: ["task-1"] },
    { wave: 2, task_ids: ["task-2"] },
  ],
  decisions: [
    {
      task_id: "task-2",
      wave: 2,
      parallel_with: [],
      serialized_after: ["task-1"],
      reason: "dependency",
      rationale: "task-2 depends on task-1",
      evidence_class: "derived",
    },
  ],
};

/** The host reported nothing about this agent beyond its identity and its role. */
const UNDESCRIBED_AGENT = {
  id: "worker-2",
  role: "implementer",
  parent_agent_id: "coordinator",
  parent_task_id: "task-2",
  host: "claude-code",
  granted_at: "2026-08-13T12:00:00.000Z",
  status: "active",
};

const DESCRIBED_AGENT = {
  ...UNDESCRIBED_AGENT,
  id: "sub-1",
  role: "sub-implementer",
  parent_agent_id: "worker-2",
  model: { value: "some-model-id", evidence_class: "host_reported" },
  tokens_in: { value: 1200, evidence_class: "derived", is_estimated: true },
};

async function capsule(name: string, mutate: (state: RunState) => void = () => {}) {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const run = initRun(repo, name, new TextEncoder().encode("Keep every instruction"), "file", true);
  transact(run, "planner", "plan-applied", {}, (state) => {
    state.graph = { revision: 3, gates: [] };
    state.requirements = {
      requirements: [
        { id: "R-1", disposition: "actionable", status: "satisfied", evidence: ["C-1"] },
        { id: "R-2", disposition: "actionable", status: "planned", evidence: [] },
      ],
    };
    state.tasks = structuredClone(TASKS);
    mutate(state);
  });
  return run;
}

describe("the handoff reflects the system a fresh agent is joining", () => {
  test("reports the live wave, the grants, the branches and the open findings", async () => {
    const run = await capsule("handoff-current", (state) => {
      state.topology = structuredClone(TOPOLOGY);
      state.agents = [structuredClone(UNDESCRIBED_AGENT), structuredClone(DESCRIBED_AGENT)];
      state.branches = [structuredClone(BRANCH)];
    });
    const document = renderHandoff(run);

    expect(document).toContain("Live wave: 2 of 2 recorded (revision 1, max_parallel 4)");
    expect(document).toContain('{"wave":1,"tasks":[{"id":"task-1","status":"done"}]}');
    expect(document).toContain('{"wave":2,"tasks":[{"id":"task-2","status":"branched"}]}');
    expect(document).toContain('"id":"worker-2","role":"implementer","status":"active"');
    expect(document).toContain("the parser rewrite blocks the API change");
    expect(document).toContain('{"task_id":"task-2","finding_id":"F-1"}');
    expect(document).not.toContain('"finding_id":"F-2"');
    expect(dispatchFailures(handoffArgv(document))).toEqual([]);
  });

  test("renders telemetry the host never reported as unknown", async () => {
    const run = await capsule("handoff-unknown", (state) => {
      state.agents = [structuredClone(UNDESCRIBED_AGENT), structuredClone(DESCRIBED_AGENT)];
    });
    const document = renderHandoff(run);
    const grants = document.slice(document.indexOf("## Agent grants")).split("\n");
    const undescribed = grants.find((line) => line.includes('"id":"worker-2"'))!;
    const described = grants.find((line) => line.includes('"id":"sub-1"'))!;

    expect(JSON.parse(undescribed)).toMatchObject({
      model: "unknown",
      model_tier: "unknown",
      thinking_level: "unknown",
      tokens_in: "unknown",
      tokens_out: "unknown",
      released_at: null,
    });
    expect(JSON.parse(described)).toMatchObject({
      model: { value: "some-model-id", evidence_class: "host_reported" },
      tokens_in: { value: 1200, evidence_class: "derived", is_estimated: true },
      tokens_out: "unknown",
    });
  });

  test("reports an absent topology as absent rather than deriving one", async () => {
    const run = await capsule("handoff-no-topology");
    const document = renderHandoff(run);
    expect(document).toContain(
      "Live wave: unknown (no topology recorded; plan:compile records one)",
    );
    expect(document).toContain("no topology recorded");
    expect(document).toContain("no agent grants recorded");
  });

  test("reports a topology that no unfinished task appears in", async () => {
    const run = await capsule("handoff-stale-topology", (state) => {
      state.topology = { ...structuredClone(TOPOLOGY), waves: [{ wave: 1, task_ids: ["task-1"] }] };
    });
    expect(renderHandoff(run)).toContain(
      "Live wave: unknown, no unfinished task appears in the 1 recorded wave(s); 1 unfinished task(s) outside the recorded topology",
    );
  });

  test("reports every wave as finished when every task is done", async () => {
    const run = await capsule("handoff-finished", (state) => {
      state.topology = structuredClone(TOPOLOGY);
      const tasks = state.tasks as Record<string, { status: string }>;
      tasks["task-2"]!.status = "done";
    });
    expect(renderHandoff(run)).toContain(
      "Live wave: none, every task in the 2 recorded wave(s) is done",
    );
  });

  test("keeps an uncollected branch and its next command in front of the reader", async () => {
    const run = await capsule("handoff-branch", (state) => {
      state.branches = [structuredClone(BRANCH)];
    });
    const document = renderHandoff(run);
    const branchSection = document.slice(
      document.indexOf("## Branches"),
      document.indexOf("## Tasks"),
    );
    expect(branchSection).toContain('"id":"B-1"');
    expect(branchSection).toContain('"status":"open"');
    expect(branchSection).toContain('"agent_id":"sub-1"');
    const argv = handoffArgv(document).map((entry) => entry.join(" "));
    expect(
      argv.some((entry) => entry.includes("branch:submit") && entry.includes("--branch B-1")),
    ).toBeTrue();
    expect(
      argv.some((entry) => entry.includes("branch:status") && entry.includes("--all")),
    ).toBeTrue();
    expect(dispatchFailures(handoffArgv(document))).toEqual([]);
  });
});
