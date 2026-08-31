import { describe, expect, test } from "bun:test";
import {
  dispatchLifecycleHook,
  dispatchSingleHook,
  isPlatformSupported,
  matchesEvent,
  type HookConfig,
  type HookDefinition,
} from "../../../olt/scripts/src/hooks/index.ts";

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
  test("undefined or empty platform allows all platforms", () => {
    expect(isPlatformSupported(undefined, "darwin")).toBe(true);
    expect(isPlatformSupported(undefined, "linux")).toBe(true);
    expect(isPlatformSupported(undefined, "win32")).toBe(true);

    expect(isPlatformSupported([], "darwin")).toBe(true);
    expect(isPlatformSupported([], "linux")).toBe(true);
  });

  test("filters correctly for single or multiple allowed platforms", () => {
    expect(isPlatformSupported("darwin", "darwin")).toBe(true);
    expect(isPlatformSupported("darwin", "linux")).toBe(false);

    expect(isPlatformSupported(["darwin", "linux"], "darwin")).toBe(true);
    expect(isPlatformSupported(["darwin", "linux"], "linux")).toBe(true);
    expect(isPlatformSupported(["darwin", "linux"], "win32")).toBe(false);
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
