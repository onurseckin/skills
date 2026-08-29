import { describe, expect, it } from "bun:test";
import {
  DEFAULT_POLICY_HOOKS,
  evaluatePolicyHooksEngine,
  executePolicyLifecycleHooks,
  formatHookDuration,
  interpolateLifecycleHookCommand,
  validatePolicyHooksConfiguration,
  type HookSpawnRunner,
  type PolicyHooksConfig,
} from "../../../olt/scripts/src/validation/fb-1788021200000-policy-event-lifecycle-hooks-engine.ts";

interface MockSpawnCall {
  readonly command: string;
  readonly options: {
    readonly shell: boolean;
    readonly detached: boolean;
    readonly stdio: string;
    readonly cwd: string;
  };
}

function createMockRunner(options?: {
  readonly shouldThrow?: boolean;
  readonly errorMessage?: string;
}): {
  readonly runner: HookSpawnRunner;
  readonly calls: MockSpawnCall[];
  readonly getUnrefCount: () => number;
} {
  let unrefs = 0;
  const calls: MockSpawnCall[] = [];
  const runner: HookSpawnRunner = (command, opts) => {
    if (options?.shouldThrow)
      throw new Error(options.errorMessage ?? "Mock process execution failed");
    calls.push({ command, options: opts });
    return {
      unref: () => {
        unrefs++;
      },
    };
  };
  return { runner, calls, getUnrefCount: () => unrefs };
}

describe("Policy Event Lifecycle Hooks Engine", () => {
  describe("Duration Formatting", () => {
    it("formats durations across millisecond ranges", () => {
      expect(formatHookDuration(0)).toBe("0s");
      expect(formatHookDuration(-500)).toBe("0s");
      expect(formatHookDuration(NaN)).toBe("0s");
      expect(formatHookDuration(1)).toBe("1ms");
      expect(formatHookDuration(500)).toBe("500ms");
      expect(formatHookDuration(999)).toBe("999ms");
    });

    it("formats durations across second ranges", () => {
      expect(formatHookDuration(1000)).toBe("1s");
      expect(formatHookDuration(5400)).toBe("5s");
      expect(formatHookDuration(45000)).toBe("45s");
      expect(formatHookDuration(59999)).toBe("59s");
    });

    it("formats durations across minute and hour ranges", () => {
      expect(formatHookDuration(60000)).toBe("1m 0s");
      expect(formatHookDuration(125000)).toBe("2m 5s");
      expect(formatHookDuration(3599000)).toBe("59m 59s");
      expect(formatHookDuration(3600000)).toBe("1h 0m 0s");
      expect(formatHookDuration(3665000)).toBe("1h 1m 5s");
    });
  });

  describe("Command Variable Interpolation", () => {
    it("interpolates snake_case and camelCase template variables", () => {
      const template =
        "notify --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --ms {duration_ms} --tasks {task_count} --dir '{repo_root}' --err '{error_message}' --task '{task_id}' --status {status}";
      const context = {
        phase_name: "validation-phase",
        commit_sha: "abc1234",
        duration_ms: 125000,
        task_count: 5,
        repo_root: "/repos/skills",
        error_message: "none",
        task_id: "task-01",
        status: "PASSED",
      };
      const result = interpolateLifecycleHookCommand(template, context);
      expect(result).toBe(
        "notify --phase 'validation-phase' --sha 'abc1234' --duration '2m 5s' --ms 125000 --tasks 5 --dir '/repos/skills' --err 'none' --task 'task-01' --status PASSED",
      );
    });

    it("interpolates camelCase placeholder variants and custom context tokens", () => {
      const template =
        "echo {phaseName} {commitSha} {durationFormatted} {durationMs} {taskCount} {repoRoot} {errorMessage} {taskId} {customVar}";
      const context = {
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
      const result = interpolateLifecycleHookCommand(template, context);
      expect(result).toBe(
        "echo phase-beta def5678 45s 45000 3 /test/path timeout task-02 custom-value",
      );
    });

    it("handles missing or defaulted context variables gracefully", () => {
      const template =
        "{phase_name}:{commit_sha}:{duration_formatted}:{duration_ms}:{task_count}:{repo_root}:{error_message}:{task_id}:{status}";
      const result = interpolateLifecycleHookCommand(template, {});
      expect(result).toBe("::0s:0:0::::SUCCESS");
    });
  });

  describe("Policy Hooks Validation", () => {
    it("validates valid policy hooks configurations", () => {
      const config: PolicyHooksConfig = {
        on_phase_completion: ["echo phase"],
        on_task_completion: ["echo task"],
        on_release_push: ["echo push"],
        on_error: ["echo error"],
      };
      const res = validatePolicyHooksConfiguration(config);
      expect(res.valid).toBe(true);
      expect(res.errors).toEqual([]);
      expect(res.configuredEvents).toEqual([
        "on_phase_completion",
        "on_task_completion",
        "on_release_push",
        "on_error",
      ]);
      expect(res.totalCommandCount).toBe(4);
    });

    it("validates empty and undefined configurations", () => {
      expect(validatePolicyHooksConfiguration(undefined).valid).toBe(true);
      expect(validatePolicyHooksConfiguration(null).valid).toBe(true);
      expect(validatePolicyHooksConfiguration({}).valid).toBe(true);
    });

    it("rejects non-object configurations", () => {
      expect(validatePolicyHooksConfiguration("invalid").valid).toBe(false);
      expect(validatePolicyHooksConfiguration(123).valid).toBe(false);
      expect(validatePolicyHooksConfiguration(["cmd"]).valid).toBe(false);
    });

    it("rejects invalid event definitions and empty commands", () => {
      const nonArray = validatePolicyHooksConfiguration({ on_phase_completion: "echo hello" });
      expect(nonArray.valid).toBe(false);
      expect(nonArray.errors[0]).toContain("must be an array");

      const nonString = validatePolicyHooksConfiguration({ on_error: [123] });
      expect(nonString.valid).toBe(false);
      expect(nonString.errors[0]).toContain("must be a string");

      const emptyCmd = validatePolicyHooksConfiguration({ on_task_completion: ["   "] });
      expect(emptyCmd.valid).toBe(false);
      expect(emptyCmd.errors[0]).toContain("cannot be empty");
    });
  });

  describe("Lifecycle Hooks Execution", () => {
    it("executes hooks across all lifecycle events", () => {
      const events: Array<
        "on_phase_completion" | "on_task_completion" | "on_release_push" | "on_error"
      > = ["on_phase_completion", "on_task_completion", "on_release_push", "on_error"];
      for (const event of events) {
        const { runner, calls } = createMockRunner();
        const hooks: PolicyHooksConfig = { [event]: [`echo test-${event} {phase_name}`] };
        const result = executePolicyLifecycleHooks({
          event,
          context: { phase_name: "test-phase" },
          hooks,
          repoRoot: "/mock/repo",
          customSpawn: runner,
        });
        expect(result.skipped).toBe(false);
        expect(result.commandCount).toBe(1);
        expect(result.success).toBe(true);
        expect(result.executedCommands[0]).toBe(`echo test-${event} test-phase`);
        expect(calls.length).toBe(1);
        expect(calls[0]?.command).toBe(`echo test-${event} test-phase`);
      }
    });

    it("skips cleanly when hooks are unconfigured or empty", () => {
      const { runner, calls } = createMockRunner();
      const result = executePolicyLifecycleHooks({
        event: "on_phase_completion",
        context: {},
        hooks: { on_phase_completion: [] },
        customSpawn: runner,
      });
      expect(result.skipped).toBe(true);
      expect(result.commandCount).toBe(0);
      expect(result.executedCommands).toEqual([]);
      expect(calls.length).toBe(0);
    });

    it("supports non-blocking execution with child unref", () => {
      const { runner, calls, getUnrefCount } = createMockRunner();
      const result = executePolicyLifecycleHooks({
        event: "on_phase_completion",
        context: {},
        hooks: { on_phase_completion: ["echo bg"] },
        customSpawn: runner,
        nonBlocking: true,
      });
      expect(result.success).toBe(true);
      expect(getUnrefCount()).toBe(1);
      expect(calls[0]?.options.detached).toBe(true);
    });

    it("supports blocking execution without detached or unref", () => {
      const { runner, calls, getUnrefCount } = createMockRunner();
      const result = executePolicyLifecycleHooks({
        event: "on_phase_completion",
        context: {},
        hooks: { on_phase_completion: ["echo sync"] },
        customSpawn: runner,
        nonBlocking: false,
      });
      expect(result.success).toBe(true);
      expect(getUnrefCount()).toBe(0);
      expect(calls[0]?.options.detached).toBe(false);
    });

    it("captures execution errors without throwing", () => {
      const { runner } = createMockRunner({
        shouldThrow: true,
        errorMessage: "Command spawn failed",
      });
      const result = executePolicyLifecycleHooks({
        event: "on_error",
        context: {},
        hooks: { on_error: ["failing-command"] },
        customSpawn: runner,
      });
      expect(result.success).toBe(false);
      expect(result.commandCount).toBe(0);
      expect(result.errors).toEqual(["Command spawn failed"]);
      expect(result.records[0]?.success).toBe(false);
      expect(result.records[0]?.error).toBe("Command spawn failed");
    });
  });

  describe("Dynamic Policy Hooks Engine Evaluation", () => {
    it("evaluates default policy hooks when policyHooks option is omitted", () => {
      const { runner, calls } = createMockRunner();
      const result = evaluatePolicyHooksEngine({
        event: "on_phase_completion",
        context: {
          phase_name: "alpha",
          commit_sha: "1122334",
          duration_formatted: "1m 10s",
          task_count: 4,
        },
        customSpawn: runner,
      });
      expect(result.success).toBe(true);
      expect(result.commandCount).toBe(1);
      expect(DEFAULT_POLICY_HOOKS.on_phase_completion?.length).toBe(1);
      expect(calls[0]?.command).toContain(
        "notify:phase --phase 'alpha' --sha '1122334' --duration '1m 10s' --tasks 4",
      );
    });

    it("dynamically respects user custom hooks override", () => {
      const { runner, calls } = createMockRunner();
      const userPolicyHooks = {
        on_phase_completion: ["custom-ci-notify --branch main --phase '{phase_name}'"],
      };
      const result = evaluatePolicyHooksEngine({
        event: "on_phase_completion",
        context: { phase_name: "release-v1" },
        policyHooks: userPolicyHooks,
        customSpawn: runner,
      });
      expect(result.success).toBe(true);
      expect(calls.length).toBe(1);
      expect(calls[0]?.command).toBe("custom-ci-notify --branch main --phase 'release-v1'");
    });

    it("dynamically respects user disabling hooks with empty array", () => {
      const { runner, calls } = createMockRunner();
      const userPolicyHooks = { on_phase_completion: [] };
      const result = evaluatePolicyHooksEngine({
        event: "on_phase_completion",
        context: { phase_name: "release-v1" },
        policyHooks: userPolicyHooks,
        customSpawn: runner,
      });
      expect(result.skipped).toBe(true);
      expect(result.commandCount).toBe(0);
      expect(calls.length).toBe(0);
    });

    it("fails cleanly when policyHooks configuration is invalid", () => {
      const { runner } = createMockRunner();
      const result = evaluatePolicyHooksEngine({
        event: "on_phase_completion",
        context: {},
        policyHooks: { on_phase_completion: 42 },
        customSpawn: runner,
      });
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.commandCount).toBe(0);
    });
  });
});
