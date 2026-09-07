import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { initCapsuleRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { tokenDigest } from "../../../../../olt/scripts/src/workflow/lease/token.ts";
import { registerAgentGrant } from "../../../../../olt/scripts/src/workflow/agents/grants.ts";
import { stageSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import { writeAgentMetadata } from "../../../../../olt/scripts/src/runtime/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import {
  TASK_ID,
  VALIDATOR,
  CHANGED_FILE,
  answeredBy,
  findingIdsFrom,
  recordProbe,
  recordProbeRounds,
  reviewPass,
  seedGateProof,
} from "../../fixtures/probe-fixture.ts";

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

function setTestingEnabled(enabled: boolean): void {
  const repoRoot = process.cwd();
  getVirtualCliFS().writeFileSync(
    join(repoRoot, ".olt", "policy.json"),
    JSON.stringify({
      schema_version: 1,
      ecosystem: "bun",
      test_runner: enabled ? { enabled: true, default_command: "bun test" } : { enabled: false },
    }),
  );
}

async function setupReviewRunWithTestGate(
  name: string,
): Promise<{ run: string; token: string; gateCmd: string }> {
  const repo = `/virtual/cli/probe-${name}`;
  const vfs = getVirtualCliFS();
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  vfs.mkdirSync(join(repo, "tests/core"), { recursive: true });
  vfs.mkdirSync(join(repo, ".olt"), { recursive: true });
  vfs.writeFileSync(
    join(repo, "harness.config.json"),
    JSON.stringify({ min_adversarial_probes: 1 }),
  );
  vfs.writeFileSync(
    join(repo, ".olt", "policy.json"),
    JSON.stringify({
      schema_version: 1,
      ecosystem: "bun",
      package_manager: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
      },
      review_protocol: { max_adversarial_pushes: 20, cognitive_pushes: 1 },
    }),
  );
  vfs.writeFileSync(
    join(repo, CHANGED_FILE),
    "export const probed = true;\nexport const implemented = true;\n",
  );
  vfs.writeFileSync(join(repo, "gate-core.ts"), "console.log('gate-core');\n");

  const { runRoot } = initCapsuleRun(`probe-${name}`, { repo });
  const roster = [
    ["fixture-mind-root", "mind", undefined],
    ["fixture-orch-root", "orchestrator", "fixture-mind-root"],
    ["coordinator", "coordinator", "fixture-orch-root"],
    ["worker-core", "implementer", "coordinator"],
    [VALIDATOR, "validator", "coordinator"],
  ] as const;
  for (const [agent, role, parent] of roster) registerAgentDirect(runRoot, agent, role, parent);

  const token = "tok_test_val_123";
  transact(runRoot, "test-setup", "init-review-state", {}, (draft) => {
    draft.gates = [{ id: "gate-core", scope: "task", command: "bun gate-core.ts" }];
    draft.requirements = {
      requirements: [{ id: "req-core", statement: "Core Unit Tests", disposition: "actionable" }],
    };
    draft.plan = {
      tasks: [
        {
          id: TASK_ID,
          label: "Core Unit Tests",
          scope: "tests/core",
          gate: "bun gate-core.ts",
          status: "validating",
        },
      ],
    };
    draft.graph = {
      revision: 1,
      gates: [
        {
          id: "gate-unit-tests",
          scope: "task",
          command: ["bun", "test"],
          cwd: ".",
          mandatory: true,
          requirement_ids: ["req-core"],
        },
      ],
      nodes: [
        {
          id: TASK_ID,
          label: "Core Unit Tests",
          write_scope: ["tests/core"],
          gate_argv: ["bun", "gate-core.ts"],
        },
      ],
      edges: [],
    };
    draft.packets = {
      [`packet-${TASK_ID}-val`]: {
        id: `packet-${TASK_ID}-val`,
        task_id: TASK_ID,
        role: "validator",
        agent_id: VALIDATOR,
        status: "published",
        attempt: 1,
      },
      [`packet-${TASK_ID}-imp`]: {
        id: `packet-${TASK_ID}-imp`,
        task_id: TASK_ID,
        role: "implementer",
        agent_id: "worker-core",
        status: "published",
        attempt: 1,
      },
    };
    draft.tasks = {
      [TASK_ID]: {
        id: TASK_ID,
        label: "Core Unit Tests",
        status: "validating",
        write_scope: ["tests/core"],
        requirement_ids: ["req-core"],
        original_implementer: "worker-core",
        report: { summary: "Implemented the task under test" },
        attempts: [
          {
            attempt: 1,
            agent_id: "worker-core",
            claimed_base_sha: { value: "0123456789abcdef0123456789abcdef01234567" },
            files_changed: [CHANGED_FILE],
            submitted_at: new Date().toISOString(),
          },
        ],
        validations: [
          {
            validator_id: VALIDATOR,
            domain: "code-quality",
            attempt: 1,
            token_digest: tokenDigest(token),
            started_at: new Date().toISOString(),
          },
        ],
      },
    };
  });

  const gateExec = await execute([
    "run:exec",
    "--run",
    runRoot,
    "--task",
    TASK_ID,
    "--actor",
    "worker-core",
    "--cwd",
    repo,
    "--",
    "bun",
    "gate-core.ts",
  ]);
  return { run: runRoot, token, gateCmd: gateExec.command_id as string };
}

describe("task:review - testing-disabled bypass for mandatory test gates", () => {
  test("rejects a pass missing the test-gate receipt when testing is enabled", async () => {
    setTestingEnabled(true);
    const { run, token, gateCmd } = await setupReviewRunWithTestGate("testing-enabled-control");
    seedGateProof(run, TASK_ID);

    const probed = await recordProbe(run, token, "Prove it works");
    await expect(execute(reviewPass(run, token, gateCmd))).rejects.toThrow(/open finding/);
    const laterRounds = await recordProbeRounds(run, token, "Prove it works", 2, 5);
    const allFindingIds = findingIdsFrom([probed, ...laterRounds]);

    await expect(
      execute(reviewPass(run, token, gateCmd, answeredBy(allFindingIds, gateCmd))),
    ).rejects.toThrow(/not successful validator evidence/);
  });

  test("passes without a test-execution receipt when testing is disabled", async () => {
    setTestingEnabled(false);
    const { run, token, gateCmd } = await setupReviewRunWithTestGate("testing-disabled");
    seedGateProof(run, TASK_ID);

    const probed = await recordProbe(run, token, "Prove it works");
    await expect(execute(reviewPass(run, token, gateCmd))).rejects.toThrow(/open finding/);
    const laterRounds = await recordProbeRounds(run, token, "Prove it works", 2, 5);
    const allFindingIds = findingIdsFrom([probed, ...laterRounds]);

    const passed = await execute(
      reviewPass(run, token, gateCmd, answeredBy(allFindingIds, gateCmd)),
    );
    expect(passed.verdict).toBe("pass");
    expect((passed.task as { status: string }).status).toBe("done");
  });
});
