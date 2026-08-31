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

describe("reporting/notifications module", () => {
  describe("constants and environment", () => {
    it("exports default sound paths for Darwin and Linux", () => {
      expect(DEFAULT_DARWIN_NOTIFICATION_SOUND).toBe("/System/Library/Sounds/Glass.aiff");
      expect(DEFAULT_LINUX_NOTIFICATION_SOUND).toBe(
        "/usr/share/sounds/freedesktop/stereo/complete.oga",
      );
    });

    it("detects test environment and spawns mock process", () => {
      expect(isTestEnvironment()).toBe(true);
      const res = defaultNotificationSpawner("true", []);
      expect(res?.pid).toBe(99999);
      if (res && typeof res.unref === "function") {
        res.unref();
      }
    });
  });

  describe("formatters and escaping", () => {
    it("formats duration boundaries accurately", () => {
      expect(formatElapsedDuration(-500)).toBe("0s");
      expect(formatElapsedDuration(0)).toBe("0s");
      expect(formatElapsedDuration(Number.NaN)).toBe("0s");
      expect(formatElapsedDuration(Number.POSITIVE_INFINITY)).toBe("0s");
      expect(formatElapsedDuration(150)).toBe("<1s");
      expect(formatElapsedDuration(1000)).toBe("1s");
      expect(formatElapsedDuration(45000)).toBe("45s");
      expect(formatElapsedDuration(125000)).toBe("2m 5s");
      expect(formatElapsedDuration(3665000)).toBe("1h 1m 5s");
    });

    it("escapes AppleScript and PowerShell strings safely", () => {
      expect(escapeAppleScriptString('Hello "World" \\ Path')).toBe('Hello \\"World\\" \\\\ Path');
      expect(escapeAppleScriptString("Simple string")).toBe("Simple string");
      expect(escapePowerShellString("It's a `test`")).toBe("It''s a ``test``");
      expect(escapePowerShellString("Normal-String")).toBe("Normal-String");
    });

    it("builds comprehensive and fallback payloads", () => {
      const opts: PhaseCompletionNotificationOptions = {
        phaseName: "Telemetry Phase",
        commitSha: "1a2b3c4d5e",
        taskCount: 12,
        durationMs: 92000,
        soundEnabled: true,
        soundFile: "/custom/sound.wav",
        title: "Custom Title",
        subtitle: "Custom Subtitle",
        details: "all metrics verified",
      };
      const full = buildPhaseNotificationPayload(opts);
      expect(full.title).toBe("Custom Title");
      expect(full.subtitle).toBe("Custom Subtitle");
      expect(full.soundEnabled).toBe(true);
      expect(full.soundFile).toBe("/custom/sound.wav");
      expect(full.message).toContain(
        "✓ Pushed 1a2b3c4d | 1m 32s (12 tasks) - all metrics verified",
      );

      const fallback = buildPhaseNotificationPayload({ phaseName: "   " });
      expect(fallback.title).toBe("OLT Release Deployed");
      expect(fallback.subtitle).toBe("Phase: OLT Release");
      expect(fallback.message).toBe('Phase "OLT Release" completed successfully.');
      expect(fallback.soundEnabled).toBe(true);
    });
  });

  describe("displaySystemNotification", () => {
    it("dispatches darwin notification via osascript", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 101, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Darwin Notification",
        subtitle: "Deploy",
        message: 'Station "Alpha" ready',
        soundEnabled: false,
      };
      const result = displaySystemNotification(payload, { platform: "darwin", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("osascript -e");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("osascript");
      expect(calls[0]?.args[1]).toContain('display notification "Station \\"Alpha\\" ready"');
    });

    it("dispatches linux notification via notify-send", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 102, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Linux Notification",
        subtitle: "Runner",
        message: "Pipeline completed",
        soundEnabled: true,
      };
      const result = displaySystemNotification(payload, { platform: "linux", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("notify-send");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("notify-send");
      expect(calls[0]?.args[0]).toBe("Linux Notification");
      expect(calls[0]?.args[1]).toBe("Runner\nPipeline completed");
    });

    it("dispatches win32 notification via powershell", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 103, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Win32 Notification",
        message: "Windows test passed",
        soundEnabled: true,
      };
      const result = displaySystemNotification(payload, { platform: "win32", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("powershell");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("powershell");
      expect(calls[0]?.args).toContain("-NoProfile");
    });

    it("handles unsupported platform and spawner errors gracefully", () => {
      const payload: NotificationPayload = { title: "Test", message: "OS", soundEnabled: false };
      const unsupported = displaySystemNotification(payload, { platform: "unknown-os" });
      expect(unsupported.delivered).toBe(false);
      expect(unsupported.command).toBeUndefined();

      const throwingSpawn: NotificationProcessSpawner = () => {
        throw new Error("spawn failed");
      };
      const failed = displaySystemNotification(payload, {
        platform: "darwin",
        customSpawn: throwingSpawn,
      });
      expect(failed.delivered).toBe(false);
      expect(failed.command).toBeDefined();
    });
  });

  describe("playCompletionChime", () => {
    it("plays darwin audio chime via afplay", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 201, unref: () => {} };
      };
      const result = playCompletionChime(undefined, { platform: "darwin", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("afplay");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("afplay");
      expect(calls[0]?.args[0]).toBe(DEFAULT_DARWIN_NOTIFICATION_SOUND);
    });

    it("plays linux audio chime via paplay", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 202, unref: () => {} };
      };
      const result = playCompletionChime("/custom/bell.oga", { platform: "linux", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("paplay");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("paplay");
      expect(calls[0]?.args[0]).toBe("/custom/bell.oga");
    });

    it("plays win32 audio chime via powershell Asterisk", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 203, unref: () => {} };
      };
      const result = playCompletionChime(undefined, { platform: "win32", customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("powershell");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("powershell");
    });

    it("handles unsupported audio platform and spawner errors gracefully", () => {
      const unsupported = playCompletionChime(undefined, { platform: "sunos" });
      expect(unsupported.delivered).toBe(false);
      expect(unsupported.command).toBeUndefined();

      const throwingSpawn: NotificationProcessSpawner = () => {
        throw new Error("afplay failed");
      };
      const failed = playCompletionChime(undefined, {
        platform: "darwin",
        customSpawn: throwingSpawn,
      });
      expect(failed.delivered).toBe(false);
      expect(failed.command).toBeDefined();
    });
  });

  describe("sendSystemNotification & notifyPhaseCompletion", () => {
    it("sends both visual and audio notifications", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 301, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Combined Test",
        message: "Full delivery",
        soundEnabled: true,
      };
      const result = sendSystemNotification(payload, { platform: "darwin", customSpawn });
      expect(result.success).toBe(true);
      expect(result.visualDelivered).toBe(true);
      expect(result.audioDelivered).toBe(true);
      expect(result.platform).toBe("darwin");
      expect(calls.length).toBe(2);
    });

    it("skips audio when silent is true", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 302, unref: () => {} };
      };
      const payload: NotificationPayload = {
        title: "Silent Test",
        message: "No chime",
        soundEnabled: true,
      };
      const result = sendSystemNotification(payload, {
        platform: "darwin",
        customSpawn,
        silent: true,
      });
      expect(result.visualDelivered).toBe(true);
      expect(result.audioDelivered).toBe(false);
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("osascript");
    });

    it("executes notifyPhaseCompletion end-to-end", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 303, unref: () => {} };
      };
      const result: NotificationResult = notifyPhaseCompletion({
        phaseName: "Release Verification",
        taskCount: 5,
        durationMs: 45000,
        commitSha: "abcdef12",
        platform: "darwin",
        customSpawn,
      });
      expect(result.success).toBe(true);
      expect(result.visualDelivered).toBe(true);
      expect(result.audioDelivered).toBe(true);
      expect(result.payload.title).toBe("OLT Release Deployed");
      expect(calls.length).toBe(2);
    });
  });
});
