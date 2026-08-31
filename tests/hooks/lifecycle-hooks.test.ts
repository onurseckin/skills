import { describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  ALLOWED_SHELL_EXECUTABLES,
  DEFAULT_DARWIN_AUDIO_COMMAND,
  DEFAULT_DARWIN_SOUND_PATH,
  DEFAULT_HOOK_CONFIG,
  DEFAULT_HOOK_SCHEMA,
  DEFAULT_HOOK_VERSION,
  commandContainsRecursiveDelete,
  dispatchLifecycleHook,
  dispatchSingleHook,
  executeAudioAction,
  executeCustomAction,
  executeShellAction,
  executeWebhookAction,
  findForbiddenCommandMatch,
  isAllowedShellExecutable,
  isPlatformSupported,
  loadHookConfig,
  matchesEvent,
  parseHookConfig,
  parseHookDefinition,
  resolveAudioSoundPath,
  resolveHookConfigFile,
  resolvePinnedHookCwd,
  saveHookConfig,
  type HookConfig,
  type HookDefinition,
  type ProcessRunner,
  type ProcessRunResult,
} from "../../olt/scripts/src/hooks/index.ts";
import { findRepoRoot } from "../../olt/scripts/src/core/shared/paths.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

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

function loadHookConfigError(action: () => HookConfig): HarnessError {
  try {
    action();
  } catch (error) {
    if (error instanceof HarnessError) return error;
    throw error;
  }
  throw new Error("expected loadHookConfig to throw a HarnessError");
}

describe("Lifecycle Hooks - Event Pattern Matching", () => {
  test("exact matches succeed for standard and custom events", () => {
    expect(matchesEvent("orchestrator:complete", "orchestrator:complete")).toBe(true);
    expect(matchesEvent("run:complete", "run:complete")).toBe(true);
    expect(matchesEvent("mind:pulse", "mind:pulse")).toBe(true);
    expect(matchesEvent("gate:pass", "gate:pass")).toBe(true);
    expect(matchesEvent("task:review", "task:review")).toBe(true);
    expect(matchesEvent("critic:approve", "critic:approve")).toBe(true);
    expect(matchesEvent("custom:event", "custom:event")).toBe(true);

    expect(matchesEvent("gate:pass", "gate:fail")).toBe(false);
    expect(matchesEvent("run:complete", "run:start")).toBe(false);
  });

  test("universal wildcard '*' matches any lifecycle event", () => {
    expect(matchesEvent("*", "orchestrator:complete")).toBe(true);
    expect(matchesEvent("*", "run:start")).toBe(true);
    expect(matchesEvent("*", "gate:fail")).toBe(true);
    expect(matchesEvent("*", "arbitrary:unknown:event")).toBe(true);
  });

  test("prefix wildcards match matching namespaces", () => {
    expect(matchesEvent("gate:*", "gate:pass")).toBe(true);
    expect(matchesEvent("gate:*", "gate:fail")).toBe(true);
    expect(matchesEvent("gate:*", "gate:prove")).toBe(true);
    expect(matchesEvent("gate:*", "task:pass")).toBe(false);
    expect(matchesEvent("gate:*", "gate")).toBe(true);

    expect(matchesEvent("orchestrator:*", "orchestrator:complete")).toBe(true);
    expect(matchesEvent("orchestrator:*", "orchestrator:start")).toBe(true);
    expect(matchesEvent("orchestrator:*", "critic:approve")).toBe(false);

    expect(matchesEvent("task:*", "task:start")).toBe(true);
    expect(matchesEvent("task:*", "task:review")).toBe(true);
    expect(matchesEvent("task:*", "task:complete")).toBe(true);
  });

  test("suffix wildcards match matching actions across domains", () => {
    expect(matchesEvent("*:complete", "orchestrator:complete")).toBe(true);
    expect(matchesEvent("*:complete", "run:complete")).toBe(true);
    expect(matchesEvent("*:complete", "task:complete")).toBe(true);
    expect(matchesEvent("*:complete", "repair:complete")).toBe(true);
    expect(matchesEvent("*:complete", "run:start")).toBe(false);
    expect(matchesEvent("*:complete", "gate:pass")).toBe(false);
  });
});

describe("Lifecycle Hooks - Platform Filtering", () => {
  test("undefined or empty platforms list supports all platforms", () => {
    expect(isPlatformSupported(undefined, "darwin")).toBe(true);
    expect(isPlatformSupported(undefined, "linux")).toBe(true);
    expect(isPlatformSupported(undefined, "win32")).toBe(true);
    expect(isPlatformSupported([], "darwin")).toBe(true);
    expect(isPlatformSupported([], "linux")).toBe(true);
  });

  test("filters execution based on platform whitelist", () => {
    expect(isPlatformSupported(["darwin"], "darwin")).toBe(true);
    expect(isPlatformSupported(["darwin"], "linux")).toBe(false);
    expect(isPlatformSupported(["darwin"], "win32")).toBe(false);

    expect(isPlatformSupported(["linux", "win32"], "linux")).toBe(true);
    expect(isPlatformSupported(["linux", "win32"], "win32")).toBe(true);
    expect(isPlatformSupported(["linux", "win32"], "darwin")).toBe(false);
  });
});

describe("Lifecycle Hooks - Audio Action Resolution & Handling", () => {
  test("resolves sound file paths accurately", () => {
    expect(resolveAudioSoundPath("Bottle")).toBe("/System/Library/Sounds/Bottle.aiff");
    expect(resolveAudioSoundPath("Hero")).toBe("/System/Library/Sounds/Hero.aiff");
    expect(resolveAudioSoundPath("/custom/sounds/alert.wav")).toBe("/custom/sounds/alert.wav");
    expect(resolveAudioSoundPath(undefined, "/explicit/file.aiff")).toBe("/explicit/file.aiff");
    expect(resolveAudioSoundPath()).toBe(DEFAULT_DARWIN_SOUND_PATH);
  });

  test("invokes afplay directly via argv, never through a shell, for a valid sound path", async () => {
    const hook: HookDefinition = {
      id: "test-audio",
      events: ["orchestrator:complete"],
      action: "audio",
      sound: "Bottle",
      platforms: ["darwin"],
    };

    const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "", stderr: "" }));
    const result = await executeAudioAction(hook, "darwin", runner);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Played audio");
    expect(calls.length).toBe(1);
    expect(calls[0]?.executable).toBe("afplay");
    expect(calls[0]?.args).toEqual([DEFAULT_DARWIN_SOUND_PATH]);
  });

  test("refuses an audio hook that still supplies a legacy shell command string", async () => {
    const hook: HookDefinition = {
      id: "test-audio-legacy-command",
      events: ["orchestrator:complete"],
      action: "audio",
      command: "afplay /System/Library/Sounds/Bottle.aiff; rm -rf /",
      platforms: ["darwin"],
    };

    const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "", stderr: "" }));
    const result = await executeAudioAction(hook, "darwin", runner);

    expect(result.success).toBe(false);
    expect(result.error).toContain("AUDIO_COMMAND_STRING_REJECTED");
    expect(calls.length).toBe(0);
  });

  test("refuses an audio hook whose resolved file path is not a recognized audio file", async () => {
    const hook: HookDefinition = {
      id: "test-audio-bad-path",
      events: ["orchestrator:complete"],
      action: "audio",
      file: "/etc/passwd",
      platforms: ["darwin"],
    };

    const { runner, calls } = fakeRunner(() => ({ status: 0, stdout: "", stderr: "" }));
    const result = await executeAudioAction(hook, "darwin", runner);

    expect(result.success).toBe(false);
    expect(result.error).toContain("AUDIO_FILE_PATH_INVALID");
    expect(calls.length).toBe(0);
  });

  test("skips audio action gracefully on unsupported platform", async () => {
    const hook: HookDefinition = {
      id: "test-audio-unsupported",
      events: ["orchestrator:complete"],
      action: "audio",
      platforms: ["darwin"],
    };

    const result = await executeAudioAction(hook, "freebsd");
    expect(result.success).toBe(true);
    expect(result.output).toContain("Audio action skipped");
  });
});

describe("Lifecycle Hooks - Shell Action Execution (argv-only)", () => {
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
    const dir = scratchRoot(import.meta.path, "shell-cwd");
    const hook: HookDefinition = {
      id: "shell-cwd-test",
      events: ["task:complete"],
      action: "shell",
      commandArgv: ["pwd"],
      cwd: dir,
    };

    const result = await executeShellAction(hook, "task:complete");
    expect(result.success).toBe(true);
    expect(result.output).toContain(dir);
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
});

describe("Lifecycle Hooks - Legacy Shell String Migration Path", () => {
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

describe("Lifecycle Hooks - PATH Poisoning Hardening", () => {
  test("hook.env cannot redirect an allowlisted executable to an attacker binary via PATH poisoning", async () => {
    const dir = scratchRoot(import.meta.path, "path-poison");
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
    const otherDir = scratchRoot(import.meta.path, "shell-cwd-pin-ambient");
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

describe("Lifecycle Hooks - Webhook Action Execution", () => {
  test("dispatches HTTP webhook with JSON payload and custom headers", async () => {
    let receivedEvent: string | null = null;
    let receivedPayload: Record<string, unknown> | null = null;
    let receivedAuthHeader: string | null = null;

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedAuthHeader = req.headers.get("Authorization");
        const body = (await req.json()) as { event: string; payload: Record<string, unknown> };
        receivedEvent = body.event;
        receivedPayload = body.payload;
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    try {
      const hook: HookDefinition = {
        id: "webhook-test-1",
        events: ["mind:pulse"],
        action: "webhook",
        url: `http://localhost:${server.port}/webhook`,
        method: "POST",
        headers: { Authorization: "Bearer test-token-xyz" },
      };

      const result = await executeWebhookAction(hook, "mind:pulse", { pulse: 42 });
      expect(result.success).toBe(true);
      expect(result.output).toContain("HTTP 200");
      expect(receivedEvent).toBe("mind:pulse");
      expect(receivedPayload).toEqual({ pulse: 42 });
      expect(receivedAuthHeader).toBe("Bearer test-token-xyz");
    } finally {
      server.stop(true);
    }
  });

  test("handles HTTP server error responses gracefully", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Internal Server Error", { status: 500 });
      },
    });

    try {
      const hook: HookDefinition = {
        id: "webhook-err-test",
        events: ["critic:reject"],
        action: "webhook",
        url: `http://localhost:${server.port}/fail`,
      };

      const result = await executeWebhookAction(hook, "critic:reject");
      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 500");
    } finally {
      server.stop(true);
    }
  });

  test("handles connection failure / unreachable endpoint without throwing", async () => {
    const hook: HookDefinition = {
      id: "webhook-unreachable",
      events: ["gate:fail"],
      action: "webhook",
      url: "http://127.0.0.1:59999/unreachable",
      timeout_ms: 500,
    };

    const result = await executeWebhookAction(hook, "gate:fail");
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("returns failure for missing webhook URL", async () => {
    const hook: HookDefinition = {
      id: "webhook-no-url",
      events: ["run:complete"],
      action: "webhook",
    };

    const result = await executeWebhookAction(hook, "run:complete");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing webhook URL");
  });
});

describe("Lifecycle Hooks - Custom In-Process Handler", () => {
  test("executes custom handler and receives event and payload", async () => {
    let handledEvent: string | null = null;
    let handledPayload: Record<string, unknown> | null = null;

    const hook: HookDefinition = {
      id: "custom-handler-test",
      events: ["task:review"],
      action: "custom",
      handler: (event, payload) => {
        handledEvent = event;
        handledPayload = (payload as Record<string, unknown>) ?? null;
        return { processed: true };
      },
    };

    const result = await executeCustomAction(hook, "task:review", { reviewer: "critic-1" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("processed");
    expect(handledEvent).toBe("task:review");
    expect(handledPayload).toEqual({ reviewer: "critic-1" });
  });

  test("catches throwing custom handler safely without crashing", async () => {
    const hook: HookDefinition = {
      id: "custom-throw-test",
      events: ["repair:start"],
      action: "custom",
      handler: () => {
        throw new Error("Simulated custom handler explosion");
      },
    };

    const result = await executeCustomAction(hook, "repair:start");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Simulated custom handler explosion");
  });

  test("returns failure for missing custom handler function", async () => {
    const hook: HookDefinition = {
      id: "custom-missing-handler",
      events: ["repair:complete"],
      action: "custom",
    };

    const result = await executeCustomAction(hook, "repair:complete");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing custom hook handler function");
  });
});

describe("Lifecycle Hooks - Non-Blocking Resilience & Single Dispatch", () => {
  test("dispatchSingleHook records duration and platform skip reasons", async () => {
    const hookDisabled: HookDefinition = {
      id: "disabled-hook",
      events: ["gate:pass"],
      action: "shell",
      commandArgv: ["echo", "test"],
      enabled: false,
    };

    const resDisabled = await dispatchSingleHook(hookDisabled, "gate:pass");
    expect(resDisabled.skipped).toBe(true);
    expect(resDisabled.skipReason).toBe("hook_disabled");

    const hookLinuxOnly: HookDefinition = {
      id: "linux-only-hook",
      events: ["gate:pass"],
      action: "shell",
      commandArgv: ["echo", "test"],
      platforms: ["linux"],
    };

    const resLinuxOnly = await dispatchSingleHook(hookLinuxOnly, "gate:pass", undefined, "darwin");
    expect(resLinuxOnly.skipped).toBe(true);
    expect(resLinuxOnly.skipReason).toContain("platform_darwin_not_supported");
  });

  test("dispatchLifecycleHook runs all matching hooks and isolates errors", async () => {
    let hook2Ran = false;

    const testConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "failing-shell-hook",
          events: ["orchestrator:complete"],
          action: "shell",
          commandArgv: ["rm", "-rf", "x"],
        },
        {
          id: "succeeding-custom-hook",
          events: ["orchestrator:complete"],
          action: "custom",
          handler: () => {
            hook2Ran = true;
            return "success-data";
          },
        },
        {
          id: "non-matching-hook",
          events: ["gate:pass"],
          action: "shell",
          commandArgv: ["echo", "should not run"],
        },
      ],
    };

    const results = await dispatchLifecycleHook(
      "orchestrator:complete",
      { runId: "r-100" },
      testConfig,
    );

    expect(results.length).toBe(2);
    expect(results[0]?.hookId).toBe("failing-shell-hook");
    expect(results[0]?.success).toBe(false);
    expect(results[0]?.error).toContain("EXECUTABLE_NOT_ALLOWLISTED");

    expect(results[1]?.hookId).toBe("succeeding-custom-hook");
    expect(results[1]?.success).toBe(true);
    expect(results[1]?.output).toContain("success-data");
    expect(hook2Ran).toBe(true);
  });

  test("dispatchLifecycleHook returns empty array when hooks are globally disabled", async () => {
    const disabledConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: false,
      hooks: [
        {
          id: "ignored-hook",
          events: ["*"],
          action: "shell",
          commandArgv: ["echo", "ignored"],
        },
      ],
    };

    const results = await dispatchLifecycleHook("run:complete", {}, disabledConfig);
    expect(results).toEqual([]);
  });

  test("dispatchLifecycleHook returns empty array when no events match", async () => {
    const config: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "gate-only",
          events: ["gate:*"],
          action: "shell",
          commandArgv: ["echo", "gate"],
        },
      ],
    };

    const results = await dispatchLifecycleHook("task:start", {}, config);
    expect(results).toEqual([]);
  });
});

describe("Lifecycle Hooks - Declarative Config Parsing & Loading", () => {
  test("DEFAULT_HOOK_CONFIG includes audio hooks for orchestrator and run complete on darwin with no shell command", () => {
    expect(DEFAULT_HOOK_CONFIG.schema).toBe(DEFAULT_HOOK_SCHEMA);
    expect(DEFAULT_HOOK_CONFIG.version).toBe(DEFAULT_HOOK_VERSION);
    expect(DEFAULT_HOOK_CONFIG.enabled).toBe(true);
    expect(DEFAULT_HOOK_CONFIG.hooks.length).toBe(2);

    const orchHook = DEFAULT_HOOK_CONFIG.hooks.find((h) =>
      h.events.includes("orchestrator:complete"),
    );
    expect(orchHook).toBeDefined();
    expect(orchHook?.action).toBe("audio");
    expect(orchHook?.sound).toBe("Bottle");
    expect(orchHook?.platforms).toEqual(["darwin"]);
    expect(orchHook?.command).toBeUndefined();

    const runHook = DEFAULT_HOOK_CONFIG.hooks.find((h) => h.events.includes("run:complete"));
    expect(runHook).toBeDefined();
    expect(runHook?.action).toBe("audio");
    expect(runHook?.platforms).toEqual(["darwin"]);
    expect(runHook?.command).toBeUndefined();

    expect(DEFAULT_DARWIN_AUDIO_COMMAND).toBe(`afplay ${DEFAULT_DARWIN_SOUND_PATH}`);
  });

  test("parseHookDefinition handles single event and array of events", () => {
    const single = parseHookDefinition(
      {
        id: "hook-single",
        event: "gate:pass",
        action: "shell",
        commandArgv: ["echo", "single"],
      },
      "default-1",
    );
    expect(single?.events).toEqual(["gate:pass"]);
    expect(single?.action).toBe("shell");
    expect(single?.id).toBe("hook-single");
    expect(single?.commandArgv).toEqual(["echo", "single"]);

    const multi = parseHookDefinition(
      {
        id: "hook-multi",
        events: ["gate:pass", "gate:fail"],
        action: "audio",
        sound: "Glass",
      },
      "default-2",
    );
    expect(multi?.events).toEqual(["gate:pass", "gate:fail"]);
    expect(multi?.action).toBe("audio");
    expect(multi?.sound).toBe("Glass");
  });

  test("parseHookDefinition normalizes commandArgv only when every element is a non-empty string", () => {
    const valid = parseHookDefinition(
      { events: ["task:complete"], action: "shell", commandArgv: ["echo", "hi"] },
      "def",
    );
    expect(valid?.commandArgv).toEqual(["echo", "hi"]);

    const invalid = parseHookDefinition(
      { events: ["task:complete"], action: "shell", commandArgv: ["echo", 42] },
      "def",
    );
    expect(invalid?.commandArgv).toBeUndefined();

    const empty = parseHookDefinition(
      { events: ["task:complete"], action: "shell", commandArgv: [] },
      "def",
    );
    expect(empty?.commandArgv).toBeUndefined();
  });

  test("parseHookDefinition handles platform and headers normalization", () => {
    const hook = parseHookDefinition(
      {
        events: ["critic:approve"],
        action: "webhook",
        url: "https://example.com/api",
        platform: "darwin",
        headers: { "X-Custom": "header-val" },
        env: { FOO: "bar" },
      },
      "auto-id-1",
    );

    expect(hook?.id).toBe("auto-id-1");
    expect(hook?.platforms).toEqual(["darwin"]);
    expect(hook?.headers).toEqual({ "X-Custom": "header-val" });
    expect(hook?.env).toEqual({ FOO: "bar" });
  });

  test("parseHookDefinition returns null for missing events or invalid action", () => {
    expect(parseHookDefinition({ action: "shell", commandArgv: ["ls"] }, "def")).toBeNull();
    expect(
      parseHookDefinition({ events: ["gate:pass"], action: "invalid_action" }, "def"),
    ).toBeNull();
    expect(parseHookDefinition("invalid_string", "def")).toBeNull();
    expect(parseHookDefinition(null, "def")).toBeNull();
  });

  test("parseHookConfig falls back to default on invalid input", () => {
    expect(parseHookConfig(null)).toEqual(DEFAULT_HOOK_CONFIG);
    expect(parseHookConfig("invalid")).toEqual(DEFAULT_HOOK_CONFIG);
    expect(parseHookConfig([])).toEqual(DEFAULT_HOOK_CONFIG);
  });

  test("uses only the repository canonical config when a nested cwd contains bare hooks.json", () => {
    const dir = scratchRoot(import.meta.path, "canonical-config-from-nested-cwd");
    const capsulesDir = join(dir, ".olt", "capsules");
    const nestedDir = join(dir, "nested", "workspace");
    mkdirSync(capsulesDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "canonical-hook",
          events: ["orchestrator:complete"],
          action: "shell",
          commandArgv: ["echo", "canonical"],
        },
      ],
    };

    writeFileSync(join(capsulesDir, "hooks.json"), JSON.stringify(customConfig), "utf8");
    writeFileSync(
      join(nestedDir, "hooks.json"),
      JSON.stringify({ ...customConfig, hooks: [{ ...customConfig.hooks[0], id: "nested-hook" }] }),
      "utf8",
    );

    const loaded = loadHookConfig(undefined, nestedDir);
    expect(loaded.hooks.length).toBe(1);
    expect(loaded.hooks[0]?.id).toBe("canonical-hook");
    expect(loaded.hooks[0]?.commandArgv).toEqual(["echo", "canonical"]);
  });

  test("ignores legacy olt and capsule hook locations", () => {
    const dir = scratchRoot(import.meta.path, "ignore-legacy-hook-locations");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    mkdirSync(join(dir, "olt"), { recursive: true });
    mkdirSync(join(dir, ".capsules"), { recursive: true });

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "legacy-hook",
          events: ["run:complete"],
          action: "shell",
          commandArgv: ["echo", "legacy"],
        },
      ],
    };

    writeFileSync(join(dir, "olt", "hooks.json"), JSON.stringify(customConfig), "utf8");
    writeFileSync(join(dir, ".capsules", "hooks.json"), JSON.stringify(customConfig), "utf8");

    expect(loadHookConfig(undefined, dir)).toEqual(DEFAULT_HOOK_CONFIG);
  });

  test("resolves an explicit directory through its repository canonical config", () => {
    const dir = scratchRoot(import.meta.path, "explicit-directory-canonical-config");
    const nestedDir = join(dir, "nested", "workspace");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(
      canonicalPath,
      JSON.stringify({
        ...DEFAULT_HOOK_CONFIG,
        hooks: [{ ...DEFAULT_HOOK_CONFIG.hooks[0], id: "explicit-directory" }],
      }),
      "utf8",
    );

    expect(resolveHookConfigFile(nestedDir)).toBe(canonicalPath);
    expect(loadHookConfig(nestedDir).hooks[0]?.id).toBe("explicit-directory");
  });

  test("fails loudly when the canonical hook config is a symlink", () => {
    const dir = scratchRoot(import.meta.path, "canonical-hook-config-symlink");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    const targetPath = join(dir, "trusted-target.json");
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(targetPath, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    symlinkSync(targetPath, canonicalPath);

    const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("fails loudly when the canonical config resolves outside its repository through a symlinked parent", () => {
    const dir = scratchRoot(import.meta.path, "canonical-hook-config-symlinked-parent");
    const outsideDir = scratchRoot(import.meta.path, "canonical-hook-config-outside-parent");
    mkdirSync(join(outsideDir, "capsules"), { recursive: true });
    writeFileSync(
      join(outsideDir, "capsules", "hooks.json"),
      JSON.stringify(DEFAULT_HOOK_CONFIG),
      "utf8",
    );
    symlinkSync(outsideDir, join(dir, ".olt"));

    const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("fails loudly when the canonical hook config is group or world writable on POSIX", () => {
    if (process.platform === "win32") return;

    const dir = scratchRoot(import.meta.path, "canonical-hook-config-writable-mode");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(canonicalPath, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    chmodSync(canonicalPath, 0o666);

    const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
    expect(error.code).toBe("INTEGRITY");
  });

  test("fails loudly when the canonical hook config owner differs from the current user on POSIX", () => {
    if (process.platform === "win32" || typeof process.getuid !== "function") return;

    const dir = scratchRoot(import.meta.path, "canonical-hook-config-wrong-owner");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(canonicalPath, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    const bytesBefore = readFileSync(canonicalPath, "utf8");
    const actualUid = statSync(canonicalPath).uid;
    const getuidSpy = spyOn(process, "getuid").mockReturnValue(actualUid + 1);

    try {
      const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
      expect(error.code).toBe("INTEGRITY");
      expect(error.message).toContain("not owned by the current user");
      expect(readFileSync(canonicalPath, "utf8")).toBe(bytesBefore);
    } finally {
      getuidSpy.mockRestore();
    }
  });

  test("rejects an explicit path that traverses outside the current repository", () => {
    const dir = scratchRoot(import.meta.path, "explicit-hook-config-traversal");
    const nestedDir = join(dir, "nested");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    mkdirSync(nestedDir, { recursive: true });

    const error = loadHookConfigError(() => loadHookConfig("../../outside.json", nestedDir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("rejects an explicit path inside the repository when a symlinked parent resolves outside", () => {
    const dir = scratchRoot(import.meta.path, "explicit-hook-config-symlinked-parent");
    const outsideDir = scratchRoot(import.meta.path, "explicit-hook-config-outside-parent");
    const outsideConfig = join(outsideDir, "hooks.json");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    writeFileSync(outsideConfig, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    symlinkSync(outsideDir, join(dir, "linked"));

    const error = loadHookConfigError(() => loadHookConfig(join("linked", "hooks.json"), dir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("keeps a missing explicit JSON path compatible with saveHookConfig and trusted reload", () => {
    const dir = scratchRoot(import.meta.path, "save-reload-missing-explicit-hook-config");
    const targetFile = join(dir, "config", "hooks.json");
    mkdirSync(join(dir, ".olt"), { recursive: true });

    expect(loadHookConfig(targetFile, dir)).toEqual(DEFAULT_HOOK_CONFIG);
    saveHookConfig(
      {
        schema: DEFAULT_HOOK_SCHEMA,
        version: DEFAULT_HOOK_VERSION,
        enabled: true,
        hooks: [{ id: "saved-explicit-hook", events: ["run:complete"], action: "audio" }],
      },
      targetFile,
    );

    expect(loadHookConfig(targetFile, dir).hooks[0]?.id).toBe("saved-explicit-hook");
  });

  test("rejects a file from another repository while explicit directory lookup resolves that repository", () => {
    const repoA = scratchRoot(import.meta.path, "explicit-hook-config-repo-a");
    const repoB = scratchRoot(import.meta.path, "explicit-hook-config-repo-b");
    const repoBFile = join(repoB, "custom-hooks.json");
    const repoBCanonical = join(repoB, ".olt", "capsules", "hooks.json");
    mkdirSync(join(repoA, ".olt"), { recursive: true });
    mkdirSync(join(repoB, ".olt", "capsules"), { recursive: true });
    writeFileSync(repoBFile, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    writeFileSync(repoBCanonical, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");

    const error = loadHookConfigError(() => loadHookConfig(repoBFile, repoA));
    expect(error.code).toBe("PATH_SAFETY");
    expect(resolveHookConfigFile(repoB, repoA)).toBe(repoBCanonical);
  });

  test("saveHookConfig durably saves and reloads config", () => {
    const dir = scratchRoot(import.meta.path, "save-reload-config");
    const targetFile = join(dir, "hooks.json");

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "persisted-hook-1",
          events: ["task:complete"],
          action: "audio",
          sound: "Ping",
        },
      ],
    };

    saveHookConfig(customConfig, targetFile);
    expect(existsSync(targetFile)).toBe(true);

    const loaded = loadHookConfig(targetFile);
    expect(loaded.hooks.length).toBe(1);
    expect(loaded.hooks[0]?.id).toBe("persisted-hook-1");
    expect(loaded.hooks[0]?.sound).toBe("Ping");
  });

  test("resolveHookConfigFile returns null when no hook file exists", () => {
    const dir = scratchRoot(import.meta.path, "empty-search-dir");
    expect(resolveHookConfigFile(dir)).toBeNull();
  });
});

describe("Lifecycle Hooks - Invariant & Type Cleanliness Audit", () => {
  test("zero TypeScript any and zero suppressions across hook source files", () => {
    const sourceFiles = [
      join(__dirname, "../../../olt/scripts/src/hooks/types.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/env.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/shell.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/audio.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/actions.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/dispatcher.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/index.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/constants.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/io.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/parser.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/resolver.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/index.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });

  test("zero comments across the hook source files", () => {
    const sourceFiles = [
      join(__dirname, "../../../olt/scripts/src/hooks/types.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/env.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/shell.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/audio.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/actions.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/dispatcher.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/index.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/constants.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/io.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/parser.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/resolver.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/config/index.ts"),
    ];

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/\/\*/);
      expect(content).not.toMatch(/(^|[^:"])\/\/[^"]*$/m);
    }
  });
});
