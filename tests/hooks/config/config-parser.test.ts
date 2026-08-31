import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DARWIN_AUDIO_COMMAND,
  DEFAULT_DARWIN_SOUND_PATH,
  DEFAULT_HOOK_CONFIG,
  DEFAULT_HOOK_SCHEMA,
  DEFAULT_HOOK_VERSION,
  parseHookConfig,
  parseHookDefinition,
} from "../../../olt/scripts/src/hooks/index.ts";

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
});
