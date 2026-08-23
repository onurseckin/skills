import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_DARWIN_AUDIO_COMMAND,
  DEFAULT_DARWIN_SOUND_PATH,
  DEFAULT_HOOK_CONFIG,
  DEFAULT_HOOK_SCHEMA,
  DEFAULT_HOOK_VERSION,
  dispatchLifecycleHook,
  dispatchSingleHook,
  executeAudioAction,
  executeCustomAction,
  executeShellAction,
  executeWebhookAction,
  isPlatformSupported,
  loadHookConfig,
  matchesEvent,
  parseHookConfig,
  parseHookDefinition,
  resolveAudioSoundPath,
  resolveHookConfigFile,
  saveHookConfig,
  type HookConfig,
  type HookDefinition,
  type LifecycleEvent,
} from "../../../olt/scripts/src/hooks/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

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

  test("executes audio action with custom command safely", async () => {
    const hook: HookDefinition = {
      id: "test-audio",
      events: ["orchestrator:complete"],
      action: "audio",
      command: "echo 'mock audio played'",
      platforms: ["darwin"],
    };

    const result = await executeAudioAction(hook, "darwin");
    expect(result.success).toBe(true);
    expect(result.output).toContain("Played audio");
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

describe("Lifecycle Hooks - Shell Action Execution", () => {
  test("executes shell command capturing stdout and environment variables", async () => {
    const hook: HookDefinition = {
      id: "shell-test-1",
      events: ["gate:pass"],
      action: "shell",
      command: 'echo "EV=$LIFECYCLE_EVENT CUST=$CUSTOM_VAR"',
      env: { CUSTOM_VAR: "custom_value_123" },
    };

    const result = await executeShellAction(hook, "gate:pass", { sample: "data" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("EV=gate:pass");
    expect(result.output).toContain("CUST=custom_value_123");
  });

  test("handles command execution in custom working directory", async () => {
    const dir = scratchRoot(import.meta.path, "shell-cwd");
    const hook: HookDefinition = {
      id: "shell-cwd-test",
      events: ["task:complete"],
      action: "shell",
      command: "pwd",
      cwd: dir,
    };

    const result = await executeShellAction(hook, "task:complete");
    expect(result.success).toBe(true);
    expect(result.output).toContain(dir);
  });

  test("captures shell exit code failure safely without throwing", async () => {
    const hook: HookDefinition = {
      id: "shell-fail-test",
      events: ["task:fail"],
      action: "shell",
      command: "sh -c 'echo \"failure-detail\" >&2; exit 42'",
    };

    const result = await executeShellAction(hook, "task:fail");
    expect(result.success).toBe(false);
    expect(result.error).toContain("failure-detail");
  });

  test("returns failure for missing command", async () => {
    const hook: HookDefinition = {
      id: "shell-empty",
      events: ["run:start"],
      action: "shell",
    };

    const result = await executeShellAction(hook, "run:start");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing shell command");
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
      command: "echo test",
      enabled: false,
    };

    const resDisabled = await dispatchSingleHook(hookDisabled, "gate:pass");
    expect(resDisabled.skipped).toBe(true);
    expect(resDisabled.skipReason).toBe("hook_disabled");

    const hookLinuxOnly: HookDefinition = {
      id: "linux-only-hook",
      events: ["gate:pass"],
      action: "shell",
      command: "echo test",
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
          command: "sh -c 'exit 1'",
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
          command: "echo 'should not run'",
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
          command: "echo 'ignored'",
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
          command: "echo 'gate'",
        },
      ],
    };

    const results = await dispatchLifecycleHook("task:start", {}, config);
    expect(results).toEqual([]);
  });
});

describe("Lifecycle Hooks - Declarative Config Parsing & Loading", () => {
  test("DEFAULT_HOOK_CONFIG includes audio hooks for orchestrator and run complete on darwin", () => {
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
    expect(orchHook?.command).toBe(DEFAULT_DARWIN_AUDIO_COMMAND);

    const runHook = DEFAULT_HOOK_CONFIG.hooks.find((h) => h.events.includes("run:complete"));
    expect(runHook).toBeDefined();
    expect(runHook?.action).toBe("audio");
    expect(runHook?.platforms).toEqual(["darwin"]);
  });

  test("parseHookDefinition handles single event and array of events", () => {
    const single = parseHookDefinition(
      {
        id: "hook-single",
        event: "gate:pass",
        action: "shell",
        command: "echo single",
      },
      "default-1",
    );
    expect(single?.events).toEqual(["gate:pass"]);
    expect(single?.action).toBe("shell");
    expect(single?.id).toBe("hook-single");

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
    expect(parseHookDefinition({ action: "shell", command: "ls" }, "def")).toBeNull();
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

  test("loads hook configuration from .capsules/hooks.json in target directory", () => {
    const dir = scratchRoot(import.meta.path, "load-capsules-config");
    const capsulesDir = join(dir, ".olt", "capsules");
    mkdirSync(capsulesDir, { recursive: true });

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "custom-capsule-hook",
          events: ["orchestrator:complete"],
          action: "shell",
          command: "echo capsule-complete",
        },
      ],
    };

    writeFileSync(join(capsulesDir, "hooks.json"), JSON.stringify(customConfig), "utf8");

    const loaded = loadHookConfig(dir);
    expect(loaded.hooks.length).toBe(1);
    expect(loaded.hooks[0]?.id).toBe("custom-capsule-hook");
  });

  test("loads hook configuration from olt/hooks.json in target directory", () => {
    const dir = scratchRoot(import.meta.path, "load-olt-config");
    const oltDir = join(dir, "olt");
    mkdirSync(oltDir, { recursive: true });

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "custom-olt-hook",
          events: ["run:complete"],
          action: "shell",
          command: "echo olt-complete",
        },
      ],
    };

    writeFileSync(join(oltDir, "hooks.json"), JSON.stringify(customConfig), "utf8");

    const loaded = loadHookConfig(dir);
    expect(loaded.hooks.length).toBe(1);
    expect(loaded.hooks[0]?.id).toBe("custom-olt-hook");
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
      join(__dirname, "../../../olt/scripts/src/hooks/config.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/dispatcher.ts"),
      join(__dirname, "../../../olt/scripts/src/hooks/index.ts"),
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
});
