import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { initCapsuleRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { registerAgentGrant } from "../../../../../olt/scripts/src/workflow/agents/grants.ts";
import { stageSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { writeAgentMetadata } from "../../../../../olt/scripts/src/runtime/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { requirementIds } from "../../fixtures/critic-run-fixture.ts";
import { registerInspectionCommand, setupReadyRun } from "../../fixtures/critic-ready-fixture.ts";
import { VALIDATOR } from "../../fixtures/probe-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(() => {
  cleanupVirtualCliFS();
});

function registerAgentDirect(run: string, agent: string, role: string, parentAgent?: string): void {
  stageSessionGrant({ runRoot: run, agentId: agent, role, host: "antigravity" });
  registerAgentGrant({
    runRoot: run,
    agentId: agent,
    role,
    parentAgentId: parentAgent ?? null,
    parentTaskId: null,
    host: "antigravity",
    authority: parentAgent
      ? { kind: "verified_parent", actorId: parentAgent }
      : { kind: "conditional_genesis" },
    maxAgents: 20,
    telemetry: {},
  });
  const agentTier = (
    role === "mind" ? 0 : role === "orchestrator" ? 1 : role === "coordinator" ? 2 : 3
  ) as 0 | 1 | 2 | 3;
  writeAgentMetadata(
    {
      agent_id: agent,
      role,
      token: `token-${agent}`,
      write_scope: ["tests/core"],
      allowed_read_scope: ["tests/core", "."],
      can_execute_shell: true,
      spawned_at: new Date().toISOString(),
      tools_granted: [],
      tier: agentTier,
      thinking_level: "low",
      registered_at: new Date().toISOString(),
    },
    run,
  );
}

function setupSummaryRun(name: string): { repo: string; run: string } {
  const repo = `/virtual/cli/summary-${name}`;
  const vfs = getVirtualCliFS();
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  vfs.mkdirSync(join(repo, "tests/core"), { recursive: true });
  vfs.writeFileSync(join(repo, "package.json"), "{}");
  const { runRoot } = initCapsuleRun(`summary-${name}`, { repo });
  const roster = [
    ["fixture-mind-root", "mind", undefined],
    ["fixture-orch-root", "orchestrator", "fixture-mind-root"],
    ["coordinator", "coordinator", "fixture-orch-root"],
    ["worker-1", "implementer", "coordinator"],
  ] as const;
  for (const [agent, role, parent] of roster) registerAgentDirect(runRoot, agent, role, parent);

  transact(runRoot, "test-setup", "init-summary-state", {}, (draft) => {
    draft.requirements = {
      requirements: [
        { id: "req-core", statement: "Core Unit Tests", disposition: "actionable" },
        { id: "req-sec", statement: "Secondary Tests", disposition: "actionable" },
      ],
    };
    draft.graph = {
      revision: 1,
      gates: [
        {
          id: "gate-core",
          scope: "task",
          command: "bun gate-core.ts",
          mandatory: true,
          requirement_ids: ["req-core"],
          cwd: ".",
        },
        {
          id: "gate-sec",
          scope: "task",
          command: "bun gate-sec.ts",
          mandatory: true,
          requirement_ids: ["req-sec"],
          cwd: ".",
        },
      ],
      nodes: [
        {
          id: "task-core",
          label: "Core Unit Tests",
          write_scope: ["tests/core"],
          gate_argv: ["bun", "gate-core.ts"],
          dependencies: [],
        },
        {
          id: "task-sec",
          label: "Secondary Tests",
          write_scope: ["tests/cli/sec"],
          gate_argv: ["bun", "gate-sec.ts"],
          dependencies: [],
        },
      ],
      edges: [],
    };
    draft.plan = {
      tasks: [
        {
          id: "task-core",
          label: "Core Unit Tests",
          scope: "tests/core",
          gate: "bun gate-core.ts",
          status: "ready",
          dependencies: [],
        },
        {
          id: "task-sec",
          label: "Secondary Tests",
          scope: "tests/cli/sec",
          gate: "bun gate-sec.ts",
          status: "ready",
          dependencies: [],
        },
      ],
    };
    draft.tasks = {
      "task-core": {
        id: "task-core",
        label: "Core Unit Tests",
        status: "ready",
        write_scope: ["tests/core"],
        requirement_ids: ["req-core"],
        dependencies: [],
        history: [],
        attempts: [],
      },
      "task-sec": {
        id: "task-sec",
        label: "Secondary Tests",
        status: "ready",
        write_scope: ["tests/cli/sec"],
        requirement_ids: ["req-sec"],
        dependencies: [],
        history: [],
        attempts: [],
      },
    };
  });
  return { repo, run: runRoot };
}

describe("run:status", () => {
  test("reports Executing phase and occupancy once plan compiled", async () => {
    const { run } = setupSummaryRun("run-status-executing");
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain("Executing");
    const catalogue = status.catalogue as { available: boolean };
    expect(catalogue.available).toBe(true);
    const occupancy = status.occupancy as { active: number; max_parallel: number };
    expect(occupancy.max_parallel).toBeGreaterThan(0);
  });

  test("--detailed is echoed through to the result", async () => {
    const { run } = setupSummaryRun("run-status-detailed");
    const status = await execute(["run:status", "--run", run, "--detailed"]);
    expect(status.detailed).toBe(true);
  });

  test("reports leased task agent and Leased status", async () => {
    const { run } = setupSummaryRun("run-status-leased");
    transact(run, "test-setup", "lease-task", {}, (draft) => {
      draft.tasks["task-core"]!.status = "leased";
      draft.tasks["task-core"]!.lease = {
        agent_id: "worker-1",
        role: "implementer",
        token: "tok-1",
        leased_at: new Date().toISOString(),
      };
    });
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain("worker-1");
  });

  test("reports validating task validator", async () => {
    const { run } = setupSummaryRun("run-status-validating");
    transact(run, "test-setup", "validating-task", {}, (draft) => {
      draft.tasks["task-core"]!.status = "validating";
      draft.tasks["task-core"]!.validations = [
        {
          validator_id: VALIDATOR,
          domain: "code-quality",
          attempt: 1,
          started_at: new Date().toISOString(),
          token_digest: "abc",
        },
      ];
    });
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain(VALIDATOR);
  });

  test("reports done task Satisfied status once validated", async () => {
    const { run } = setupSummaryRun("run-status-satisfied");
    transact(run, "test-setup", "satisfied-task", {}, (draft) => {
      draft.tasks["task-core"]!.status = "done";
      draft.tasks["task-core"]!.validation_history = [
        {
          validator_id: VALIDATOR,
          domain: "code-quality",
          verdict: "pass",
          attempt: 1,
          started_at: new Date().toISOString(),
          token_digest: "abc",
        },
      ];
    });
    const status = await execute(["run:status", "--run", run]);
    expect(String(status.markdown)).toContain("Satisfied");
  });
});

describe("run:complete", () => {
  test("refuses an invalid auth token", async () => {
    const roots: string[] = [];
    const { repo, run } = await setupReadyRun("run-complete-bad-token", roots);
    const cmdId = "C-INSPECT-BADTOKEN";
    registerInspectionCommand(run, repo, cmdId, "critic-2");
    const start = await execute([
      "critic:start",
      "--run",
      run,
      "--critic",
      "critic-2",
      "--repository-command-ids",
      cmdId,
    ]);
    const evidence = [{ kind: "command", reference: cmdId, observation: "gate covers it" }];
    const proofs = JSON.stringify(
      requirementIds(run).map((id) => ({ requirement_id: id, status: "satisfied", evidence })),
    );
    await execute([
      "critic:review",
      "--run",
      run,
      "--critic",
      "critic-2",
      "--token",
      start.token as string,
      "--decision",
      "approve",
      "--proofs",
      proofs,
      "--summary",
      "All requirements verified",
    ]);
    await expect(
      execute([
        "run:complete",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--auth-token",
        "not-the-real-token",
      ]),
    ).rejects.toThrow(/completion authorization token is invalid/);
  });
});

describe("summary:export / summary:view", () => {
  test("summary:export writes summary suite to disk and reports artifact paths", async () => {
    const { run } = setupSummaryRun("summary-export");
    const exported = await execute(["summary:export", "--run", run]);
    expect(exported.summary_dir).toBe(join(run, "summary"));
    expect(String(exported.markdown)).toContain("Summary Suite Exported");
    const suite = exported.suite as {
      graph: { nodes: unknown[] };
      metrics: { total_tasks: number };
    };
    expect(suite.metrics.total_tasks).toBe(2);
  });

  test("summary:export honours --out with registry export path", async () => {
    const { repo, run } = setupSummaryRun("summary-export-out");
    const outDir = join(repo, "registry-out");
    getVirtualCliFS().mkdirSync(outDir, { recursive: true });
    const exported = await execute(["summary:export", "--run", run, "--out", outDir]);
    expect(exported.out_dir).toBe(outDir);
    expect(String(exported.markdown)).toContain("GVUI Registry Export");
  });

  test("summary:view renders brief without writing anything to disk", async () => {
    const { run } = setupSummaryRun("summary-view");
    const viewed = await execute(["summary:view", "--run", run]);
    expect(typeof viewed.markdown).toBe("string");
    expect(viewed.metrics).toBeDefined();
    expect(viewed.timeline).toBeDefined();
  });
});
