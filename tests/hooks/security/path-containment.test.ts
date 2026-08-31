import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildHookChildEnvironment,
  commandContainsRecursiveDelete,
  executeShellAction,
  findForbiddenCommandMatch,
  resolvePinnedHookCwd,
  type HookDefinition,
  type ProcessRunner,
  type ProcessRunResult,
} from "../../../olt/scripts/src/hooks/index.ts";
import { findRepoRoot } from "../../../olt/scripts/src/core/shared/paths.ts";

const scratchBase = join(process.cwd(), "coverage", "scratch", "path-containment");

function getScratch(label: string): string {
  const dir = join(scratchBase, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

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

describe("Lifecycle Hooks - PATH Poisoning Hardening", () => {
  afterEach(() => {
    try {
      rmSync(scratchBase, { recursive: true, force: true });
    } catch {}
  });

  test("hook.env cannot redirect an allowlisted executable to an attacker binary via PATH poisoning", async () => {
    const dir = getScratch("path-poison");
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    const markerPath = join(dir, "PWNED_PATH_POISON");
    const maliciousEcho = join(binDir, "echo");
    writeFileSync(
      maliciousEcho,
      ["#!/bin/bash", `: > "${markerPath}"`, "printf 'MALICIOUS ECHO RAN: %s\\n' \"$*\"", ""].join(
        "\n",
      ),
    );
    chmodSync(maliciousEcho, 0o755);

    const hook: HookDefinition = {
      id: "attacker-path-poison",
      events: ["orchestrator:complete"],
      action: "shell",
      commandArgv: ["echo", "hi"],
      env: { PATH: binDir },
    };

    const result = await executeShellAction(hook, "orchestrator:complete");

    expect(existsSync(markerPath)).toBe(false);
    expect(result.output).not.toContain("MALICIOUS ECHO RAN");
    expect(result.success).toBe(true);
    expect(result.output).toBe("hi");
  });

  test("hook.env's PATH key is stripped from the child environment even when a custom runner is supplied", async () => {
    const hook: HookDefinition = {
      id: "path-env-stripped",
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["echo", "hi"],
      env: { PATH: "/attacker/controlled/bin", SAFE_VAR: "kept" },
    };

    const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "hi\n", stderr: "" }));
    const result = await executeShellAction(hook, "task:complete", undefined, runner);

    expect(result.success).toBe(true);
    expect(calls[0]?.env?.PATH).not.toBe("/attacker/controlled/bin");
    expect(calls[0]?.env?.SAFE_VAR).toBe("kept");
  });

  test("admits only approved ambient values, safe hook configuration, and protected lifecycle metadata", () => {
    const hook: HookDefinition = {
      events: ["task:complete"],
      action: "shell",
      env: {
        CUSTOM_VAR: "configured",
        PATH: "/hook/bin",
        Path: "/hook/windows-bin",
        pAtH: "/hook/mixed-case-bin",
        LIFECYCLE_EVENT: "overridden-event",
        LIFECYCLE_PAYLOAD: "overridden-payload",
      },
    };
    const parentEnv = {
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      TZ: "UTC",
      TMPDIR: "/tmp/approved",
      TMP: "/tmp/tmp",
      TEMP: "/tmp/temp",
      SYSTEMROOT: "C:\\Windows",
      WINDIR: "C:\\Windows",
      CUSTOM_VAR: "ambient",
      PATH: "/parent/bin",
      AWS_SECRET_ACCESS_KEY: "synthetic-aws-secret",
      API_TOKEN: "synthetic-api-token",
      NODE_OPTIONS: "--require synthetic-hook",
      DYLD_INSERT_LIBRARIES: "/tmp/injected.dylib",
      HOME: "/synthetic/home",
    };

    const environment = buildHookChildEnvironment(
      hook,
      "task:complete",
      { taskId: "t-1" },
      parentEnv,
    );

    expect(environment).toEqual({
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "UTF-8",
      TZ: "UTC",
      TMPDIR: "/tmp/approved",
      TMP: "/tmp/tmp",
      TEMP: "/tmp/temp",
      SYSTEMROOT: "C:\\Windows",
      WINDIR: "C:\\Windows",
      CUSTOM_VAR: "configured",
      LIFECYCLE_EVENT: "task:complete",
      LIFECYCLE_PAYLOAD: JSON.stringify({ taskId: "t-1" }),
    });
    expect(environment).not.toHaveProperty("PATH");
    expect(environment).not.toHaveProperty("Path");
    expect(environment).not.toHaveProperty("pAtH");
    expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(environment).not.toHaveProperty("API_TOKEN");
    expect(environment).not.toHaveProperty("NODE_OPTIONS");
    expect(environment).not.toHaveProperty("DYLD_INSERT_LIBRARIES");
    expect(environment).not.toHaveProperty("HOME");
  });
});

describe("Lifecycle Hooks - Working Directory Containment", () => {
  test("resolvePinnedHookCwd pins to the repo root when hook.cwd is not set", () => {
    const resolution = resolvePinnedHookCwd({ events: ["*"], action: "shell" }, "/pinned/root");
    expect(resolution).toEqual({ ok: true, cwd: "/pinned/root" });
  });

  test("resolvePinnedHookCwd accepts an explicit hook.cwd nested inside the repository root", () => {
    const resolution = resolvePinnedHookCwd(
      { events: ["*"], action: "shell", cwd: "/pinned/root/.capsules/x" },
      "/pinned/root",
    );
    expect(resolution).toEqual({ ok: true, cwd: "/pinned/root/.capsules/x" });
  });

  test("resolvePinnedHookCwd refuses a hook.cwd that escapes the repository root", () => {
    const resolution = resolvePinnedHookCwd(
      { events: ["*"], action: "shell", cwd: "/etc" },
      "/pinned/root",
    );
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.reason).toContain("outside the repository root");
    }
  });

  test("resolvePinnedHookCwd refuses a relative traversal that escapes the repository root", () => {
    const resolution = resolvePinnedHookCwd(
      { events: ["*"], action: "shell", cwd: "../../etc" },
      "/pinned/root",
    );
    expect(resolution.ok).toBe(false);
  });

  test("executeShellAction refuses a hook.cwd outside the repository before spawning anything", async () => {
    const hook: HookDefinition = {
      id: "shell-cwd-escape",
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["pwd"],
      cwd: "/etc",
    };

    const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "/etc\n", stderr: "" }));
    const result = await executeShellAction(hook, "task:complete", undefined, runner);

    expect(result.success).toBe(false);
    expect(result.error).toContain("CWD_OUTSIDE_REPOSITORY");
    expect(calls.length).toBe(0);
  });

  test("executeShellAction pins cwd to the repo root when hook.cwd is not set, ignoring ambient process.cwd()", async () => {
    const repoRoot = findRepoRoot();
    const otherDir = getScratch("shell-cwd-pin-ambient");
    const originalCwd = process.cwd();
    process.chdir(otherDir);
    try {
      const hook: HookDefinition = {
        id: "shell-cwd-pin",
        events: ["task:complete"],
        action: "shell",
        commandArgv: ["pwd"],
      };
      const result = await executeShellAction(hook, "task:complete");
      expect(result.success).toBe(true);
      expect(result.output).toContain(repoRoot);
      expect(result.output).not.toContain(otherDir);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("Lifecycle Hooks - Destructive Command Hardening (second layer)", () => {
  test("commandContainsRecursiveDelete flags recursive rm even without -f", () => {
    expect(commandContainsRecursiveDelete("rm -rf /tmp/whatever")).toBe(true);
    expect(commandContainsRecursiveDelete("rm -fr ./build")).toBe(true);
    expect(commandContainsRecursiveDelete("rm -r -f ./build")).toBe(true);
    expect(commandContainsRecursiveDelete("rm --recursive --force ./build")).toBe(true);
    expect(commandContainsRecursiveDelete("echo hi && rm -rf /tmp/x")).toBe(true);
    expect(commandContainsRecursiveDelete("/bin/rm -rf /tmp/x")).toBe(true);
    expect(commandContainsRecursiveDelete("rm -r ./dir-only")).toBe(true);
    expect(commandContainsRecursiveDelete("rm --recursive ./dir-only")).toBe(true);
  });

  test("commandContainsRecursiveDelete does not flag benign rm usage", () => {
    expect(commandContainsRecursiveDelete("rm ./one-file.txt")).toBe(false);
    expect(commandContainsRecursiveDelete("rm -f ./file-only")).toBe(false);
    expect(commandContainsRecursiveDelete("echo removing rf stuff")).toBe(false);
  });

  test("commandContainsRecursiveDelete flags backslash- and quote-escaped rm tokens", () => {
    expect(commandContainsRecursiveDelete("\\rm -rf ../other-sibling")).toBe(true);
    expect(commandContainsRecursiveDelete("r\\m -rf ../other-sibling")).toBe(true);
    expect(commandContainsRecursiveDelete("'rm' -rf ../other-sibling")).toBe(true);
    expect(commandContainsRecursiveDelete('"rm" -rf ../other-sibling')).toBe(true);
    expect(commandContainsRecursiveDelete("\\rm -RF ../other-sibling")).toBe(true);
  });

  test("findForbiddenCommandMatch matches case-insensitively as a substring", () => {
    const forbidden = ["git commit", "git push", "git reset", "rm -rf /"];
    expect(findForbiddenCommandMatch("git push origin main", forbidden)).toBe("git push");
    expect(findForbiddenCommandMatch("GIT COMMIT -m x", forbidden)).toBe("git commit");
    expect(findForbiddenCommandMatch("echo safe", forbidden)).toBeUndefined();
  });

  test("executeShellAction refuses a commandArgv matching the repository forbidden_commands policy even though echo is allowlisted", async () => {
    const hook: HookDefinition = {
      id: "shell-forbidden-policy",
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["echo", "git", "push", "origin", "main"],
    };

    const { runner, calls } = fakeRunner(() => ({
      status: 0,
      stdout: "git push origin main",
      stderr: "",
    }));
    const result = await executeShellAction(hook, "task:complete", undefined, runner);

    expect(result.success).toBe(false);
    expect(result.error).toContain("FORBIDDEN_COMMANDS_POLICY");
    expect(result.error).toContain("git push");
    expect(calls.length).toBe(0);
  });
});
