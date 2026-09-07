import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../olt/scripts/src/core/errors/index.ts";
import {
  buildSubmissionReport,
  resolveChecks,
  type SubmissionReportInputs,
} from "../olt/scripts/src/workflow/submission/build-report.ts";
import type { TaskRecord } from "../olt/scripts/src/workflow/types.ts";

function createTask(id = "task-3", overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    status: "ready",
    requirement_ids: ["req-3"],
    write_scope: ["olt/scripts/src/workflow/submission/build-report.ts"],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...overrides,
  };
}

function createCommand(id: string, overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id,
    argv: ["bun", "test", "tests/submission-checks.test.ts"],
    cwd: ".",
    cwd_relative: ".",
    repository_root: "/repo",
    status: "succeeded",
    task_id: "task-3",
    gate_id: "gate-3",
    started_at: "2026-09-06T00:00:00.000Z",
    finished_at: "2026-09-06T00:00:01.000Z",
    exit_code: 0,
    signal: null,
    fingerprint: `fp-${id}`,
    attempt_signing_public_key: "MCowBQYDK2VwAyEA...",
    record_path: `commands/${id}/record.json`,
    actor: "implementer_task3",
    ...overrides,
  };
}

function defaultInputs(overrides: Partial<SubmissionReportInputs> = {}): SubmissionReportInputs {
  return {
    task: createTask(),
    agentId: "implementer_task3",
    summary: "implemented submission checks",
    observedFiles: ["olt/scripts/src/workflow/submission/build-report.ts"],
    commands: {},
    ...overrides,
  };
}

describe("resolveChecks: actor matching and variance", () => {
  test("prefers commands where task_id and actor match the agent", () => {
    const cmd1 = createCommand("C-1", { actor: "implementer_task3" });
    const cmd2 = createCommand("C-2", { actor: "other_agent" });
    const result = resolveChecks(
      defaultInputs({
        commands: { "C-1": cmd1, "C-2": cmd2 },
      }),
    );
    expect(result.evidenceClass).toBe("harness_observed");
    expect(result.commands).toEqual([cmd1]);
  });

  test("falls back to any command with matching task_id and exit_code 0 on actor variance", () => {
    const foreignCmd = createCommand("C-HOST", {
      actor: "native_tool_runner",
      exit_code: 0,
    });
    const result = resolveChecks(
      defaultInputs({
        agentId: "implementer_task3",
        commands: { "C-HOST": foreignCmd },
      }),
    );
    expect(result.evidenceClass).toBe("harness_observed");
    expect(result.commands).toEqual([foreignCmd]);
  });

  test("sorts fallback commands by id", () => {
    const cmdB = createCommand("C-B", { actor: "runner_b", exit_code: 0 });
    const cmdA = createCommand("C-A", { actor: "runner_a", exit_code: 0 });
    const result = resolveChecks(
      defaultInputs({
        agentId: "implementer_task3",
        commands: { "C-B": cmdB, "C-A": cmdA },
      }),
    );
    expect(result.evidenceClass).toBe("harness_observed");
    expect(result.commands.map((c) => c.id)).toEqual(["C-A", "C-B"]);
  });

  test("ignores commands with non-zero exit_code during fallback", () => {
    const failedCmd = createCommand("C-FAIL", {
      actor: "native_tool_runner",
      exit_code: 1,
    });
    expect(() =>
      resolveChecks(
        defaultInputs({
          task: createTask("task-3", { gate: "bun test tests/submission-checks.test.ts" }),
          commands: { "C-FAIL": failedCmd },
        }),
      ),
    ).toThrow(HarnessError);
  });

  test("ignores commands belonging to a different task during fallback", () => {
    const otherTaskCmd = createCommand("C-OTHER", {
      task_id: "task-99",
      actor: "native_tool_runner",
      exit_code: 0,
    });
    expect(() =>
      resolveChecks(
        defaultInputs({
          task: createTask("task-3", { gate: "bun test tests/submission-checks.test.ts" }),
          commands: { "C-OTHER": otherTaskCmd },
        }),
      ),
    ).toThrow(HarnessError);
  });
});

describe("resolveChecks: empty gates and check skipping", () => {
  test("returns empty commands and agent_reported when gate is null", () => {
    const result = resolveChecks(
      defaultInputs({
        task: createTask("task-3", { gate: null }),
        commands: {},
      }),
    );
    expect(result).toEqual({ commands: [], evidenceClass: "agent_reported" });
  });

  test("returns empty commands and agent_reported when gate is undefined", () => {
    const result = resolveChecks(
      defaultInputs({
        task: createTask("task-3", { gate: undefined }),
        commands: {},
      }),
    );
    expect(result).toEqual({ commands: [], evidenceClass: "agent_reported" });
  });

  test("returns empty commands and agent_reported when gate is empty string or whitespace", () => {
    for (const emptyGate of ["", "   ", "\t\n"]) {
      const result = resolveChecks(
        defaultInputs({
          task: createTask("task-3", { gate: emptyGate }),
          commands: {},
        }),
      );
      expect(result).toEqual({ commands: [], evidenceClass: "agent_reported" });
    }
  });

  test("returns empty commands and agent_reported when gate is empty array or object", () => {
    const arrayResult = resolveChecks(
      defaultInputs({
        task: createTask("task-3", { gate: [] }),
        commands: {},
      }),
    );
    expect(arrayResult).toEqual({ commands: [], evidenceClass: "agent_reported" });

    const objResult = resolveChecks(
      defaultInputs({
        task: createTask("task-3", { gate: {} }),
        commands: {},
      }),
    );
    expect(objResult).toEqual({ commands: [], evidenceClass: "agent_reported" });
  });

  test("throws INVALID_STATE when gate is defined and non-empty and no commands exist", () => {
    expect(() =>
      resolveChecks(
        defaultInputs({
          task: createTask("task-3", { gate: "bun test tests/submission-checks.test.ts" }),
          commands: {},
        }),
      ),
    ).toThrow(/cannot determine checks for task-3/);
  });

  test("strictly throws INVALID_STATE when gate is defined and non-empty and no commands exist without allowEmptyFiles", () => {
    let capturedError: unknown;
    try {
      buildSubmissionReport(
        defaultInputs({
          task: createTask("task-3", { gate: "bun test tests/submission-checks.test.ts" }),
          commands: {},
        }),
      );
    } catch (err) {
      capturedError = err;
    }
    expect(capturedError).toBeInstanceOf(HarnessError);
    expect((capturedError as HarnessError).code).toBe("INVALID_STATE");
    expect((capturedError as HarnessError).message).toContain("cannot determine checks for task-3");
  });

  test("does not throw when allowEmptyFiles is true even with non-empty gate", () => {
    const result = resolveChecks(
      defaultInputs({
        task: createTask("task-3", { gate: "bun test tests/submission-checks.test.ts" }),
        commands: {},
        allowEmptyFiles: true,
      }),
    );
    expect(result).toEqual({ commands: [], evidenceClass: "agent_reported" });
  });
});

describe("resolveChecks: declared command IDs", () => {
  test("resolves declared command ids with agent_reported", () => {
    const cmd = createCommand("C-DECL");
    const result = resolveChecks(
      defaultInputs({
        declaredCommandIds: ["C-DECL"],
        commands: { "C-DECL": cmd },
      }),
    );
    expect(result).toEqual({ commands: [cmd], evidenceClass: "agent_reported" });
  });

  test("throws when declared command id does not exist", () => {
    expect(() =>
      resolveChecks(
        defaultInputs({
          declaredCommandIds: ["NON_EXISTENT"],
          commands: {},
        }),
      ),
    ).toThrow(/submission evidence names no recorded command/);
  });

  test("throws when declared command belongs to a different task", () => {
    const otherCmd = createCommand("C-OTHER", { task_id: "task-99" });
    expect(() =>
      resolveChecks(
        defaultInputs({
          declaredCommandIds: ["C-OTHER"],
          commands: { "C-OTHER": otherCmd },
        }),
      ),
    ).toThrow(/belongs to task task-99/);
  });
});

describe("buildSubmissionReport end-to-end", () => {
  test("builds report with actor variance fallback", () => {
    const cmd = createCommand("C-VAR", { actor: "detached_runner", exit_code: 0 });
    const report = buildSubmissionReport(
      defaultInputs({
        agentId: "implementer_task3",
        commands: { "C-VAR": cmd },
      }),
    );
    expect(report.summary).toBe("implemented submission checks");
    expect(report.checks).toEqual([{ command_id: "C-VAR" }]);
    expect(report.checks_evidence_class).toBe("harness_observed");
  });

  test("builds report with empty gate", () => {
    const report = buildSubmissionReport(
      defaultInputs({
        task: createTask("task-3", { gate: null }),
        commands: {},
      }),
    );
    expect(report.summary).toBe("implemented submission checks");
    expect(report.checks).toEqual([]);
    expect(report.checks_evidence_class).toBe("agent_reported");
    expect(report.evidence).toEqual([]);
  });
});
