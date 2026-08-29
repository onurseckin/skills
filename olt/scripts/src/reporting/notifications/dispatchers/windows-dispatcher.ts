import { escapePowerShellString } from "../formatters.ts";
import { defaultNotificationSpawner } from "../system-notifier.ts";
import type { NotificationPayload } from "../types.ts";
import type {
  INotificationDispatcher,
  PlatformNotificationDeliveryResult,
  PlatformNotificationOptions,
} from "./types.ts";

export class WindowsNotificationDispatcher implements INotificationDispatcher {
  readonly platform = "win32" as const;

  display(
    payload: NotificationPayload,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult {
    const spawner = options?.customSpawn ?? defaultNotificationSpawner;
    const timeoutMs = options?.timeoutMs ?? 5000;
    const iconType =
      options?.priority === "critical" ? "Error" : options?.priority === "low" ? "None" : "Info";

    const titleEsc = escapePowerShellString(payload.title);
    const msgEsc = escapePowerShellString(
      payload.subtitle ? `${payload.subtitle}\n${payload.message}` : payload.message,
    );

    const psCommand = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null; $notify = New-Object System.Windows.Forms.NotifyIcon; $notify.Icon = [System.Drawing.SystemIcons]::Information; $notify.Visible = $true; $notify.ShowBalloonTip(${timeoutMs}, '${titleEsc}', '${msgEsc}', [System.Windows.Forms.ToolTipIcon]::${iconType}); Start-Sleep -Milliseconds 100; $notify.Dispose()`;
    const cmd = `powershell -NoProfile -NonInteractive -Command "${psCommand}"`;

    try {
      spawner("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
        detached: true,
        stdio: "ignore",
      });
      return { delivered: true, command: cmd };
    } catch (err) {
      return {
        delivered: false,
        command: cmd,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  chime(
    _soundFile?: string | undefined,
    options?: PlatformNotificationOptions,
  ): PlatformNotificationDeliveryResult {
    const spawner = options?.customSpawn ?? defaultNotificationSpawner;
    const psCommand = "[System.Media.SystemSounds]::Asterisk.Play()";
    const cmd = `powershell -NoProfile -NonInteractive -Command "${psCommand}"`;

    try {
      spawner("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
        detached: true,
        stdio: "ignore",
      });
      return { delivered: true, command: cmd };
    } catch (err) {
      return {
        delivered: false,
        command: cmd,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
