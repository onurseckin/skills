import { describe, expect, it } from "bun:test";
import {
  DarwinNotificationDispatcher,
  HeadlessNotificationDispatcher,
  LinuxNotificationDispatcher,
  NotificationDispatcherRegistry,
  WindowsNotificationDispatcher,
  type NotificationPayload,
  type NotificationProcessSpawner,
} from "../../../olt/scripts/src/reporting/notifications/index.ts";

export const platformDispatchersSuiteName = "Platform Notification Dispatchers";

describe(platformDispatchersSuiteName, () => {
  const samplePayload: NotificationPayload = {
    title: "Deployment Finished",
    subtitle: "Wave 4",
    message: "All 10 tasks verified successfully",
    soundEnabled: true,
  };

  describe("DarwinNotificationDispatcher", () => {
    it("dispatches notifications via osascript and builds correct command line", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 401, unref: () => {} };
      };
      const dispatcher = new DarwinNotificationDispatcher();
      const result = dispatcher.display(samplePayload, { customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("osascript -e");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("osascript");
      expect(calls[0]?.args[1]).toContain(
        'display notification "All 10 tasks verified successfully"',
      );
    });

    it("chimes via afplay", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 401, unref: () => {} };
      };
      const dispatcher = new DarwinNotificationDispatcher();
      const result = dispatcher.chime(undefined, { customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("afplay");
    });
  });

  describe("LinuxNotificationDispatcher", () => {
    it("dispatches notifications via notify-send and handles custom options", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 402, unref: () => {} };
      };
      const dispatcher = new LinuxNotificationDispatcher();
      const result = dispatcher.display(samplePayload, { customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("notify-send");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("notify-send");
    });

    it("chimes via paplay", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 402, unref: () => {} };
      };
      const dispatcher = new LinuxNotificationDispatcher();
      const result = dispatcher.chime("/custom/bell.wav", { customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("paplay");
    });
  });

  describe("WindowsNotificationDispatcher", () => {
    it("dispatches notifications via PowerShell", () => {
      const calls: { cmd: string; args: readonly string[] }[] = [];
      const customSpawn: NotificationProcessSpawner = (cmd, args) => {
        calls.push({ cmd, args });
        return { pid: 403, unref: () => {} };
      };
      const dispatcher = new WindowsNotificationDispatcher();
      const result = dispatcher.display(samplePayload, { customSpawn });
      expect(result.delivered).toBe(true);
      expect(result.command).toContain("powershell");
      expect(calls.length).toBe(1);
      expect(calls[0]?.cmd).toBe("powershell");
    });
  });

  describe("HeadlessNotificationDispatcher", () => {
    it("logs message to stdout/stderr in headless or test environments without spawning process", () => {
      const dispatcher = new HeadlessNotificationDispatcher();
      const result = dispatcher.display(samplePayload);
      expect(result.delivered).toBe(true);
      expect(result.command).toBe("headless-log");
    });
  });

  describe("NotificationDispatcherRegistry", () => {
    it("resolves correct dispatcher for each platform", () => {
      const registry = new NotificationDispatcherRegistry();
      expect(registry.getDispatcher("darwin")).toBeInstanceOf(DarwinNotificationDispatcher);
      expect(registry.getDispatcher("linux")).toBeInstanceOf(LinuxNotificationDispatcher);
      expect(registry.getDispatcher("win32")).toBeInstanceOf(WindowsNotificationDispatcher);
      expect(registry.getDispatcher("unknown_platform" as never)).toBeInstanceOf(
        HeadlessNotificationDispatcher,
      );
    });

    it("allows registering custom dispatcher override", () => {
      const registry = new NotificationDispatcherRegistry();
      const custom = new HeadlessNotificationDispatcher("darwin");
      registry.registerDispatcher(custom);
      expect(registry.getDispatcher("darwin")).toBe(custom);
    });
  });
});
