import { describe, expect, it } from "bun:test";
import {
  buildPhaseNotificationPayload,
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  defaultNotificationSpawner,
  displaySystemNotification,
  escapeAppleScriptString,
  escapePowerShellString,
  formatElapsedDuration,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
  type NotificationPayload,
  type NotificationProcessSpawner,
  type PhaseCompletionNotificationOptions,
} from "../../../../olt/scripts/src/reporting/notifications/index.ts";
import {
  claimStation,
  createStation,
  landPhaseRelease,
  landStation,
  verifyStation,
} from "../../../../olt/scripts/src/orchestrator/station-landing.ts";

describe("Native OS Push Notification & Audio Chime Engine", () => {
  describe("Duration & String Formatters", () => {
    it("formats millisecond durations into human-readable intervals", () => {
      expect(formatElapsedDuration(0)).toBe("0s");
      expect(formatElapsedDuration(-100)).toBe("0s");
      expect(formatElapsedDuration(Number.NaN)).toBe("0s");
      expect(formatElapsedDuration(Number.POSITIVE_INFINITY)).toBe("0s");
      expect(formatElapsedDuration(450)).toBe("<1s");
      expect(formatElapsedDuration(1000)).toBe("1s");
      expect(formatElapsedDuration(14000)).toBe("14s");
      expect(formatElapsedDuration(272000)).toBe("4m 32s");
      expect(formatElapsedDuration(3600000)).toBe("1h 0m 0s");
      expect(formatElapsedDuration(3724000)).toBe("1h 2m 4s");
    });

    it("escapes AppleScript special characters correctly", () => {
      const input = 'Phase "Core" with \\ backslash and "quotes"';
      const escaped = escapeAppleScriptString(input);
      expect(escaped).toBe('Phase \\"Core\\" with \\\\ backslash and \\"quotes\\"');
    });

    it("escapes PowerShell special characters correctly", () => {
      const input = "User's `test` variable";
      const escaped = escapePowerShellString(input);
      expect(escaped).toBe("User''s ``test`` variable");
    });

    it("builds comprehensive notification payload with all metadata", () => {
      const opts: PhaseCompletionNotificationOptions = {
        phaseName: "Tooling & Telemetry",
        commitSha: "89a5042e12345678",
        taskCount: 7,
        durationMs: 145000,
        details: "all tests passing",
      };

      const payload = buildPhaseNotificationPayload(opts);
      expect(payload.title).toBe("OLT Release Complete");
      expect(payload.subtitle).toBe("Tooling & Telemetry");
      expect(payload.soundEnabled).toBe(true);
      expect(payload.message).toContain('Phase "Tooling & Telemetry" landed');
      expect(payload.message).toContain("Duration: 2m 25s");
      expect(payload.message).toContain("7 tasks");
      expect(payload.message).toContain("commit 89a5042e");
      expect(payload.message).toContain("all tests passing");
    });

    it("builds minimal notification payload when optional fields are omitted", () => {
      const opts: PhaseCompletionNotificationOptions = {
        phaseName: "Core Architecture",
      };

      const payload = buildPhaseNotificationPayload(opts);
      expect(payload.title).toBe("OLT Release Complete");
      expect(payload.subtitle).toBe("Core Architecture");
      expect(payload.message).toBe('Phase "Core Architecture" landed successfully.');
      expect(payload.soundEnabled).toBe(true);
    });
  });

  describe("Platform Dispatcher", () => {
    it("dispatches macOS visual notifications via osascript with non-blocking arguments", () => {
      const spawned: { cmd: string; args: readonly string[]; opts?: unknown }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args, opts) => {
        spawned.push({ cmd, args, opts });
        return { unref: () => {} };
      };

      const payload: NotificationPayload = {
        title: "OLT Release",
        subtitle: "Phase 1",
        message: 'Deployed "Core Engine"',
        soundEnabled: false,
      };

      const result = displaySystemNotification(payload, {
        platform: "darwin",
        customSpawn,
      });

      expect(result.delivered).toBe(true);
      expect(spawned.length).toBe(1);
      expect(spawned[0]?.cmd).toBe("osascript");
      expect(spawned[0]?.args[0]).toBe("-e");
      expect(spawned[0]?.args[1]).toContain('display notification "Deployed \\"Core Engine\\""');
      expect(spawned[0]?.args[1]).toContain('with title "OLT Release"');
      expect(spawned[0]?.args[1]).toContain('subtitle "Phase 1"');
    });

    it("dispatches macOS audio chime via afplay pointing to Glass.aiff", () => {
      const spawned: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        spawned.push({ cmd, args });
        return { unref: () => {} };
      };

      const result = playCompletionChime(undefined, {
        platform: "darwin",
        customSpawn,
      });

      expect(result.delivered).toBe(true);
      expect(spawned.length).toBe(1);
      expect(spawned[0]?.cmd).toBe("afplay");
      expect(spawned[0]?.args[0]).toBe(DEFAULT_DARWIN_NOTIFICATION_SOUND);
    });

    it("dispatches Linux notifications and sound via notify-send and paplay", () => {
      const spawned: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        spawned.push({ cmd, args });
        return { unref: () => {} };
      };

      const payload: NotificationPayload = {
        title: "Linux Release",
        subtitle: "Subdomain",
        message: "Linux station verified",
        soundEnabled: true,
      };

      const visual = displaySystemNotification(payload, {
        platform: "linux",
        customSpawn,
      });
      expect(visual.delivered).toBe(true);
      expect(spawned[0]?.cmd).toBe("notify-send");
      expect(spawned[0]?.args[0]).toBe("Linux Release");

      const audio = playCompletionChime(undefined, {
        platform: "linux",
        customSpawn,
      });
      expect(audio.delivered).toBe(true);
      expect(spawned[1]?.cmd).toBe("paplay");
      expect(spawned[1]?.args[0]).toBe(DEFAULT_LINUX_NOTIFICATION_SOUND);
    });

    it("dispatches Windows toast notifications and Asterisk chime via powershell", () => {
      const spawned: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        spawned.push({ cmd, args });
        return { unref: () => {} };
      };

      const payload: NotificationPayload = {
        title: "Windows Release",
        message: "Windows station verified",
        soundEnabled: true,
      };

      const visual = displaySystemNotification(payload, {
        platform: "win32",
        customSpawn,
      });
      expect(visual.delivered).toBe(true);
      expect(spawned[0]?.cmd).toBe("powershell");
      expect(spawned[0]?.args).toContain("-NoProfile");

      const audio = playCompletionChime(undefined, {
        platform: "win32",
        customSpawn,
      });
      expect(audio.delivered).toBe(true);
      expect(spawned[1]?.cmd).toBe("powershell");
      expect(spawned[1]?.args.join(" ")).toContain("Asterisk.Play()");
    });

    it("handles unsupported platforms gracefully without throwing", () => {
      const result = sendSystemNotification(
        {
          title: "CI Run",
          message: "Headless test",
          soundEnabled: true,
        },
        { platform: "unknown" },
      );

      expect(result.visualDelivered).toBe(false);
      expect(result.audioDelivered).toBe(false);
      expect(result.platform).toBe("unknown");
    });

    it("respects silent and soundEnabled flags", () => {
      const spawned: { cmd: string }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd) => {
        spawned.push({ cmd });
        return { unref: () => {} };
      };

      const result = sendSystemNotification(
        {
          title: "Silent Test",
          message: "No sound should play",
          soundEnabled: false,
        },
        {
          platform: "darwin",
          customSpawn,
          silent: true,
        },
      );

      expect(result.visualDelivered).toBe(true);
      expect(result.audioDelivered).toBe(false);
      expect(spawned.length).toBe(1);
      expect(spawned[0]?.cmd).toBe("osascript");
    });
  });

  describe("End-to-End notifyPhaseCompletion", () => {
    it("builds payload and dispatches non-blocking notifications", () => {
      const spawned: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        spawned.push({ cmd, args });
        return { unref: () => {} };
      };

      const result = notifyPhaseCompletion({
        phaseName: "Option 1 Landing",
        durationMs: 184000,
        taskCount: 8,
        commitSha: "abc1234567",
        platform: "darwin",
        customSpawn,
      });

      expect(result.success).toBe(true);
      expect(result.visualDelivered).toBe(true);
      expect(result.audioDelivered).toBe(true);
      expect(spawned.length).toBe(2);
      expect(spawned.some((s) => s.cmd === "osascript")).toBe(true);
      expect(spawned.some((s) => s.cmd === "afplay")).toBe(true);
    });

    it("defaultNotificationSpawner safely handles execution", () => {
      const res = defaultNotificationSpawner("true", []);
      // Should not throw and should return an object with unref or undefined
      if (res && res.unref) {
        expect(typeof res.unref).toBe("function");
      }
    });
  });

  describe("Station Landing Pipeline Hook", () => {
    it("triggers phase completion notification during landStation when notify is enabled", () => {
      let notifiedOptions: PhaseCompletionNotificationOptions | undefined;
      const customNotifier = (opts: PhaseCompletionNotificationOptions) => {
        notifiedOptions = opts;
        return {
          success: true,
          visualDelivered: true,
          audioDelivered: true,
          platform: "darwin",
          payload: {
            title: "OLT Release Complete",
            message: "Test",
            soundEnabled: true,
          },
        };
      };

      const station = createStation("station-notify-1", "reporting", "milestone-1", [
        "src/reporting/notifications/types.ts",
      ]);
      const claimed = claimStation(station);
      const verified = verifyStation(claimed, { testPath: "tests/f.ts", passed: true });

      const startTime = Date.now() - 5000;
      const { station: landed, notificationResult, durationMs } = landStation(verified, {
        notify: true,
        startedAt: startTime,
        phaseName: "Reporting Phase",
        customNotifier,
        customGitRunner: () => "mock-git-tree-sha",
      });

      expect(landed.status).toBe("LANDED");
      expect(notificationResult).toBeDefined();
      expect(notificationResult?.success).toBe(true);
      expect(durationMs).toBeGreaterThanOrEqual(4000);
      expect(notifiedOptions).toBeDefined();
      expect(notifiedOptions?.phaseName).toBe("Reporting Phase");
      expect(notifiedOptions?.durationMs).toBeGreaterThanOrEqual(4000);
    });

    it("triggers phase completion notification via landPhaseRelease", () => {
      let notifiedOptions: PhaseCompletionNotificationOptions | undefined;
      const customNotifier = (opts: PhaseCompletionNotificationOptions) => {
        notifiedOptions = opts;
        return {
          success: true,
          visualDelivered: true,
          audioDelivered: true,
          platform: "darwin",
          payload: {
            title: "OLT Release Complete",
            message: "Test",
            soundEnabled: true,
          },
        };
      };

      const startTime = Date.now() - 12000;
      const landing = landPhaseRelease({
        phaseName: "Architecture Landing",
        startedAt: startTime,
        commitSha: "987654321",
        taskCount: 5,
        customNotifier,
      });

      expect(landing.success).toBe(true);
      expect(landing.durationMs).toBeGreaterThanOrEqual(10000);
      expect(notifiedOptions?.phaseName).toBe("Architecture Landing");
      expect(notifiedOptions?.taskCount).toBe(5);
      expect(notifiedOptions?.commitSha).toBe("987654321");
    });
  });
});
