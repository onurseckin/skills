import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DARWIN_SOUND_PATH,
  executeAudioAction,
  resolveAudioSoundPath,
  type HookDefinition,
  type ProcessRunner,
  type ProcessRunResult,
} from "../../../olt/scripts/src/hooks/index.ts";
import { cleanupVirtualHooksFS, setupVirtualHooksFS } from "../fixture.ts";

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

describe("Lifecycle Hooks - Audio Action Resolution & Handling", () => {
  beforeEach(() => {
    setupVirtualHooksFS();
  });

  afterEach(() => {
    cleanupVirtualHooksFS();
  });

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
