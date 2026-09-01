import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  setShellCommandDependenciesForTesting,
  shellCommand,
} from "../../../../olt/scripts/src/cli/commands/shell.ts";
import { runExecCommand } from "../../../../olt/scripts/src/cli/commands/run-ops.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../olt/scripts/src/runtime/index.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import { setupCompiledRun } from "../../commands/fixtures/task-ops-fixture.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../commands/fixtures/full-lifecycle-fixture.ts";

describe("CLI Shell Interlock - Capsule Lifecycle & Gate Execution", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
  });
  test("records task-only command evidence through the capsule lifecycle", async () => {
    const scratch = "/virtual/shell-capsule";
    await mkdir(scratch, { recursive: true });
    const promptPath = join(scratch, "prompt.txt");
    await writeFile(promptPath, "Test prompt for capsule shell command");
    await mkdir(join(scratch, "src/task01"), { recursive: true });
    await writeFile(join(scratch, "gate.ts"), "console.log('pass');\n");

    const init = await execute([
      "plan:init",
      "--repo",
      scratch,
      "--run",
      "shell-run-01",
      "--prompt-file",
      promptPath,
    ]);
    const runRoot = init.run_root as string;

    await execute([
      "plan:add",
      "--run",
      runRoot,
      "--id",
      "task-01",
      "--label",
      "Task 01",
      "--scope",
      "src/task01",
      "--gate",
      "bun gate.ts",
      "--actor",
      "planner",
    ]);
    await execute(["plan:brainstorm", "--run", runRoot, "--actor", "planner"]);
    await execute([
      "plan:compile",
      "--run",
      runRoot,
      "--actor",
      "planner",
      "--completion-gate",
      "bun gate.ts",
    ]);
    await execute([
      "agent:register",
      "--run",
      runRoot,
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
    ]);
    await execute([
      "task:claim",
      "--run",
      runRoot,
      "--task",
      "task-01",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
    ]);

    writeAgentMetadata(
      createAgentMetadata({
        agent_id: "worker-1",
        role: "implementer",
        write_scope: ["src/task01"],
        can_execute_shell: true,
      }),
      runRoot,
    );

    let runExecCalls = 0;
    const restore = setShellCommandDependenciesForTesting({
      runExecCommand: async (flags, ctx, argv) => {
        runExecCalls += 1;
        const res = await runExecCommand(flags, ctx, argv);
        if (argv.includes("missing-shell-input")) {
          return {
            ...res,
            exit_code: 1,
            markdown:
              "### Command Executed\n- **Exit Code**: `1`\n- **Output Summary**: Command returned non-zero exit code",
            command: { ...(res.command as Record<string, unknown>), exit_code: 1 },
          };
        }
        return res;
      },
    });
    let result: Awaited<ReturnType<typeof shellCommand>>;
    let failResult: Awaited<ReturnType<typeof shellCommand>>;
    try {
      result = await shellCommand(
        {
          actor: "worker-1",
          role: "implementer",
          run: runRoot,
          cwd: scratch,
          task: "task-01",
          wave: "1",
          "tool-category": "test-runner",
        },
        {},
        ["echo", "capsule-shell-recorded"],
      );

      failResult = await shellCommand(
        {
          actor: "worker-1",
          role: "implementer",
          run: runRoot,
          cwd: scratch,
          task: "task-01",
        },
        {},
        ["git", "diff", "--no-index", "prompt.txt", "missing-shell-input"],
      );
    } finally {
      restore();
    }

    expect(result.exit_code).toBe(0);
    expect(runExecCalls).toBe(2);
    expect(result.command).toBe("echo capsule-shell-recorded");
    expect(result.evidence_path).toBeDefined();
    expect(result.evidence_path).toContain(join(runRoot, "commands"));
    expect(result.markdown).toContain("Command completed successfully");

    expect(failResult.exit_code).not.toBe(0);
    expect(failResult.markdown).toContain("Command returned non-zero exit code");
  });

  test("delegates gates to run execution lifecycle with canonical output hashes", async () => {
    const { run: runRoot } = await setupCompiledRun("shell-gate-lifecycle", []);
    const actor = "impl-shell-gate-lifecycle";
    writeAgentMetadata(
      createAgentMetadata({
        agent_id: actor,
        role: "implementer",
        write_scope: ["src/"],
        can_execute_shell: true,
      }),
      runRoot,
    );
    const port = workflowPort(runRoot);
    port.transact("test", "shell-gate-setup", {}, (state) => {
      state.tasks["T-1"] = {
        id: "T-1",
        status: "validated",
        requirement_ids: ["R-1"],
        write_scope: ["src/owned"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        report: { summary: "shell gate fixture" },
        validations: [
          {
            validator_id: "validator",
            domain: "code-quality",
            token_digest: "digest",
            attempt: 1,
            started_at: "2026-08-01T00:00:00.000Z",
            deadline_at: "2026-08-01T01:00:00.000Z",
            verdict: "pass",
            reviewed_requirement_ids: ["R-1"],
            checks: [],
          },
        ],
      };
      state.requirements = [
        {
          id: "R-1",
          status: "planned",
          evidence: [],
          disposition: "actionable",
          dependencies: [],
        },
      ];
      state.gates = [
        {
          id: "G-1",
          command: ["echo", "gate"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["R-1"],
          mandatory: true,
        },
        {
          id: "G-2",
          command: ["echo", "gate"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["R-1"],
          mandatory: true,
        },
      ];
    });

    await expect(
      shellCommand(
        { actor, role: "implementer", run: runRoot, task: "T-1", gate: "not-applicable" },
        {},
        ["echo", "must-not-run"],
      ),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(Object.values(port.read().commands)).toHaveLength(0);

    const first = await shellCommand(
      { actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-1" },
      {},
      ["echo", "nonempty-shell-output"],
    );
    const firstState = port.read();
    const firstRecord = Object.values(firstState.commands)[0]!;
    expect(firstState.tasks["T-1"]).toMatchObject({
      status: "gating",
      gate_results: [{ gate_id: "G-1", status: "passed" }],
    });
    expect(first.stdout_sha256).toBe(firstRecord.logs?.stdout.sha256);
    expect(first.stdout_sha256).not.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );

    await expect(
      shellCommand({ actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-1" }, {}, [
        "echo",
        "duplicate-gate",
      ]),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(Object.values(port.read().commands)).toHaveLength(2);
    expect(port.read().tasks["T-1"]?.gate_results).toHaveLength(1);

    const final = await shellCommand(
      { actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-2" },
      {},
      ["echo", "final-gate"],
    );
    expect(final.exit_code).toBe(0);
    expect(port.read().tasks["T-1"]?.status).toBe("done");
    await expect(
      shellCommand({ actor, role: "implementer", run: runRoot, task: "T-1", gate: "G-2" }, {}, [
        "echo",
        "idempotent-gate",
      ]),
    ).resolves.toMatchObject({ exit_code: 0 });
  });
});
