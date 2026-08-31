import { describe, expect, it } from "bun:test";
import {
  DarwinNotificationDispatcher,
  HeadlessNotificationDispatcher,
  LinuxNotificationDispatcher,
  NotificationDispatcherRegistry,
  WindowsNotificationDispatcher,
  type NotificationPayload,
  type NotificationProcessSpawner,
} from "../../olt/scripts/src/reporting/notifications/index.ts";

describe("Platform Notification Dispatchers", () => {
  const samplePayload: NotificationPayload = {
    title: "Deployment Finished",
    subtitle: "Wave 4",
    message: "All 10 tasks verified successfully",
    soundEnabled: true,
  };

  describe("DarwinNotificationDispatcher", () => {
    it("dispatches Darwin notifications and chimes via custom spawner", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 1234, unref: () => {} };
      };

      const dispatcher = new DarwinNotificationDispatcher();
      expect(dispatcher.platform).toBe("darwin");

      const res = dispatcher.display(samplePayload, { customSpawn });
      expect(res.delivered).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toBe("osascript");
      expect(calls[0]?.args[1]).toContain("display notification");

      const chimeRes = dispatcher.chime(undefined, { customSpawn });
      expect(chimeRes.delivered).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.cmd).toBe("afplay");
    });
  });

  describe("LinuxNotificationDispatcher", () => {
    it("dispatches Linux notifications with priority and icons", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 2345, unref: () => {} };
      };

      const dispatcher = new LinuxNotificationDispatcher();
      expect(dispatcher.platform).toBe("linux");

      const res = dispatcher.display(samplePayload, {
        customSpawn,
        priority: "critical",
        iconPath: "/usr/share/icons/custom.png",
      });

      expect(res.delivered).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toBe("notify-send");
      expect(calls[0]?.args).toContain("-u");
      expect(calls[0]?.args).toContain("critical");
      expect(calls[0]?.args).toContain("-i");

      const chimeRes = dispatcher.chime("/custom/alert.oga", { customSpawn });
      expect(chimeRes.delivered).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.cmd).toBe("paplay");
      expect(calls[1]?.args[0]).toBe("/custom/alert.oga");
    });
  });

  describe("WindowsNotificationDispatcher", () => {
    it("dispatches Windows notifications via PowerShell balloon script", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 3456, unref: () => {} };
      };

      const dispatcher = new WindowsNotificationDispatcher();
      expect(dispatcher.platform).toBe("win32");

      const res = dispatcher.display(samplePayload, { customSpawn, priority: "critical" });
      expect(res.delivered).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toBe("powershell");
      expect(calls[0]?.args).toContain("-NoProfile");

      const chimeRes = dispatcher.chime(undefined, { customSpawn });
      expect(chimeRes.delivered).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[1]?.cmd).toBe("powershell");
      expect(calls[1]?.args.join(" ")).toContain("Asterisk.Play");
    });
  });

  describe("HeadlessNotificationDispatcher", () => {
    it("records logs and chimes in memory for headless environments", () => {
      const dispatcher = new HeadlessNotificationDispatcher("custom-ci");
      expect(dispatcher.platform).toBe("custom-ci");

      const res = dispatcher.display(samplePayload, { priority: "low" });
      expect(res.delivered).toBe(true);
      expect(res.command).toBe("headless-log");
      expect(dispatcher.logs).toHaveLength(1);
      expect(dispatcher.logs[0]).toContain("[NOTIFICATION low]");

      dispatcher.chime("test-sound.wav");
      expect(dispatcher.logs).toHaveLength(2);
      expect(dispatcher.logs[1]).toContain("[CHIME]: test-sound.wav");

      dispatcher.clearLogs();
      expect(dispatcher.logs).toHaveLength(0);
    });
  });

  describe("NotificationDispatcherRegistry", () => {
    it("retrieves appropriate platform dispatchers and falls back gracefully", () => {
      const registry = new NotificationDispatcherRegistry({ defaultPlatform: "darwin" });

      const darwinDisp = registry.getDispatcher("darwin");
      expect(darwinDisp.platform).toBe("darwin");

      const linuxDisp = registry.getDispatcher("linux");
      expect(linuxDisp.platform).toBe("linux");

      const fallbackDisp = registry.getDispatcher("unknown-os");
      expect(fallbackDisp.platform).toBe("unknown-os");
    });

    it("enforces rate limiting when max notifications per window is reached", () => {
      const registry = new NotificationDispatcherRegistry({
        defaultPlatform: "unknown",
        rateLimiter: {
          maxNotificationsPerWindow: 2,
          windowMs: 5000,
        },
      });

      const res1 = registry.dispatch(samplePayload);
      expect(res1.delivered).toBe(true);

      const res2 = registry.dispatch(samplePayload);
      expect(res2.delivered).toBe(true);

      const res3 = registry.dispatch(samplePayload);
      expect(res3.delivered).toBe(false);
      expect(res3.error).toContain("rate limit exceeded");

      expect(registry.getHistory()).toHaveLength(2);
    });
  });
});
