import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  formatHookDuration,
  interpolateHookCommand,
  interpolateLifecycleHookCommand,
  type HookInterpolationContext,
  type HookVariableContext,
} from "../../../../olt/scripts/src/policy/hooks/interpolator.ts";

describe("formatDuration and formatHookDuration", () => {
  test("formats 0 and negative durations as 0s", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(-500)).toBe("0s");
    expect(formatDuration(-999999)).toBe("0s");
    expect(formatHookDuration(0)).toBe("0s");
    expect(formatHookDuration(-500)).toBe("0s");
  });

  test("formats non-finite numbers as 0s", () => {
    expect(formatDuration(NaN)).toBe("0s");
    expect(formatDuration(Infinity)).toBe("0s");
    expect(formatDuration(-Infinity)).toBe("0s");
    expect(formatHookDuration(NaN)).toBe("0s");
  });

  test("formats sub-second millisecond durations", () => {
    expect(formatDuration(1)).toBe("1ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatHookDuration(1)).toBe("1ms");
    expect(formatHookDuration(500)).toBe("500ms");
    expect(formatHookDuration(999)).toBe("999ms");
  });

  test("formats seconds only when under 1 minute", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(5400)).toBe("5s");
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(59000)).toBe("59s");
    expect(formatDuration(59999)).toBe("59s");
    expect(formatHookDuration(1000)).toBe("1s");
    expect(formatHookDuration(5400)).toBe("5s");
    expect(formatHookDuration(45000)).toBe("45s");
    expect(formatHookDuration(59999)).toBe("59s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(125000)).toBe("2m 5s");
    expect(formatDuration(272000)).toBe("4m 32s");
    expect(formatDuration(599000)).toBe("9m 59s");
    expect(formatDuration(3599000)).toBe("59m 59s");
    expect(formatHookDuration(60000)).toBe("1m 0s");
    expect(formatHookDuration(125000)).toBe("2m 5s");
    expect(formatHookDuration(3599000)).toBe("59m 59s");
  });

  test("formats hours with minutes and seconds", () => {
    expect(formatDuration(3600000)).toBe("1h 0m 0s");
    expect(formatDuration(3665000)).toBe("1h 1m 5s");
    expect(formatDuration(7384000)).toBe("2h 3m 4s");
    expect(formatDuration(90061000)).toBe("25h 1m 1s");
    expect(formatHookDuration(3600000)).toBe("1h 0m 0s");
    expect(formatHookDuration(3665000)).toBe("1h 1m 5s");
  });
});

describe("interpolateHookCommand and interpolateLifecycleHookCommand", () => {
  test("replaces all standard variables when context is fully populated", () => {
    const context: HookVariableContext = {
      phase_name: "validation-phase",
      commit_sha: "abc1234",
      duration_ms: 125000,
      task_count: 5,
      repo_root: "/repos/skills",
      error_message: "none",
      task_id: "task-01",
      status: "PASSED",
    };

    const template =
      "notify --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --ms {duration_ms} --tasks {task_count} --dir '{repo_root}' --err '{error_message}' --task '{task_id}' --status {status}";

    const result = interpolateHookCommand(template, context);
    const aliasResult = interpolateLifecycleHookCommand(template, context);

    const expected =
      "notify --phase 'validation-phase' --sha 'abc1234' --duration '2m 5s' --ms 125000 --tasks 5 --dir '/repos/skills' --err 'none' --task 'task-01' --status PASSED";

    expect(result).toBe(expected);
    expect(aliasResult).toBe(expected);
  });

  test("supports camelCase placeholders and custom context tokens", () => {
    const context: HookInterpolationContext = {
      phaseName: "phase-beta",
      commitSha: "def5678",
      durationFormatted: "45s",
      durationMs: 45000,
      taskCount: 3,
      repoRoot: "/test/path",
      errorMessage: "timeout",
      taskId: "task-02",
      customVar: "custom-value",
    };

    const template =
      "echo {phaseName} {commitSha} {durationFormatted} {durationMs} {taskCount} {repoRoot} {errorMessage} {taskId} {customVar}";

    const result = interpolateHookCommand(template, context);
    expect(result).toBe(
      "echo phase-beta def5678 45s 45000 3 /test/path timeout task-02 custom-value",
    );
  });

  test("supports string duration_ms and task_count in context", () => {
    const context: HookVariableContext = {
      phase_name: "cluster-mind-preplanning",
      commit_sha: "a5264fd8",
      duration_ms: "272000",
      task_count: "12",
      repo_root: "/repos/skills",
    };

    const template =
      "bun harness.ts notify:phase --phase '{phaseName}' --sha '{commitSha}' --duration '{durationFormatted}' --ms {durationMs} --tasks {taskCount} --root '{repoRoot}'";

    const result = interpolateHookCommand(template, context);
    expect(result).toBe(
      "bun harness.ts notify:phase --phase 'cluster-mind-preplanning' --sha 'a5264fd8' --duration '4m 32s' --ms 272000 --tasks 12 --root '/repos/skills'",
    );
  });

  test("falls back cleanly when context variables are missing or undefined", () => {
    const template =
      "{phase_name}:{commit_sha}:{duration_formatted}:{duration_ms}:{task_count}:{repo_root}:{error_message}:{task_id}:{status}";

    const result = interpolateHookCommand(template, {});
    expect(result).toBe("::0s:0:0::::SUCCESS");
  });

  test("computes duration_formatted from durationMs when durationFormatted is omitted", () => {
    const context: HookInterpolationContext = {
      phaseName: "cluster-mind-preplanning",
      commitSha: "a5264fd8",
      durationMs: 272000,
      taskCount: 12,
    };

    const template =
      "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --tasks {task_count}";

    const result = interpolateHookCommand(template, context);
    expect(result).toBe(
      "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase 'cluster-mind-preplanning' --sha 'a5264fd8' --duration '4m 32s' --tasks 12",
    );
  });

  test("prefers explicit durationFormatted over computed durationMs", () => {
    const context: HookInterpolationContext = {
      durationFormatted: "custom-duration",
      durationMs: 272000,
    };

    const template = "time: {duration_formatted} ({duration_ms}ms)";
    const result = interpolateHookCommand(template, context);
    expect(result).toBe("time: custom-duration (272000ms)");
  });

  test("replaces multiple occurrences of the same variable in one command string", () => {
    const context: HookInterpolationContext = {
      phaseName: "wave-1",
      taskCount: 7,
      status: "FAILED",
    };

    const template =
      "echo 'Phase {phase_name} starting' && run --phase {phase_name} --count {task_count} --retry-count {task_count} --status {status} || notify {status}";

    const result = interpolateHookCommand(template, context);
    expect(result).toBe(
      "echo 'Phase wave-1 starting' && run --phase wave-1 --count 7 --retry-count 7 --status FAILED || notify FAILED",
    );
  });

  test("preserves non-placeholder template text and returns string unchanged if no variables present", () => {
    const context: HookInterpolationContext = { phaseName: "ignored" };
    const template = "echo 'static command without placeholders'";
    const result = interpolateHookCommand(template, context);
    expect(result).toBe("echo 'static command without placeholders'");
  });

  test("handles status correctly when set to custom strings", () => {
    expect(interpolateHookCommand("status={status}", { status: "FAILURE" })).toBe("status=FAILURE");
    expect(interpolateHookCommand("status={status}", { status: "SKIPPED" })).toBe("status=SKIPPED");
  });
});
