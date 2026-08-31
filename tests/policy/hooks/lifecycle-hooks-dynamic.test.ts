import { describe, expect, test } from "bun:test";
import {
  DEFAULT_POLICY_HOOKS,
  evaluatePolicyHooksEngine,
  executeHookCommand,
  executePolicyLifecycleHooks,
  parseCommandLineArgs,
  type HookSpawnRunner,
  type PolicyLifecycleEvent,
} from "../../../olt/scripts/src/policy/index.ts";

interface MockSpawnCall {
  readonly command: string;
  readonly options: {
    readonly detached: boolean;
    readonly stdio: string;
    readonly cwd: string;
  };
}

function createMockRunner(): {
  readonly runner: HookSpawnRunner;
  readonly calls: MockSpawnCall[];
} {
  const calls: MockSpawnCall[] = [];
  const runner: HookSpawnRunner = (command, opts) => {
    calls.push({ command, options: opts });
    return {
      unref: () => {},
    };
  };
  return { runner, calls };
}

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
      on: (_evt: string, _cb: (err: unknown) => void) => {
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
