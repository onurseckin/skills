import { describe, expect, test } from "bun:test";
import { type ChildProcess, type spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  executeLifecycleHooks,
  executePolicyLifecycleHooks,
  generateCanonicalDefaultPolicy,
  validatePolicyHooksConfiguration,
  type HookSpawnRunner,
  type PolicyHooksConfig,
  type PolicyLifecycleEvent,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

interface MockSpawnCall {
  readonly command: string;
  readonly options: {
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
    if (options?.shouldThrow) {
      throw new Error(options.errorMessage ?? "Mock process execution failed");
    }
    calls.push({ command, options: opts });
    return {
      unref: () => {
        unrefs++;
      },
    };
  };
  return { runner, calls, getUnrefCount: () => unrefs };
}

describe("Policy Hooks Validation", () => {
  test("validates valid policy hooks configurations across all 5 events", () => {
    const config: PolicyHooksConfig = {
      on_phase_completion: ["echo phase"],
      on_task_completion: ["echo task"],
      on_release_push: ["echo push"],
      on_wave_completion: ["echo wave"],
      on_error: ["echo error"],
    };
    const res = validatePolicyHooksConfiguration(config);
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.configuredEvents).toEqual([
      "on_phase_completion",
      "on_task_completion",
      "on_release_push",
      "on_wave_completion",
      "on_error",
    ]);
    expect(res.totalCommandCount).toBe(5);
  });

  test("validates empty and undefined configurations", () => {
    expect(validatePolicyHooksConfiguration(undefined).valid).toBe(true);
    expect(validatePolicyHooksConfiguration(null).valid).toBe(true);
    expect(validatePolicyHooksConfiguration({}).valid).toBe(true);
  });

  test("rejects non-object configurations", () => {
    expect(validatePolicyHooksConfiguration("invalid").valid).toBe(false);
    expect(validatePolicyHooksConfiguration(123).valid).toBe(false);
    expect(validatePolicyHooksConfiguration(["cmd"]).valid).toBe(false);
  });

  test("rejects invalid event definitions and empty commands", () => {
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

describe("Lifecycle Hooks Engine Execution", () => {
  const scratchDir = join(process.cwd(), "coverage", "scratch", "lifecycle-hooks-engine-test");

  test("executes hooks across all 5 lifecycle events", () => {
    const events: PolicyLifecycleEvent[] = [
      "on_phase_completion",
      "on_task_completion",
      "on_release_push",
      "on_wave_completion",
      "on_error",
    ];
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

  test("supports non-blocking and blocking execution", () => {
    const { runner: r1, calls: c1, getUnrefCount: u1 } = createMockRunner();
    const res1 = executePolicyLifecycleHooks({
      event: "on_phase_completion",
      context: {},
      hooks: { on_phase_completion: ["echo bg"] },
      customSpawn: r1,
      nonBlocking: true,
    });
    expect(res1.success).toBe(true);
    expect(u1()).toBe(1);
    expect(c1[0]?.options.detached).toBe(true);

    const { runner: r2, calls: c2, getUnrefCount: u2 } = createMockRunner();
    const res2 = executePolicyLifecycleHooks({
      event: "on_phase_completion",
      context: {},
      hooks: { on_phase_completion: ["echo sync"] },
      customSpawn: r2,
      nonBlocking: false,
    });
    expect(res2.success).toBe(true);
    expect(u2()).toBe(0);
    expect(c2[0]?.options.detached).toBe(false);
  });

  test("skips cleanly when hooks are unconfigured or empty", () => {
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

  test("captures execution errors without throwing", () => {
    const { runner } = createMockRunner({ shouldThrow: true, errorMessage: "Spawn error" });
    const result = executePolicyLifecycleHooks({
      event: "on_error",
      context: {},
      hooks: { on_error: ["failing-command"] },
      customSpawn: runner,
    });
    expect(result.success).toBe(false);
    expect(result.commandCount).toBe(0);
    expect(result.errors).toEqual(["Spawn error"]);
    expect(result.records[0]?.success).toBe(false);
    expect(result.records[0]?.error).toBe("Spawn error");
  });

  test("executes multiple commands in sequence and isolates errors", () => {
    let callIndex = 0;
    const executed: string[] = [];
    const mockSpawn = ((command: string) => {
      callIndex++;
      if (callIndex === 1) throw new Error("First command exploded");
      executed.push(command);
      return { unref: () => {} } as unknown as ChildProcess;
    }) as typeof spawn;

    const result = executeLifecycleHooks({
      event: "on_wave_completion",
      context: {},
      repoRoot: "/mock/repo",
      hooks: { on_wave_completion: ["failing-command", "echo success-second"] },
      customSpawn: mockSpawn,
    });
    expect(result.skipped).toBe(false);
    expect(result.commandCount).toBe(1);
    expect(result.executedCommands).toEqual(["echo success-second"]);
    expect(result.errors).toEqual(["First command exploded"]);
  });

  test("falls back to inspectRepoPolicy when policy and hooks are omitted", () => {
    mkdirSync(join(scratchDir, ".olt"), { recursive: true });
    const customPolicy: RepoPolicy = {
      ...generateCanonicalDefaultPolicy(scratchDir),
      hooks: { on_release_push: ["echo release-dispatched"] },
    };
    writeFileSync(join(scratchDir, ".olt", "policy.json"), JSON.stringify(customPolicy));
    const { runner, calls } = createMockRunner();
    try {
      const result = executeLifecycleHooks({
        event: "on_release_push",
        context: {},
        repoRoot: scratchDir,
        customSpawn: runner,
      });
      expect(result.skipped).toBe(false);
      expect(result.commandCount).toBe(1);
      expect(calls[0]?.command).toBe("echo release-dispatched");
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
