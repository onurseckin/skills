import { describe, expect, test } from "bun:test";
import {
  ALLOWED_SHELL_EXECUTABLES,
  executeShellAction,
  isAllowedShellExecutable,
  type HookDefinition,
  type ProcessRunner,
  type ProcessRunResult,
} from "../../../olt/scripts/src/hooks/index.ts";

function fakeRunner(handler: (executable: string, args: readonly string[]) => ProcessRunResult): {
  runner: ProcessRunner;
  calls: Array<{
    executable: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
  }>;
} {
  const calls: Array<{
    executable: string;
    args: readonly string[];
    env?: Readonly<Record<string, string>>;
  }> = [];
  const runner: ProcessRunner = (executable, args, options) => {
    calls.push({ executable, args, env: options.env });
    return handler(executable, args);
  };
  return { runner, calls };
}

describe("Lifecycle Hooks - Executable Allowlist", () => {
  test("only a small, justified set of executables is allowlisted", () => {
    expect(ALLOWED_SHELL_EXECUTABLES).toEqual(["echo", "printf", "pwd", "date"]);
    expect(isAllowedShellExecutable("echo")).toBe(true);
    expect(isAllowedShellExecutable("printf")).toBe(true);
    expect(isAllowedShellExecutable("pwd")).toBe(true);
    expect(isAllowedShellExecutable("date")).toBe(true);
  });

  test("refuses code-execution interpreters, VCS mutators, and delete tools outright", () => {
    expect(isAllowedShellExecutable("rm")).toBe(false);
    expect(isAllowedShellExecutable("sh")).toBe(false);
    expect(isAllowedShellExecutable("bash")).toBe(false);
    expect(isAllowedShellExecutable("git")).toBe(false);
    expect(isAllowedShellExecutable("node")).toBe(false);
    expect(isAllowedShellExecutable("python3")).toBe(false);
    expect(isAllowedShellExecutable("find")).toBe(false);
    expect(isAllowedShellExecutable("xargs")).toBe(false);
    expect(isAllowedShellExecutable("eval")).toBe(false);
    expect(isAllowedShellExecutable("curl")).toBe(false);
  });

  const evasions: ReadonlyArray<{ label: string; argv: readonly string[] }> = [
    { label: "plain rm -r without -f", argv: ["rm", "-r", "x"] },
    { label: "find -delete", argv: ["find", ".", "-delete"] },
    { label: "git clean -xfd", argv: ["git", "clean", "-xfd"] },
    { label: "python3 shutil.rmtree", argv: ["python3", "-c", "import shutil;shutil.rmtree('x')"] },
    {
      label: "node fs.rmSync",
      argv: ["node", "-e", "require('fs').rmSync('x',{recursive:true,force:true})"],
    },
    { label: "command substitution disguising rm", argv: ["$(echo rm)", "-rf", "x"] },
    { label: "quote-injected rm token", argv: ['r""m', "-rf", "x"] },
    { label: "backslash-escaped rm token", argv: ["\\rm", "-rf", "x"] },
    { label: "absolute path to rm", argv: ["/bin/rm", "-rf", "x"] },
    { label: "shell nested via sh -c", argv: ["sh", "-c", "rm -rf x"] },
    { label: "eval wrapper", argv: ["eval", "rm -rf x"] },
    { label: "xargs wrapper", argv: ["xargs", "rm", "-rf"] },
  ];

  for (const { label, argv } of evasions) {
    test(`refuses at the allowlist gate: ${label}`, async () => {
      const hook: HookDefinition = {
        id: `evasion-${label}`,
        events: ["task:complete"],
        action: "shell",
        commandArgv: argv,
      };

      const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "ran", stderr: "" }));
      const result = await executeShellAction(hook, "task:complete", undefined, runner);

      expect(result.success).toBe(false);
      expect(result.error).toContain("EXECUTABLE_NOT_ALLOWLISTED");
      expect(calls.length).toBe(0);
    });
  }
});
