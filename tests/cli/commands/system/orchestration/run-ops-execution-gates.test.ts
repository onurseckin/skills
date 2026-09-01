import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInitCommand } from "../../../../../olt/scripts/src/cli/commands/run-init.ts";
import { runExecCommand } from "../../../../../olt/scripts/src/cli/commands/run-ops.ts";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { workflowPort } from "../../../../../olt/scripts/src/integration/store-ports.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

beforeEach(() => {
  setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function createTestRepo(name: string): { repo: string; promptFile: string } {
  const repo = `/virtual/cli/run-exec-${name}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(join(repo, ".git"), { recursive: true });
  const promptFile = join(repo, "prompt.txt");
  writeFileSync(promptFile, "Run execution tests prompt\n");
  return { repo, promptFile };
}

function grantAgent(runRoot: string, actor: string): void {
  writeAgentMetadata(
    createAgentMetadata({
      agent_id: actor,
      role: "implementer",
      write_scope: ["src/"],
      can_execute_shell: true,
    }),
    runRoot,
  );
}

describe("runExecCommand gate preflight & authorization", () => {
  test("rejects command when actor lacks durable metadata or violates policy", async () => {
    const { repo } = createTestRepo("exec-auth");
    writeFileSync(
      join(repo, ".olt", "policy.json"),
      JSON.stringify({ forbidden_commands: ["forbidden-cmd"] }),
    );
    const initRes = await runInitCommand({
      run: "run-exec-auth",
      repo,
      prompt: "Exec prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;

    await expect(
      runExecCommand({ run: runRoot, actor: "unregistered-actor" }, {}, ["echo", "test"]),
    ).rejects.toMatchObject({ code: "ROLE_CONFINEMENT_VIOLATION" });

    grantAgent(runRoot, "worker-1");
    await expect(
      runExecCommand({ run: runRoot, actor: "worker-1" }, {}, ["forbidden-cmd"]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  test("validates task gate applicability and task status requirements", async () => {
    const { repo } = createTestRepo("exec-task-gates");
    const initRes = await runInitCommand({
      run: "run-exec-tg",
      repo,
      prompt: "Exec prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;
    const actor = "worker-1";
    grantAgent(runRoot, actor);

    const port = workflowPort(runRoot);
    port.transact(actor, "setup-task-states", {}, (workflow) => {
      workflow.graph_revision = 1;
      workflow.tasks["task-missing-gate"] = {
        id: "task-missing-gate",
        status: "validated",
        requirement_ids: [],
        write_scope: ["src/"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      };
      workflow.tasks["task-ready"] = {
        id: "task-ready",
        status: "ready",
        requirement_ids: ["req-1"],
        write_scope: ["src/"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      };
      workflow.requirements = [
        {
          id: "req-1",
          status: "planned",
          disposition: "actionable",
          evidence: [],
          dependencies: [],
        },
      ];
      workflow.gates = [
        {
          id: "gate-1",
          command: ["echo", "1"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["req-1"],
          mandatory: true,
        },
      ];
    });

    await expect(
      runExecCommand({ run: runRoot, actor, task: "unknown-task", gate: "gate-1" }, {}, [
        "echo",
        "1",
      ]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      runExecCommand(
        { run: runRoot, actor, task: "task-missing-gate", gate: "gate-non-existent" },
        {},
        ["echo", "1"],
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      runExecCommand({ run: runRoot, actor, task: "task-ready", gate: "gate-1" }, {}, [
        "echo",
        "1",
      ]),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  test("supports run-scoped gate checks, unpassed gate rejection on done tasks, and idempotency", async () => {
    const { repo } = createTestRepo("exec-run-gates");
    const initRes = await runInitCommand({
      run: "run-exec-rg",
      repo,
      prompt: "Exec prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;
    const actor = "worker-1";
    grantAgent(runRoot, actor);

    const port = workflowPort(runRoot);
    port.transact(actor, "setup-run-gates", {}, (workflow) => {
      workflow.graph_revision = 1;
      workflow.tasks["task-done"] = {
        id: "task-done",
        status: "done",
        requirement_ids: ["req-1"],
        write_scope: ["src/"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        gate_results: [{ gate_id: "gate-task-1", status: "passed", command_id: "c-1" }],
      };
      workflow.requirements = [
        {
          id: "req-1",
          status: "planned",
          disposition: "actionable",
          evidence: [],
          dependencies: [],
        },
      ];
      workflow.gates = [
        {
          id: "gate-task-1",
          command: ["echo", "t1"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["req-1"],
          mandatory: true,
        },
        {
          id: "gate-task-2",
          command: ["echo", "t2"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["req-1"],
          mandatory: true,
        },
        {
          id: "gate-run",
          command: ["echo", "run"],
          cwd: ".",
          scope: "run",
          requirement_ids: [],
          mandatory: true,
        },
      ];
    });

    await expect(
      runExecCommand({ run: runRoot, actor, gate: "gate-non-existent-run" }, {}, ["echo", "test"]),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    const runGateRes = await runExecCommand({ run: runRoot, actor, gate: "gate-run" }, {}, [
      "echo",
      "test",
    ]);
    expect(runGateRes.exit_code).toBe(0);

    const doneTaskIdempotent = await runExecCommand(
      { run: runRoot, actor, task: "task-done", gate: "gate-task-1" },
      {},
      ["echo", "test"],
    );
    expect(doneTaskIdempotent.exit_code).toBe(0);

    await expect(
      runExecCommand({ run: runRoot, actor, task: "task-done", gate: "gate-task-2" }, {}, [
        "echo",
        "test",
      ]),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  test("executes command, captures evidence, and finishes task", async () => {
    const { repo } = createTestRepo("exec-full");
    const initRes = await runInitCommand({
      run: "run-exec-finish",
      repo,
      prompt: "Exec prompt",
      "no-runtime-pin": true,
    });
    const runRoot = initRes.run_root as string;
    const actor = "worker-1";
    grantAgent(runRoot, actor);

    const port = workflowPort(runRoot);
    port.transact(actor, "setup-task-validating", {}, (workflow) => {
      workflow.graph_revision = 1;
      workflow.tasks["task-1"] = {
        id: "task-1",
        status: "validated",
        requirement_ids: ["req-1"],
        write_scope: ["src/"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        report: { summary: "passed review report" },
        validations: [
          {
            validator_id: "val-1",
            domain: "code-quality",
            token_digest: "tok",
            attempt: 1,
            started_at: "2026-09-01T00:00:00.000Z",
            deadline_at: "2026-09-01T01:00:00.000Z",
            verdict: "pass",
            reviewed_requirement_ids: ["req-1"],
            checks: [],
          },
        ],
      };
      workflow.requirements = [
        {
          id: "req-1",
          status: "planned",
          disposition: "actionable",
          evidence: [],
          dependencies: [],
        },
      ];
      workflow.gates = [
        {
          id: "gate-1",
          command: ["echo", "pass"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["req-1"],
          mandatory: true,
        },
      ];
    });

    const result = await runExecCommand(
      { run: runRoot, actor, task: "task-1", gate: "gate-1", cwd: repo },
      {},
      ["echo", "pass"],
    );

    expect(result.exit_code).toBe(0);
    expect(result.command_id).toBeDefined();

    const finalState = port.read();
    expect(finalState.tasks["task-1"]?.status).toBe("done");
  });
});

describe("CLI Registry Execution & JSON Serialization", () => {
  test("executes run:init via execute and formats valid json output", async () => {
    const { repo } = createTestRepo("cli-run-init");
    const res = await execute([
      "run:init",
      "--run",
      "cli-run-1",
      "--repo",
      repo,
      "--prompt",
      "CLI prompt",
    ]);

    expect(res.run_id).toBe("cli-run-1");
    expect(res.existed).toBe(false);
    expect(JSON.stringify(res)).toContain("cli-run-1");
  });

  test("executes run:status via execute and preserves markdown output", async () => {
    const { repo } = createTestRepo("cli-run-status");
    const initRes = await execute([
      "run:init",
      "--run",
      "cli-run-2",
      "--repo",
      repo,
      "--prompt",
      "CLI status prompt",
    ]);
    const runRoot = initRes.run_root as string;

    const statusRes = await execute(["run:status", "--run", runRoot, "--repo", repo]);
    expect(statusRes.run_root).toBe(runRoot);
    expect(String(statusRes.markdown)).toContain("cli-run-2");
  });
});
