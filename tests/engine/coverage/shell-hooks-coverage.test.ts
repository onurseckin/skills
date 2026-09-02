import { describe, expect, it } from "bun:test";
import {
  ALLOWED_SHELL_EXECUTABLES,
  commandContainsRecursiveDelete,
  defaultProcessRunner,
  executeShellAction,
  findForbiddenCommandMatch,
  formatArgvLiteral,
  formatHookRefusal,
  isAllowedShellExecutable,
  resolveTrustedExecutablePath,
  stripShellEscapes,
  tokenizeLegacyCommandForDisplay,
} from "../../../olt/scripts/src/hooks/shell.ts";
import type { HookDefinition, ProcessRunner } from "../../../olt/scripts/src/hooks/types.ts";

describe("shell-hooks coverage suite", () => {
  it("formats literals, refusals, tokens, and strips escapes", () => {
    expect(formatArgvLiteral(["echo", "hi"])).toBe('["echo","hi"]');
    expect(formatHookRefusal("MISSING_COMMAND_ARGV", "bad argv")).toBe(
      "Refused hook [MISSING_COMMAND_ARGV]: bad argv",
    );

    const tokens = tokenizeLegacyCommandForDisplay("echo 'hello world' \"foo bar\" plain");
    expect(tokens).toEqual(["echo", "hello world", "foo bar", "plain"]);

    expect(stripShellEscapes('"\\foo\\"')).toBe("foo");
    expect(isAllowedShellExecutable("echo")).toBe(true);
    expect(isAllowedShellExecutable("printf")).toBe(true);
    expect(isAllowedShellExecutable("pwd")).toBe(true);
    expect(isAllowedShellExecutable("date")).toBe(true);
    expect(isAllowedShellExecutable("cat")).toBe(false);
  });

  it("detects recursive deletion variations accurately", () => {
    expect(commandContainsRecursiveDelete("rm -rf /tmp/test")).toBe(true);
    expect(commandContainsRecursiveDelete("rm --recursive folder")).toBe(true);
    expect(commandContainsRecursiveDelete("/bin/rm -r file")).toBe(true);
    expect(commandContainsRecursiveDelete("del /s something")).toBe(false);
    expect(commandContainsRecursiveDelete("rm file.txt")).toBe(false);
    expect(commandContainsRecursiveDelete("echo hello")).toBe(false);
  });

  it("matches forbidden commands from repo policy", () => {
    const forbidden = ["curl -X POST", "sudo", "shutdown"];
    expect(findForbiddenCommandMatch("sudo apt update", forbidden)).toBe("sudo");
    expect(findForbiddenCommandMatch("echo harmless", forbidden)).toBeUndefined();
    expect(findForbiddenCommandMatch("echo test", ["   "])).toBeUndefined();
  });

  it("resolves trusted executable paths and exercises defaultProcessRunner", () => {
    const echoPath = resolveTrustedExecutablePath("echo");
    expect(echoPath).toBeDefined();
    // Cache hit
    expect(resolveTrustedExecutablePath("echo")).toBe(echoPath);
    // Non-existent or unknown executable
    expect(resolveTrustedExecutablePath("unknown_exec_xyz")).toBeUndefined();

    // Default runner on hardened executable
    const runRes = defaultProcessRunner("echo", ["coverage_test_ok"], {
      timeoutMs: 5000,
      captureOutput: true,
    });
    expect(runRes.status).toBe(0);
    expect(runRes.stdout).toContain("coverage_test_ok");

    // Default runner on non-hardened executable
    const nonHardenedRes = defaultProcessRunner("non_existent_binary_123", [], {
      timeoutMs: 1000,
      captureOutput: true,
    });
    expect(nonHardenedRes.status).not.toBe(0);
  });

  it("refuses legacy string commands and missing or disallowed executables", async () => {
    const legacyHook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      command: "echo legacy",
    };
    const resLegacy = await executeShellAction(legacyHook, "task:complete");
    expect(resLegacy.success).toBe(false);
    expect(resLegacy.error).toContain("SHELL_STRING_COMMAND_REJECTED");

    const emptyArgvHook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      commandArgv: [],
    };
    const resEmpty = await executeShellAction(emptyArgvHook, "task:complete");
    expect(resEmpty.success).toBe(false);
    expect(resEmpty.error).toContain("MISSING_COMMAND_ARGV");

    const badExecHook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["curl", "https://example.com"],
    };
    const resBadExec = await executeShellAction(badExecHook, "task:complete");
    expect(resBadExec.success).toBe(false);
    expect(resBadExec.error).toContain("EXECUTABLE_NOT_ALLOWLISTED");
  });

  it("refuses recursive delete and cwd outside repo", async () => {
    const rmHook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["echo", "rm", "-rf", "/tmp"],
    };
    const resRm = await executeShellAction(rmHook, "task:complete");
    expect(resRm.success).toBe(false);
    expect(resRm.error).toContain("RECURSIVE_DELETE_DETECTED");

    const cwdHook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["echo", "test"],
      cwd: "../../../outside-repo-xyz",
    };
    const resCwd = await executeShellAction(cwdHook, "task:complete");
    expect(resCwd.success).toBe(false);
    expect(resCwd.error).toContain("CWD_OUTSIDE_REPOSITORY");
  });

  it("executes shell action with mock runner covering success, failures, and throws", async () => {
    const hook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["echo", "hello"],
    };

    const mockSuccess: ProcessRunner = () => ({
      status: 0,
      stdout: "hello world\n",
      stderr: "",
    });
    const resOk = await executeShellAction(hook, "task:complete", { id: "p1" }, mockSuccess);
    expect(resOk.success).toBe(true);
    expect(resOk.output).toBe("hello world");

    const mockStderrFail: ProcessRunner = () => ({
      status: 1,
      stdout: "",
      stderr: "command failed",
    });
    const resStderr = await executeShellAction(hook, "task:complete", {}, mockStderrFail);
    expect(resStderr.success).toBe(false);
    expect(resStderr.error).toBe("command failed");

    const mockStatusFail: ProcessRunner = () => ({
      status: 127,
      stdout: "output on fail",
      stderr: "",
    });
    const resStatus = await executeShellAction(hook, "task:complete", {}, mockStatusFail);
    expect(resStatus.success).toBe(false);
    expect(resStatus.output).toBe("output on fail");
    expect(resStatus.error).toBe("Process exited with status 127");

    const mockThrow: ProcessRunner = () => {
      throw new Error("spawn failed catastrophically");
    };
    const resThrow = await executeShellAction(hook, "task:complete", {}, mockThrow);
    expect(resThrow.success).toBe(false);
    expect(resThrow.error).toBe("spawn failed catastrophically");
  });
});
