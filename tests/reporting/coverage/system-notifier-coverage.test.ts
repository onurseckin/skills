import { describe, expect, it } from "bun:test";
import {
  defaultNotificationSpawner,
  displaySystemNotification,
  isTestEnvironment,
  notifyPhaseCompletion,
  playCompletionChime,
  sendSystemNotification,
} from "../../../olt/scripts/src/reporting/notifications/system-notifier.ts";
import {
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  type NotificationPayload,
  type NotificationProcessSpawner,
} from "../../../olt/scripts/src/reporting/notifications/types.ts";

describe("system-notifier coverage", () => {
  it("detects running test environment and returns mock process", () => {
    expect(isTestEnvironment()).toBe(true);
    const res = defaultNotificationSpawner("osascript", ["-e", "display notification"]);
    expect(res?.pid).toBe(99999);
    expect(() => res?.unref()).not.toThrow();
  });

  describe("displaySystemNotification", () => {
    it("dispatches darwin notifications with and without subtitle", () => {
      const calls: Array<{ cmd: string; args: readonly string[] }> = [];
      const spawner: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { unref: () => {} };
      };

      const withSub: NotificationPayload = {
        title: "Build Succeeded",
        subtitle: "Submodule Core",
        message: "Artifacts published",
        soundEnabled: false,
      };
      const res1 = displaySystemNotification(withSub, { platform: "darwin", customSpawn: spawner });
      expect(res1.delivered).toBe(true);
      expect(calls[0]?.args[1]).toContain('subtitle "Submodule Core"');

      const withoutSub: NotificationPayload = {
        title: "Alert",
        message: "Plain msg",
        soundEnabled: false,
      };
      const res2 = displaySystemNotification(withoutSub, {
        platform: "darwin",
        customSpawn: spawner,
      });
      expect(res2.delivered).toBe(true);
      expect(calls[1]?.args[1]).not.toContain("subtitle");
    });

    it("handles linux, win32, and unknown platforms", () => {
      const calls: Array<{ cmd: string; args: readonly string[] }> = [];
      const spawner: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { unref: () => {} };
      };

      const payload: NotificationPayload = {
        title: "Linux Notification",
        subtitle: "Sub-info",
        message: "Details here",
        soundEnabled: false,
      };
      const l1 = displaySystemNotification(payload, { platform: "linux", customSpawn: spawner });
      expect(l1.delivered).toBe(true);
      expect(calls[0]?.args[1]).toBe("Sub-info\nDetails here");

      const l2 = displaySystemNotification(
        { title: "L", message: "M", soundEnabled: false },
        { platform: "linux", customSpawn: spawner },
      );
      expect(l2.delivered).toBe(true);

      const w = displaySystemNotification(payload, { platform: "win32", customSpawn: spawner });
      expect(w.delivered).toBe(true);

      const u = displaySystemNotification(payload, { platform: "unknown" });
      expect(u.delivered).toBe(false);
    });

    it("handles spawner exceptions gracefully across all platforms", () => {
      const failing: NotificationProcessSpawner = () => {
        throw new Error("Spawn failure");
      };
      const payload: NotificationPayload = { title: "T", message: "M", soundEnabled: false };
      expect(
        displaySystemNotification(payload, { platform: "darwin", customSpawn: failing }).delivered,
      ).toBe(false);
      expect(
        displaySystemNotification(payload, { platform: "linux", customSpawn: failing }).delivered,
      ).toBe(false);
      expect(
        displaySystemNotification(payload, { platform: "win32", customSpawn: failing }).delivered,
      ).toBe(false);
    });
  });

  describe("playCompletionChime", () => {
    it("plays sound on darwin, linux, and win32 with default and custom paths", () => {
      const calls: Array<{ cmd: string; args: readonly string[] }> = [];
      const spawner: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { unref: () => {} };
      };

      const d1 = playCompletionChime(undefined, { platform: "darwin", customSpawn: spawner });
      expect(d1.delivered).toBe(true);
      expect(calls[0]?.args[0]).toBe(DEFAULT_DARWIN_NOTIFICATION_SOUND);

      const d2 = playCompletionChime("/custom/sound.wav", {
        platform: "darwin",
        customSpawn: spawner,
      });
      expect(d2.delivered).toBe(true);
      expect(calls[1]?.args[0]).toBe("/custom/sound.wav");

      const l1 = playCompletionChime(undefined, { platform: "linux", customSpawn: spawner });
      expect(l1.delivered).toBe(true);
      expect(calls[2]?.args[0]).toBe(DEFAULT_LINUX_NOTIFICATION_SOUND);

      const l2 = playCompletionChime("/linux/sound.oga", {
        platform: "linux",
        customSpawn: spawner,
      });
      expect(l2.delivered).toBe(true);

      const w = playCompletionChime(undefined, { platform: "win32", customSpawn: spawner });
      expect(w.delivered).toBe(true);
    });

    it("handles unknown platform and chime exceptions gracefully", () => {
      const failing: NotificationProcessSpawner = () => {
        throw new Error("Audio error");
      };
      expect(
        playCompletionChime(undefined, { platform: "darwin", customSpawn: failing }).delivered,
      ).toBe(false);
      expect(
        playCompletionChime(undefined, { platform: "linux", customSpawn: failing }).delivered,
      ).toBe(false);
      expect(
        playCompletionChime(undefined, { platform: "win32", customSpawn: failing }).delivered,
      ).toBe(false);
      expect(playCompletionChime(undefined, { platform: "unknown" }).delivered).toBe(false);
    });
  });

  describe("sendSystemNotification and notifyPhaseCompletion", () => {
    it("handles sound toggle, silent flag, and unknown platform", () => {
      const calls: string[] = [];
      const spawner: NotificationProcessSpawner = (cmd) => {
        calls.push(cmd);
        return { unref: () => {} };
      };

      const withSound = sendSystemNotification(
        { title: "Done", message: "Task 1", soundEnabled: true },
        { platform: "darwin", customSpawn: spawner },
      );
      expect(withSound.success).toBe(true);
      expect(calls).toEqual(["osascript", "afplay"]);

      calls.length = 0;
      const silent = sendSystemNotification(
        { title: "Done", message: "Task 2", soundEnabled: true },
        { platform: "darwin", customSpawn: spawner, silent: true },
      );
      expect(silent.audioDelivered).toBe(false);
      expect(calls).toEqual(["osascript"]);

      const unknown = sendSystemNotification(
        { title: "T", message: "M", soundEnabled: false },
        { platform: "unknown" },
      );
      expect(unknown.success).toBe(true);
    });

    it("captures visual and audio errors correctly", () => {
      const failing: NotificationProcessSpawner = () => {
        throw new Error("Spawner fault");
      };
      const res = sendSystemNotification(
        { title: "Fail", message: "M", soundEnabled: true },
        { platform: "darwin", customSpawn: failing },
      );
      expect(res.success).toBe(false);

      const throwingPayload: NotificationPayload = {
        title: "Throw",
        message: {
          replace: () => {
            throw new Error("Visual throw error");
          },
        } as unknown as string,
        soundFile: {
          toString: () => {
            throw new Error("Audio throw error");
          },
        } as unknown as string,
        soundEnabled: true,
      };
      const resThrow = sendSystemNotification(throwingPayload, { platform: "darwin" });
      expect(resThrow.error).toContain("Visual throw error");
      expect(resThrow.error).toContain("Audio throw error");
    });

    it("runs notifyPhaseCompletion end-to-end", () => {
      const spawner: NotificationProcessSpawner = () => ({ unref: () => {} });
      const res = notifyPhaseCompletion({
        phaseName: "Core Architecture",
        durationMs: 45000,
        taskCount: 6,
        commitSha: "fe01ab2",
        platform: "darwin",
        customSpawn: spawner,
      });

      expect(res.success).toBe(true);
      expect(res.payload.title).toBe("OLT Release Deployed");
      expect(res.payload.subtitle).toBe("Phase: Core Architecture");
      expect(res.payload.message).toContain("6 tasks");
    });
  });
});
