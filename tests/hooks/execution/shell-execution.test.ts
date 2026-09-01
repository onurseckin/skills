import { describe, expect, test } from "bun:test";
import {
  executeShellAction,
  type HookDefinition,
  type ProcessRunner,
  type ProcessRunResult,
} from "../../../olt/scripts/src/hooks/index.ts";

export const shellExecutionSuiteName = "Lifecycle Hooks - Shell Action Execution (argv-only)";

function fakeRunner(
  handler: (
    executable: string,
    args: readonly string[],
    options?: { cwd?: string; env?: Readonly<Record<string, string>> },
  ) => ProcessRunResult,
): {
  runner: ProcessRunner;
  calls: Array<{
    executable: string;
    args: readonly string[];
    cwd?: string;
    env?: Readonly<Record<string, string>>;
  }>;
} {
  const calls: Array<{
    executable: string;
    args: readonly string[];
    cwd?: string;
    env?: Readonly<Record<string, string>>;
  }> = [];
  const runner: ProcessRunner = (executable, args, options) => {
    calls.push({ executable, args, cwd: options?.cwd, env: options?.env });
    return handler(executable, args, options);
  };
  return { runner, calls };
}

describe(shellExecutionSuiteName, () => {
  test("executes an allowlisted argv command capturing stdout and passing environment through", async () => {
    const hook: HookDefinition = {
      id: "shell-test-1",
      events: ["gate:pass"],
      action: "shell",
      commandArgv: ["echo", "hello"],
      env: { CUSTOM_VAR: "custom_value_123" },
    };

    const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "hello\n", stderr: "" }));
    const result = await executeShellAction(hook, "gate:pass", { sample: "data" }, runner);

    expect(result.success).toBe(true);
    expect(result.output).toBe("hello");
    expect(calls.length).toBe(1);
    expect(calls[0]?.executable).toBe("echo");
    expect(calls[0]?.args).toEqual(["hello"]);
    expect(calls[0]?.env?.CUSTOM_VAR).toBe("custom_value_123");
    expect(calls[0]?.env?.LIFECYCLE_EVENT).toBe("gate:pass");
    expect(calls[0]?.env?.LIFECYCLE_PAYLOAD).toBe(JSON.stringify({ sample: "data" }));
  });

  test("executes a real allowlisted binary end to end with no shell involved", async () => {
    const dir = process.cwd();
    const hook: HookDefinition = {
      id: "shell-cwd-test",
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["pwd"],
      cwd: dir,
    };

    const { runner, calls } = fakeRunner((_exe, _args, opts) => ({
      status: 0,
      stdout: `${opts?.cwd ?? dir}\n`,
      stderr: "",
    }));

    const result = await executeShellAction(hook, "task:complete", undefined, runner);
    expect(result.success).toBe(true);
    expect(result.output).toContain(dir);
    expect(calls.length).toBe(1);
    expect(calls[0]?.executable).toBe("pwd");
  });

  test("captures nonzero exit status and stderr without throwing", async () => {
    const hook: HookDefinition = {
      id: "shell-fail-test",
      events: ["task:fail"],
      action: "shell",
      commandArgv: ["date", "--bogus-flag-xyz"],
    };

    const { runner } = fakeRunner(() => ({ status: 42, stdout: "", stderr: "failure-detail" }));
    const result = await executeShellAction(hook, "task:fail", undefined, runner);

    expect(result.success).toBe(false);
    expect(result.error).toContain("failure-detail");
  });

  test("returns failure for a missing commandArgv", async () => {
    const hook: HookDefinition = {
      id: "shell-empty",
      events: ["run:start"],
      action: "shell",
    };

    const result = await executeShellAction(hook, "run:start");
    expect(result.success).toBe(false);
    expect(result.error).toContain("MISSING_COMMAND_ARGV");
  });

  test("rejects an empty commandArgv array", async () => {
    const hook: HookDefinition = {
      id: "shell-empty-argv",
      events: ["run:start"],
      action: "shell",
      commandArgv: [],
    };

    const result = await executeShellAction(hook, "run:start");
    expect(result.success).toBe(false);
    expect(result.error).toContain("MISSING_COMMAND_ARGV");
  });

  test("rejects a legacy shell string outright and shows the correct argv form", async () => {
    const hook: HookDefinition = {
      id: "shell-legacy-string",
      events: ["task:complete"],
      action: "shell",
      command: "echo hello",
    };

    const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "hello\n", stderr: "" }));
    const result = await executeShellAction(hook, "task:complete", undefined, runner);

    expect(result.success).toBe(false);
    expect(result.error).toContain("SHELL_STRING_COMMAND_REJECTED");
    expect(result.error).toContain('["echo","hello"]');
    expect(calls.length).toBe(0);
  });
});
