import { describe, expect, test } from "bun:test";
import { type ChildProcess, type spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_POLICY_HOOKS,
  evaluatePolicyHooksEngine,
  executeHookCommand,
  executeLifecycleHooks,
  executePolicyLifecycleHooks,
  generateCanonicalDefaultPolicy,
  parseCommandLineArgs,
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

describe("Dynamic Policy Hooks Engine Evaluation", () => {
  test("evaluates default policy hooks when policyHooks option is omitted", () => {
    const { runner, calls } = createMockRunner();
    const result = evaluatePolicyHooksEngine({
      event: "on_phase_completion",
      context: {
        phase_name: "alpha",
        commit_sha: "1122",
        duration_formatted: "1m 10s",
        task_count: 4,
      },
      customSpawn: runner,
    });
    expect(result.success).toBe(true);
    expect(result.commandCount).toBe(1);
    expect(DEFAULT_POLICY_HOOKS.on_phase_completion?.length).toBe(1);
    expect(calls[0]?.command).toContain(
      "notify:phase --phase 'alpha' --sha '1122' --duration '1m 10s' --tasks 4",
    );
  });

  test("dynamically respects user custom hooks override and empty disabling", () => {
    const { runner: r1, calls: c1 } = createMockRunner();
    const res1 = evaluatePolicyHooksEngine({
      event: "on_phase_completion",
      context: { phase_name: "release-v1" },
      policyHooks: { on_phase_completion: ["custom-ci --phase '{phase_name}'"] },
      customSpawn: r1,
    });
    expect(res1.success).toBe(true);
    expect(c1[0]?.command).toBe("custom-ci --phase 'release-v1'");

    const { runner: r2, calls: c2 } = createMockRunner();
    const res2 = evaluatePolicyHooksEngine({
      event: "on_phase_completion",
      context: { phase_name: "release-v1" },
      policyHooks: { on_phase_completion: [] },
      customSpawn: r2,
    });
    expect(res2.skipped).toBe(true);
    expect(c2.length).toBe(0);
  });

  test("fails cleanly when policyHooks configuration is invalid", () => {
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

  test("executes all 5 canonical uppercase hook events (POST_PHASE, POST_PUSH, POST_TASK_SUBMIT, POST_TASK_VALIDATE, ON_DEFECT_RESOLVED)", () => {
    const events: PolicyLifecycleEvent[] = [
      "POST_PHASE",
      "POST_PUSH",
      "POST_TASK_SUBMIT",
      "POST_TASK_VALIDATE",
      "ON_DEFECT_RESOLVED",
    ];
    for (const event of events) {
      const { runner, calls } = createMockRunner();
      const result = executePolicyLifecycleHooks({
        event,
        context: { phase_name: "prod-deploy", task_id: "T-100", status: "RESOLVED" },
        hooks: { [event]: [`echo dispatch-${event} '{task_id}' '{status}'`] },
        customSpawn: runner,
      });
      expect(result.success).toBe(true);
      expect(result.commandCount).toBe(1);
      expect(calls[0]?.command).toBe(`echo dispatch-${event} 'T-100' 'RESOLVED'`);
    }
  });

  test("executeHookCommand parses command line args and executes cleanly without shell", () => {
    const { runner, calls } = createMockRunner();
    const record = executeHookCommand(
      "notify:cli --msg 'hello world' --count 5",
      {},
      {
        customSpawn: runner,
      },
    );
    expect(record.success).toBe(true);
    expect(record.command).toBe("notify:cli --msg 'hello world' --count 5");
    expect(calls.length).toBe(1);

    const parsed = parseCommandLineArgs("run 'foo bar' \"baz qux\" regular");
    expect(parsed).toEqual(["run", "foo bar", "baz qux", "regular"]);

    const escaped = parseCommandLineArgs('echo \\\"escaped\\\" test\\\\path');
    expect(escaped).toEqual(["echo", '"escaped"', "test\\path"]);

    const emptyRecord = executeHookCommand("", {});
    expect(emptyRecord.success).toBe(false);
    expect(emptyRecord.error).toBe("Empty command");

    // Child with on and unref
    let onCalled = false;
    let unrefCalled = false;
    const customChildRunner: HookSpawnRunner = () => ({
      on: (evt: string, cb: (err: unknown) => void) => {
        onCalled = true;
      },
      unref: () => {
        unrefCalled = true;
      },
    });
    const childRecord = executeHookCommand("test-cmd arg", {}, { customSpawn: customChildRunner });
    expect(childRecord.success).toBe(true);
    expect(onCalled).toBe(true);
    expect(unrefCalled).toBe(true);
  });
});
