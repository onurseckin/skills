import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  buildPhaseNotificationPayload,
  defaultNotificationSpawner,
  displaySystemNotification,
  escapeAppleScriptString,
  escapePowerShellString,
  formatElapsedDuration,
  isTestEnvironment,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
  type NotificationPayload,
  type NotificationProcessSpawner,
  type NotificationResult,
  type PhaseCompletionNotificationOptions,
} from "../../../olt/scripts/src/reporting/notifications/index.ts";

describe("OS Audio/Visual Push Notifications", () => {
  describe("Formatting and Sanitization", () => {
    it("formats durations across millisecond boundaries", () => {
      expect(formatElapsedDuration(0)).toBe("0s");
      expect(formatElapsedDuration(-100)).toBe("0s");
      expect(formatElapsedDuration(500)).toBe("<1s");
      expect(formatElapsedDuration(1000)).toBe("1s");
      expect(formatElapsedDuration(59000)).toBe("59s");
      expect(formatElapsedDuration(60000)).toBe("1m 0s");
      expect(formatElapsedDuration(125000)).toBe("2m 5s");
      expect(formatElapsedDuration(3665000)).toBe("1h 1m 5s");
    });

    it("escapes AppleScript special characters correctly", () => {
      expect(escapeAppleScriptString('Hello "World" \\ Path')).toBe('Hello \\"World\\" \\\\ Path');
      expect(escapeAppleScriptString("Plain")).toBe("Plain");
    });

    it("escapes PowerShell special characters correctly", () => {
      expect(escapePowerShellString("Command `test` with 'single quotes'")).toBe(
        "Command ``test`` with ''single quotes''",
      );
    });

    it("builds formatted phase notification payload", () => {
      const options: PhaseCompletionNotificationOptions = {
        phaseName: "Wave 3 Landing",
        commitSha: "deadbeef1234",
        taskCount: 8,
        durationMs: 75000,
        title: "Wave Complete",
        subtitle: "Station Alpha",
        details: "all checks passed",
      };
      const payload = buildPhaseNotificationPayload(options);
      expect(payload.title).toBe("Wave Complete");
      expect(payload.subtitle).toBe("Station Alpha");
      expect(payload.message).toContain("✓ Pushed deadbeef");
      expect(payload.message).toContain("1m 15s");
      expect(payload.message).toContain("(8 tasks)");
      expect(payload.message).toContain("all checks passed");
      expect(payload.soundEnabled).toBe(true);
    });
  });

  describe("Platform Notification Dispatching", () => {
    it("dispatches macOS visual notifications via osascript", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 101, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "macOS Alert",
        subtitle: "Build Success",
        message: "Artifacts compiled",
        soundEnabled: false,
      };
      const result = displaySystemNotification(payload, { platform: "darwin", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("osascript -e");
      expect(invocations.length).toBe(1);
      expect(invocations[0]?.cmd).toBe("osascript");
      expect(invocations[0]?.args[1]).toContain('display notification "Artifacts compiled"');
    });

    it("dispatches Linux visual notifications via notify-send", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 102, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Linux Alert",
        subtitle: "Runner Done",
        message: "All tests green",
        soundEnabled: false,
      };
      const result = displaySystemNotification(payload, { platform: "linux", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("notify-send");
      expect(invocations.length).toBe(1);
      expect(invocations[0]?.cmd).toBe("notify-send");
      expect(invocations[0]?.args[0]).toBe("Linux Alert");
      expect(invocations[0]?.args[1]).toBe("Runner Done\nAll tests green");
    });

    it("dispatches Windows visual notifications via powershell", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 103, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Windows Alert",
        message: "Task completed",
        soundEnabled: false,
      };
      const result = displaySystemNotification(payload, { platform: "win32", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("powershell");
      expect(invocations.length).toBe(1);
      expect(invocations[0]?.cmd).toBe("powershell");
    });

    it("suppresses errors when spawner throws during visual notification", () => {
      const failingSpawn: NotificationProcessSpawner = () => {
        throw new Error("spawn failed intentionally");
      };
      const payload: NotificationPayload = {
        title: "Fail Alert",
        message: "Error test",
        soundEnabled: false,
      };
      const result = displaySystemNotification(payload, {
        platform: "darwin",
        customSpawn: failingSpawn,
      });
      expect(result.delivered).toBe(false);
      expect(result.command).toBeDefined();
    });
  });

  describe("Audio Chime Dispatching", () => {
    it("dispatches darwin audio chime via afplay", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 201, unref: () => {} };
      };
      const result = playCompletionChime(undefined, { platform: "darwin", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("afplay");
      expect(invocations.length).toBe(1);
      expect(invocations[0]?.cmd).toBe("afplay");
      expect(invocations[0]?.args[0]).toBe(DEFAULT_DARWIN_NOTIFICATION_SOUND);
    });

    it("dispatches linux audio chime via paplay", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 202, unref: () => {} };
      };
      const result = playCompletionChime(undefined, { platform: "linux", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("paplay");
      expect(invocations.length).toBe(1);
      expect(invocations[0]?.cmd).toBe("paplay");
      expect(invocations[0]?.args[0]).toBe(DEFAULT_LINUX_NOTIFICATION_SOUND);
    });

    it("dispatches win32 audio chime via powershell Asterisk", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 203, unref: () => {} };
      };
      const result = playCompletionChime(undefined, { platform: "win32", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("powershell");
      expect(invocations.length).toBe(1);
      expect(invocations[0]?.cmd).toBe("powershell");
    });

    it("suppresses errors when audio spawner fails", () => {
      const failingSpawn: NotificationProcessSpawner = () => {
        throw new Error("afplay failed intentionally");
      };
      const result = playCompletionChime(undefined, {
        platform: "darwin",
        customSpawn: failingSpawn,
      });
      expect(result.delivered).toBe(false);
      expect(result.command).toBeDefined();
    });
  });

  describe("End-to-End Notification Dispatcher", () => {
    it("dispatches combined visual and audio notifications", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 301, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Combined Notification",
        message: "End-to-end verified",
        soundEnabled: true,
      };
      const result = sendSystemNotification(payload, { platform: "darwin", customSpawn });
      expect(result.success).toBe(true);
      expect(result.visualDelivered).toBe(true);
      expect(result.audioDelivered).toBe(true);
      expect(invocations.length).toBe(2);
    });

    it("executes notifyPhaseCompletion with custom parameters", () => {
      const invocations: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        invocations.push({ cmd, args });
        return { pid: 302, unref: () => {} };
      };
      const result: NotificationResult = notifyPhaseCompletion({
        phaseName: "Release Verification",
        taskCount: 3,
        durationMs: 30000,
        commitSha: "12345678",
        platform: "darwin",
        customSpawn,
      });
      expect(result.success).toBe(true);
      expect(result.visualDelivered).toBe(true);
      expect(result.audioDelivered).toBe(true);
      expect(result.payload.title).toBe("OLT Release Deployed");
      expect(invocations.length).toBe(2);
    });

    it("evaluates default notification spawner in test environment", () => {
      expect(isTestEnvironment()).toBe(true);
      const res = defaultNotificationSpawner("dummy-command", ["arg1"]);
      expect(res?.pid).toBe(99999);
      if (res && typeof res.unref === "function") {
        res.unref();
      }
    });
  });
});
