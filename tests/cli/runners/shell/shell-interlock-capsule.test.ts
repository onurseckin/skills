import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  setShellCommandDependenciesForTesting,
  shellCommand,
} from "../../../../olt/scripts/src/cli/commands/shell.ts";
import {
  createAgentMetadata,
  writeAgentMetadata,
} from "../../../../olt/scripts/src/runtime/index.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import { initRun } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../commands/fixtures/full-lifecycle-fixture.ts";

describe("CLI Shell Interlock - Capsule Lifecycle", () => {
  let vfs: ReturnType<typeof setupVirtualCliFS>;

  beforeEach(() => {
    vfs = setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
  });

  test("records task-only command evidence through the capsule lifecycle", async () => {
    const scratch = "/virtual/shell-capsule";
    vfs.mkdirSync(scratch, { recursive: true });
    vfs.mkdirSync(join(scratch, ".git"), { recursive: true });
    vfs.writeFileSync(join(scratch, "prompt.txt"), "Test prompt");
    vfs.mkdirSync(join(scratch, "src/task01"), { recursive: true });
    vfs.writeFileSync(join(scratch, "gate.ts"), "console.log('pass');\n");

    const runRoot = initRun(
      scratch,
      "shell-run-01",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    const port = workflowPort(runRoot);
    port.transact("test", "init-capsule-task", {}, (state) => {
      state.graph_revision = 1;
      state.tasks["task-01"] = {
        id: "task-01",
        status: "leased",
        requirement_ids: ["R-1"],
        write_scope: ["src/task01"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
        bypass_cognitive_pushback: true,
        report: { summary: "Task 01" },
        validations: [],
      };
      state.requirements = [
        { id: "R-1", status: "planned", evidence: [], disposition: "actionable", dependencies: [] },
      ];
      state.gates = [
        {
          id: "gate-01",
          command: ["bun", "gate.ts"],
          cwd: ".",
          scope: "task",
          requirement_ids: ["R-1"],
          mandatory: true,
        },
      ];
    });

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
      runExecCommand: async (_flags, _ctx, argv) => {
        runExecCalls += 1;
        const commandId = `cmd-${runExecCalls}`;
        const isFail = argv.includes("missing-shell-input");
        const exitCode = isFail ? 1 : 0;
        const evidenceFile = join(runRoot, "commands", `${commandId}.json`);
        vfs.mkdirSync(join(runRoot, "commands"), { recursive: true });
        const record = {
          id: commandId,
          status: isFail ? "failed" : "succeeded",
          exit_code: exitCode,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          logs: {
            stdout: { sha256: "sha-stdout", bytes: 10, path: "stdout.log" },
            stderr: { sha256: "sha-stderr", bytes: 0, path: "stderr.log" },
          },
        };
        vfs.writeFileSync(evidenceFile, JSON.stringify(record));
        return {
          markdown: isFail
            ? "### Command Executed\n- **Exit Code**: `1`\n- **Output Summary**: Command returned non-zero exit code"
            : "### Command Executed\n- **Exit Code**: `0`\n- **Output Summary**: Command completed successfully",
          evidence_path: evidenceFile,
          evidence: {},
          command: record,
          exit_code: exitCode,
        };
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
        { actor: "worker-1", role: "implementer", run: runRoot, cwd: scratch, task: "task-01" },
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
});
