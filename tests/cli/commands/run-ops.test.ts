import { describe, expect, it } from "bun:test";
import { RUN_COMMANDS } from "../../../olt/scripts/src/cli/registry/index.ts";
import {
  preflightRunExecGate,
  runExecCommand,
  tokenizeCommandArgs,
} from "../../../olt/scripts/src/cli/commands/run-ops.ts";
import type { TaskStatus } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/index.ts";
import type { GateRuntime } from "../../../olt/scripts/src/workflow/types.ts";

describe("cli/commands/run-ops & registry/run", () => {
  it("registers --command flag on run:exec", () => {
    const runExecSpec = RUN_COMMANDS.find((cmd) => cmd.name === "run:exec");
    expect(runExecSpec).toBeDefined();

    const commandFlag = runExecSpec?.flags.find((f) => f.name === "command");
    expect(commandFlag).toBeDefined();
    expect(commandFlag?.type).toBe("string");
    expect(commandFlag?.required).toBe(false);
  });

  it("tokenizes command string with quotes and spaces without eval", () => {
    const { exe, args } = tokenizeCommandArgs(
      "bun test \"tests/with spaces/test.ts\" --timeout 5000 'single quoted argument'",
    );
    expect(exe).toBe("bun");
    expect(args).toEqual([
      "test",
      "tests/with spaces/test.ts",
      "--timeout",
      "5000",
      "single quoted argument",
    ]);
  });

  it("rejects mutual exclusivity when both --command and trailing argv are provided", async () => {
    const flags = {
      run: "some-run",
      actor: "coordinator",
      command: "bun test tests/unit",
    };
    const argv = ["echo", "conflict"];

    expect(runExecCommand(flags, {}, argv)).rejects.toThrow(
      /ambiguous command execution: specify either --command or trailing argv after --, not both/,
    );
  });

  it("rejects empty --command string", async () => {
    const flags = {
      run: "some-run",
      actor: "coordinator",
      command: "   ",
    };

    expect(runExecCommand(flags, {}, [])).rejects.toThrow(
      /--command (cannot be empty|must have a non-blank value)/,
    );
  });

  it("rejects execution when neither --command nor argv are provided", async () => {
    const flags = {
      run: "some-run",
      actor: "coordinator",
    };

    expect(runExecCommand(flags, {}, [])).rejects.toThrow(/command argv cannot be empty/);
  });

  describe("preflightRunExecGate gate command execution statuses", () => {
    function createWorkflowStateWithTask(status: TaskStatus): WorkflowState {
      const gate: GateRuntime = {
        id: "gate-build",
        command: "echo build",
        mandatory: true,
        scope: "task",
        cwd: ".",
        requirement_ids: ["req-1"],
      } as GateRuntime;

      const task: TaskRecord = {
        id: "task-1",
        status,
        requirement_ids: ["req-1"],
        write_scope: [],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      };

      return {
        schema: "harness.workflow-state",
        version: 1,
        requirements: [{ id: "req-1", disposition: "actionable" }],
        gates: [gate],
        tasks: {
          "task-1": task,
        },
      } as unknown as WorkflowState;
    }

    const permittedStatuses: readonly TaskStatus[] = [
      "claimed",
      "in_progress",
      "submitted",
      "validating",
      "validated",
      "gating",
    ];

    it.each(permittedStatuses)(
      "permits gate command execution for task in status: %s",
      (status) => {
        const state = createWorkflowStateWithTask(status);
        const result = preflightRunExecGate(state, "task-1", "gate-build");
        expect(result).toEqual({ alreadyFinished: false });
      },
    );

    const unauthorizedStatuses: readonly TaskStatus[] = ["open", "failed", "blocked"];

    it.each(unauthorizedStatuses)(
      "rejects gate command execution for task in unauthorized status: %s",
      (status) => {
        const state = createWorkflowStateWithTask(status);
        expect(() => preflightRunExecGate(state, "task-1", "gate-build")).toThrow(
          /must be claimed, in_progress, submitted, validating, validated, or gating before a gate command runs/,
        );
      },
    );
  });
});
