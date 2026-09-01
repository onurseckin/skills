import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  buildPhaseNotificationPayload,
  escapeAppleScriptString,
  escapePowerShellString,
  formatElapsedDuration,
  triggerAudioChime,
  triggerPhaseNotification,
  triggerTestNotification,
  type NotificationProcessSpawner,
} from "../../../olt/scripts/src/tooling/notifications.ts";

describe("Tooling Notifications & Audio Dispatch Engine", () => {
  it("exports default audio constants and escape helpers", () => {
    expect(DEFAULT_DARWIN_NOTIFICATION_SOUND).toBe("/System/Library/Sounds/Glass.aiff");
    expect(DEFAULT_LINUX_NOTIFICATION_SOUND).toBe(
      "/usr/share/sounds/freedesktop/stereo/complete.oga",
    );
    expect(escapeAppleScriptString('Hello "World" \\')).toBe('Hello \\"World\\" \\\\');
    expect(escapePowerShellString("Hello 'World' `cmd`")).toBe("Hello ''World'' ``cmd``");
    expect(formatElapsedDuration(65000)).toBe("1m 5s");
    expect(formatElapsedDuration(4500)).toBe("4s");
  });

  it("builds phase completion notification payload accurately", () => {
    const payload = buildPhaseNotificationPayload({
      phaseName: "Synthesize Companion Manifest",
      durationMs: 12500,
      taskCount: 3,
      details: "All viewports certified",
    });

    expect(payload.title).toBe("OLT Release Deployed");
    expect(payload.subtitle).toBe("Phase: Synthesize Companion Manifest");
    expect(payload.message).toContain("12s (3 tasks) - All viewports certified");
  });

  it("dispatches phase completion notification with mock spawner", () => {
    const spawnedCommands: string[] = [];
    const mockSpawn: NotificationProcessSpawner = (command, args) => {
      spawnedCommands.push(`${command} ${args.join(" ")}`);
      return { pid: 1234, unref: () => {} };
    };

    const result = triggerPhaseNotification({
      phaseName: "Discovery Scan",
      durationMs: 300,
      customSpawn: mockSpawn,
      platform: "darwin",
    });

    expect(result.success).toBe(true);
    expect(result.visualDelivered).toBe(true);
    expect(spawnedCommands.some((c) => c.includes("osascript"))).toBe(true);
  });

  it("dispatches test notification with mock spawner across platforms", () => {
    const executedCommands: string[] = [];
    const mockSpawn: NotificationProcessSpawner = (command, args) => {
      executedCommands.push(`${command} ${args.join(" ")}`);
      return { pid: 1234, unref: () => {} };
    };

    const macResult = triggerTestNotification({
      platform: "darwin",
      customSpawn: mockSpawn,
      soundEnabled: true,
    });
    expect(macResult.success).toBe(true);
    expect(macResult.visualDelivered).toBe(true);

    const linuxResult = triggerTestNotification({
      platform: "linux",
      customSpawn: mockSpawn,
      soundEnabled: true,
    });
    expect(linuxResult.success).toBe(true);
    expect(linuxResult.visualDelivered).toBe(true);

    const winResult = triggerTestNotification({
      platform: "win32",
      customSpawn: mockSpawn,
      soundEnabled: true,
    });
    expect(winResult.success).toBe(true);
    expect(winResult.visualDelivered).toBe(true);
  });

  it("triggers audio chime with mock spawner across platforms", () => {
    const executedAudio: string[] = [];
    const mockSpawn: NotificationProcessSpawner = (command, args) => {
      executedAudio.push(`${command} ${args.join(" ")}`);
      return { pid: 1234, unref: () => {} };
    };

    const macChime = triggerAudioChime("Ping", {
      platform: "darwin",
      customSpawn: mockSpawn,
    });
    expect(macChime.delivered).toBe(true);

    const linuxChime = triggerAudioChime(undefined, {
      platform: "linux",
      customSpawn: mockSpawn,
    });
    expect(linuxChime.delivered).toBe(true);

    const winChime = triggerAudioChime(undefined, {
      platform: "win32",
      customSpawn: mockSpawn,
    });
    expect(winChime.delivered).toBe(true);
  });
});
