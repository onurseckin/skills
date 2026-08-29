import { describe, expect, test } from "bun:test";
import { type ChildProcess, type spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  executeLifecycleHooks,
  generateCanonicalDefaultPolicy,
  type RepoPolicy,
} from "../../../../olt/scripts/src/policy/index.ts";

function createMockSpawn(options?: {
  readonly shouldThrow?: boolean;
  readonly throwMessage?: string;
}): {
  readonly mockSpawn: typeof spawn;
  readonly calls: Array<{
    readonly command: string;
    readonly options: unknown;
  }>;
  readonly unrefCallCount: () => number;
} {
  let unrefs = 0;
  const calls: Array<{ readonly command: string; readonly options: unknown }> = [];

  const mockSpawn = ((command: string, spawnOpts: unknown) => {
    if (options?.shouldThrow) {
      throw new Error(options.throwMessage ?? "Simulated spawn failure");
    }
    calls.push({ command, options: spawnOpts });
    return {
      unref: () => {
        unrefs++;
      },
    } as unknown as ChildProcess;
  }) as typeof spawn;

  return {
    mockSpawn,
    calls,
    unrefCallCount: () => unrefs,
  };
}

describe("Lifecycle Hooks Engine - Execution Dispatcher", () => {
  const scratchDir = join(process.cwd(), "coverage", "scratch", "lifecycle-hooks-engine-test");

  test("dispatches configured hooks using mock spawn with enriched context", () => {
    const { mockSpawn, calls, unrefCallCount } = createMockSpawn();
    const policy: RepoPolicy = {
      ...generateCanonicalDefaultPolicy("/mock/repo"),
      hooks: {
        on_phase_completion: [
          "notify --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}'",
        ],
      },
    };

    const result = executeLifecycleHooks({
      event: "on_phase_completion",
      context: {
        phase_name: "phase-alpha",
        commit_sha: "71c08d1",
        duration_ms: 125000,
      },
      repoRoot: "/mock/repo",
      policy,
      customSpawn: mockSpawn,
    });

    expect(result.skipped).toBe(false);
    expect(result.commandCount).toBe(1);
    expect(result.errors.length).toBe(0);
    expect(result.executedCommands).toEqual([
      "notify --phase 'phase-alpha' --sha '71c08d1' --duration '2m 5s'",
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0]?.command).toBe(
      "notify --phase 'phase-alpha' --sha '71c08d1' --duration '2m 5s'",
    );
    expect(calls[0]?.options).toEqual({
      shell: true,
      detached: true,
      stdio: "ignore",
      cwd: "/mock/repo",
    });
    expect(unrefCallCount()).toBe(1);
  });

  test("calls unref on spawned child when nonBlocking is true or defaulted", () => {
    const { mockSpawn, unrefCallCount } = createMockSpawn();
    const policy: RepoPolicy = {
      ...generateCanonicalDefaultPolicy("/mock/repo"),
      hooks: {
        on_task_completion: ["echo done"],
      },
    };

    executeLifecycleHooks({
      event: "on_task_completion",
      context: {},
      repoRoot: "/mock/repo",
      policy,
      customSpawn: mockSpawn,
    });

    expect(unrefCallCount()).toBe(1);
  });

  test("does not unref child and passes detached false when nonBlocking is false", () => {
    const { mockSpawn, calls, unrefCallCount } = createMockSpawn();
    const policy: RepoPolicy = {
      ...generateCanonicalDefaultPolicy("/mock/repo"),
      hooks: {
        on_task_completion: ["echo blocking"],
      },
    };

    const result = executeLifecycleHooks({
      event: "on_task_completion",
      context: {},
      repoRoot: "/mock/repo",
      policy,
      customSpawn: mockSpawn,
      nonBlocking: false,
    });

    expect(result.skipped).toBe(false);
    expect(unrefCallCount()).toBe(0);
    expect(calls[0]?.options).toEqual({
      shell: true,
      detached: false,
      stdio: "ignore",
      cwd: "/mock/repo",
    });
  });

  test("skips cleanly when hooks configuration is missing or empty", () => {
    const { mockSpawn, calls } = createMockSpawn();
    const policyWithoutHooks: RepoPolicy = {
      ...generateCanonicalDefaultPolicy("/mock/repo"),
      hooks: undefined,
    };

    const result1 = executeLifecycleHooks({
      event: "on_phase_completion",
      context: {},
      policy: policyWithoutHooks,
      customSpawn: mockSpawn,
    });

    expect(result1.skipped).toBe(true);
    expect(result1.commandCount).toBe(0);
    expect(result1.executedCommands).toEqual([]);
    expect(result1.errors).toEqual([]);
    expect(calls.length).toBe(0);

    const policyWithEmptyCommands: RepoPolicy = {
      ...generateCanonicalDefaultPolicy("/mock/repo"),
      hooks: {
        on_phase_completion: [],
      },
    };

    const result2 = executeLifecycleHooks({
      event: "on_phase_completion",
      context: {},
      policy: policyWithEmptyCommands,
      customSpawn: mockSpawn,
    });

    expect(result2.skipped).toBe(true);
    expect(result2.commandCount).toBe(0);
    expect(calls.length).toBe(0);
  });

  test("captures spawn failures into errors array without throwing", () => {
    const { mockSpawn } = createMockSpawn({
      shouldThrow: true,
      throwMessage: "spawn ENOENT in mock runner",
    });

    const policy: RepoPolicy = {
      ...generateCanonicalDefaultPolicy("/mock/repo"),
      hooks: {
        on_error: ["notify:error --status {status}"],
      },
    };

    const result = executeLifecycleHooks({
      event: "on_error",
      context: { status: "FAILED" },
      repoRoot: "/mock/repo",
      policy,
      customSpawn: mockSpawn,
    });

    expect(result.skipped).toBe(false);
    expect(result.commandCount).toBe(0);
    expect(result.executedCommands).toEqual([]);
    expect(result.errors).toEqual(["spawn ENOENT in mock runner"]);
  });

  test("executes multiple commands in sequence and isolates errors", () => {
    let callIndex = 0;
    const executed: string[] = [];
    const mockSpawn = ((command: string) => {
      callIndex++;
      if (callIndex === 1) {
        throw new Error("First command exploded");
      }
      executed.push(command);
      return { unref: () => {} } as unknown as ChildProcess;
    }) as typeof spawn;

    const policy: RepoPolicy = {
      ...generateCanonicalDefaultPolicy("/mock/repo"),
      hooks: {
        on_wave_completion: ["failing-command", "echo success-second"],
      },
    };

    const result = executeLifecycleHooks({
      event: "on_wave_completion",
      context: {},
      repoRoot: "/mock/repo",
      policy,
      customSpawn: mockSpawn,
    });

    expect(result.skipped).toBe(false);
    expect(result.commandCount).toBe(1);
    expect(result.executedCommands).toEqual(["echo success-second"]);
    expect(result.errors).toEqual(["First command exploded"]);
  });

  test("falls back to inspectRepoPolicy when policy option is omitted", () => {
    mkdirSync(join(scratchDir, ".olt"), { recursive: true });
    const customPolicy: RepoPolicy = {
      ...generateCanonicalDefaultPolicy(scratchDir),
      hooks: {
        on_release_push: ["echo release-dispatched"],
      },
    };
    writeFileSync(join(scratchDir, ".olt", "policy.json"), JSON.stringify(customPolicy));

    const { mockSpawn, calls } = createMockSpawn();

    try {
      const result = executeLifecycleHooks({
        event: "on_release_push",
        context: {},
        repoRoot: scratchDir,
        customSpawn: mockSpawn,
      });

      expect(result.skipped).toBe(false);
      expect(result.commandCount).toBe(1);
      expect(calls[0]?.command).toBe("echo release-dispatched");
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
