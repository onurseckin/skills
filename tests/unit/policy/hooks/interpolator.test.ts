import { describe, expect, test } from "bun:test";
import {
  formatDuration,
  interpolateHookCommand,
  type HookInterpolationContext,
} from "../../../../olt/scripts/src/policy/hooks/interpolator.ts";

describe("formatDuration", () => {
  test("formats 0 and negative durations as 0s", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-1)).toBe("0s");
    expect(formatDuration(-5000)).toBe("0s");
    expect(formatDuration(-999999)).toBe("0s");
  });

  test("formats non-finite numbers as 0s", () => {
    expect(formatDuration(NaN)).toBe("0s");
    expect(formatDuration(Infinity)).toBe("0s");
    expect(formatDuration(-Infinity)).toBe("0s");
  });

  test("formats sub-second durations as 0s", () => {
    expect(formatDuration(500)).toBe("0s");
    expect(formatDuration(999)).toBe("0s");
  });

  test("formats seconds only when under 1 minute", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(59000)).toBe("59s");
    expect(formatDuration(59999)).toBe("59s");
  });

  test("formats minutes and seconds", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(65000)).toBe("1m 5s");
    expect(formatDuration(272000)).toBe("4m 32s");
    expect(formatDuration(599000)).toBe("9m 59s");
    expect(formatDuration(3599000)).toBe("59m 59s");
  });

  test("formats hours with minutes and seconds", () => {
    expect(formatDuration(3600000)).toBe("1h 0m 0s");
    expect(formatDuration(3665000)).toBe("1h 1m 5s");
    expect(formatDuration(7384000)).toBe("2h 3m 4s");
    expect(formatDuration(90061000)).toBe("25h 1m 1s");
  });
});

describe("interpolateHookCommand", () => {
  test("replaces all standard variables when context is fully populated", () => {
    const context: HookInterpolationContext = {
      phaseName: "phase-alpha",
      commitSha: "c0ffee1",
      durationFormatted: "2m 15s",
      durationMs: 135000,
      taskCount: 5,
      repoRoot: "/workspace/repo",
      status: "SUCCESS",
    };

    const template =
      "cmd --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --ms {duration_ms} --tasks {task_count} --root '{repo_root}' --status '{status}'";

    const result = interpolateHookCommand(template, context);

    expect(result).toBe(
      "cmd --phase 'phase-alpha' --sha 'c0ffee1' --duration '2m 15s' --ms 135000 --tasks 5 --root '/workspace/repo' --status 'SUCCESS'",
    );
  });

  test("supports camelCase placeholders and snake_case context properties seamlessly", () => {
    const context: HookInterpolationContext = {
      phase_name: "cluster-mind-preplanning",
      commit_sha: "a5264fd8",
      duration_ms: 272000,
      task_count: 12,
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
    const emptyContext: HookInterpolationContext = {};

    const template =
      "cmd --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --ms {duration_ms} --tasks {task_count} --root '{repo_root}' --status '{status}'";

    const result = interpolateHookCommand(template, emptyContext);

    expect(result).toBe(
      "cmd --phase '' --sha '' --duration '0s' --ms 0 --tasks 0 --root '' --status 'SUCCESS'",
    );
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
    const context: HookInterpolationContext = {
      phaseName: "ignored",
    };

    const template = "echo 'static command without placeholders'";
    const result = interpolateHookCommand(template, context);

    expect(result).toBe("echo 'static command without placeholders'");
  });

  test("handles status correctly when set to custom strings", () => {
    const failureContext: HookInterpolationContext = {
      status: "FAILURE",
    };
    expect(interpolateHookCommand("status={status}", failureContext)).toBe("status=FAILURE");

    const skippedContext: HookInterpolationContext = {
      status: "SKIPPED",
    };
    expect(interpolateHookCommand("status={status}", skippedContext)).toBe("status=SKIPPED");
  });
});
