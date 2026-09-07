import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { HarnessError } from "../olt/scripts/src/core/errors/index.ts";
import {
  gateProofCommand,
  resolveCheckIds,
} from "../olt/scripts/src/cli/commands/task-review-support.ts";
import { execute } from "../olt/scripts/src/cli/execute.ts";
import { initCapsuleRun, transact } from "../olt/scripts/src/engine/store/index.ts";
import { tokenDigest } from "../olt/scripts/src/workflow/lease/token.ts";
import { registerAgentGrant } from "../olt/scripts/src/workflow/agents/grants.ts";
import { stageSessionGrant } from "../olt/scripts/src/authority/session/index.ts";
import { writeAgentMetadata } from "../olt/scripts/src/runtime/index.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "./cli/commands/fixtures/full-lifecycle-fixture.ts";
import {
  TASK_ID,
  VALIDATOR,
  CHANGED_FILE,
  answeredBy,
  recordProbe,
  seedGateProof,
} from "./cli/commands/fixtures/probe-fixture.ts";

const cmd = (id: string, task_id: string, actor: string, exit_code: number) => ({
  id,
  task_id,
  actor,
  exit_code,
});

describe("resolveCheckIds - Detached Evidence and Actor Fallback", () => {
  test("handles missing, invalid, or fallback commands correctly", () => {
    expect(resolveCheckIds(undefined, undefined, "task-1", "val-1", false)).toEqual([]);
    expect(resolveCheckIds(undefined, null, "task-1", "val-1", true)).toEqual([]);
    expect(resolveCheckIds(undefined, "not-an-object", "task-1", "val-1", true)).toEqual([]);

    const c1 = {
      "cmd-1": cmd("cmd-1", "task-1", "val-1", 0),
      "cmd-2": cmd("cmd-2", "task-1", "val-1", 1),
      "cmd-3": cmd("cmd-3", "task-1", "imp-1", 0),
    };
    expect(resolveCheckIds(undefined, c1, "task-1", "val-1", true)).toEqual(["cmd-1"]);
    expect(resolveCheckIds(undefined, c1, "task-1", "val-1", false)).toEqual(["cmd-1", "cmd-2"]);

    const c2 = {
      "cmd-p": cmd("cmd-p", "task-1", "imp-1", 0),
      "cmd-f": cmd("cmd-f", "task-1", "imp-1", 1),
    };
    expect(resolveCheckIds(undefined, c2, "task-1", "cog-1", true)).toEqual(["cmd-p"]);
    expect(resolveCheckIds(undefined, c2, "task-1", "cog-1", false)).toEqual(["cmd-p", "cmd-f"]);
  });

  test("accepts and validates explicit detached evidence commands", () => {
    const c = {
      "cmd-g": cmd("cmd-g", "task-1", "imp-1", 0),
      "cmd-u": cmd("cmd-u", "task-1", "imp-1", 0),
      "cmd-o": cmd("cmd-o", "task-2", "imp-1", 0),
    };
    expect(resolveCheckIds("cmd-g", c, "task-1", "cog-1", true)).toEqual(["cmd-g"]);
    expect(resolveCheckIds(" cmd-g , cmd-u ", c, "task-1", "cog-1", true)).toEqual([
      "cmd-g",
      "cmd-u",
    ]);
    expect(() => resolveCheckIds("cmd-o", c, "task-1", "val-1", true)).toThrow(HarnessError);
    expect(() => resolveCheckIds("missing", c, "task-1", "val-1", true)).toThrow(HarnessError);
    expect(resolveCheckIds("a, b", {}, "task-1", "val-1", false)).toEqual(["a", "b"]);
    expect(resolveCheckIds("a, b", null, "task-1", "val-1", true)).toEqual(["a", "b"]);
  });

  test("gateProofCommand finds gate proof command from checkIds with fallback to passing check", () => {
    const c = {
      "cmd-g1": { gate_id: "gate-1", exit_code: 0 },
      "cmd-g2": { gate_id: "gate-2", exit_code: 0 },
      "cmd-pass": { gate_id: null, exit_code: 0 },
      "cmd-fail": { gate_id: null, exit_code: 1 },
    };
    expect(gateProofCommand(c, "gate-1", ["cmd-g1", "cmd-pass"])).toBe("cmd-g1");
    expect(gateProofCommand(c, "gate-2", ["cmd-fail", "cmd-pass"])).toBe("cmd-pass");
    expect(gateProofCommand(c, "gate-2", ["cmd-fail"])).toBe("cmd-fail");
    expect(gateProofCommand(c, "gate-1", [])).toBeUndefined();
  });
});

describe("Cognitive Validator Detached Evidence Integration", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
  });

  function reg(runRoot: string, agent: string, role: string, parent?: string): void {
    stageSessionGrant({ runRoot, agentId: agent, role, host: "antigravity" });
    registerAgentGrant({
      runRoot,
      agentId: agent,
      role,
      parentAgentId: parent ?? null,
      parentTaskId: null,
      host: "antigravity",
      authority: parent
        ? { kind: "verified_parent", actorId: parent }
        : { kind: "conditional_genesis" },
      maxAgents: 20,
      telemetry: {},
    });
    const now = new Date().toISOString();
    writeAgentMetadata(
      {
        agent_id: agent,
        role,
        token: `tok-${agent}`,
        write_scope: ["tests/core"],
        allowed_read_scope: ["."],
        can_execute_shell: true,
        spawned_at: now,
        tools_granted: [],
        tier: role === "coordinator" ? 2 : 3,
        thinking_level: "low",
        registered_at: now,
      },
      runRoot,
    );
  }

  async function setupRun(
    name: string,
  ): Promise<{ repo: string; run: string; token: string; gateCmd: string }> {
    const repo = `/virtual/cli/cognitive-${name}`;
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

    const { runRoot } = initCapsuleRun(`cognitive-${name}`, { repo });
    reg(runRoot, "coordinator", "coordinator");
    reg(runRoot, "worker-core", "implementer", "coordinator");
    reg(runRoot, VALIDATOR, "validator", "coordinator");

    const token = "tok_test_val_123";
    transact(runRoot, "test-setup", "init-review-state", {}, (d) => {
      d.gates = [{ id: "gate-core", scope: "task", command: "bun gate-core.ts" }];
      d.requirements = { requirements: [{ id: "req-core", statement: "Core Unit Tests" }] };
      d.packets = {
        [`p-${TASK_ID}-val`]: {
          id: `p-${TASK_ID}-val`,
          task_id: TASK_ID,
          role: "validator",
          agent_id: VALIDATOR,
          status: "published",
          attempt: 1,
        },
      };
      d.tasks = {
        [TASK_ID]: {
          id: TASK_ID,
          label: "Core",
          status: "validating",
          write_scope: ["tests/core"],
          requirement_ids: ["req-core"],
          original_implementer: "worker-core",
          bypass_cognitive_pushback: true,
          report: { summary: "Implemented" },
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
    return { repo, run: runRoot, token, gateCmd: gateExec.command_id as string };
  }

  test("cognitive validator can approve task with mandatory gate referencing implementer check ID via --evidence", async () => {
    const { run, token, gateCmd } = await setupRun("detached-evidence");
    seedGateProof(run, TASK_ID);
    const probed = await recordProbe(run, token, "Cognitive probe demand");
    const passed = await execute([
      "task:review",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      token,
      "--evidence",
      gateCmd,
      ...answeredBy(probed.finding_ids, gateCmd).flatMap((answer) => ["--resolve", answer]),
      "--status",
      "pass",
      "--summary",
      "Cognitive validation verified implementer gate proof cleanly",
    ]);
    expect(passed.verdict).toBe("pass");
    expect((passed.task as { status: string }).status).toBe("done");
    expect((passed.resolved_findings as unknown[]).length).toBe(1);
  });

  test("cognitive validator can approve task with mandatory gate with omitted --evidence fallback to implementer gate", async () => {
    const { run, token, gateCmd } = await setupRun("auto-fallback");
    seedGateProof(run, TASK_ID);
    const probed = await recordProbe(run, token, "Cognitive probe demand");
    const passed = await execute([
      "task:review",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
      "--token",
      token,
      ...answeredBy(probed.finding_ids, gateCmd).flatMap((answer) => ["--resolve", answer]),
      "--status",
      "pass",
      "--summary",
      "Cognitive validation automatically resolves implementer gate proof",
    ]);
    expect(passed.verdict).toBe("pass");
    expect((passed.task as { status: string }).status).toBe("done");
    expect((passed.resolved_findings as unknown[]).length).toBe(1);
  });
});
