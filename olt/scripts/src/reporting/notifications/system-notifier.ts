import { spawn } from "node:child_process";
import {
  buildPhaseNotificationPayload,
  escapeAppleScriptString,
  escapePowerShellString,
} from "./formatters.ts";
import {
  DEFAULT_DARWIN_NOTIFICATION_SOUND,
  DEFAULT_LINUX_NOTIFICATION_SOUND,
  type NotificationPayload,
  type NotificationPlatform,
  type NotificationProcessSpawner,
  type NotificationProcessSpawnResult,
  type NotificationResult,
  type PhaseCompletionNotificationOptions,
} from "./types.ts";

/**
 * Default non-blocking child process spawner using detached and unref.
 */
export function defaultNotificationSpawner(
  command: string,
  args: readonly string[],
  options?: {
    detached?: boolean | undefined;
    stdio?: "ignore" | "pipe" | "inherit" | undefined;
    shell?: boolean | undefined;
  },
): NotificationProcessSpawnResult | void {
  try {
    const isDetached = options?.detached !== false;
    const stdioMode = options?.stdio !== undefined ? options.stdio : "ignore";
    const useShell = options?.shell === true;
    const child = spawn(command, [...args], {
      detached: isDetached,
      stdio: stdioMode,
      shell: useShell,
    });

    if ("unref" in child && typeof child.unref === "function") {
      child.unref();
    }

    return {
      pid: child.pid,
      unref: () => {
        if ("unref" in child && typeof child.unref === "function") {
          child.unref();
        }
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * Dispatches a native OS visual desktop notification.
 */
export function displaySystemNotification(
  payload: NotificationPayload,
  options?: {
    platform?: NotificationPlatform | undefined;
    customSpawn?: NotificationProcessSpawner | undefined;
  },
): { delivered: boolean; command?: string | undefined } {
  const platform = options?.platform !== undefined ? options.platform : process.platform;
  const spawner =
    options?.customSpawn !== undefined ? options.customSpawn : defaultNotificationSpawner;

  switch (platform) {
    case "darwin": {
      const scriptParts = [
        `display notification "${escapeAppleScriptString(payload.message)}"`,
        `with title "${escapeAppleScriptString(payload.title)}"`,
      ];
      if (payload.subtitle) {
        scriptParts.push(`subtitle "${escapeAppleScriptString(payload.subtitle)}"`);
      }
      const appleScript = scriptParts.join(" ");
      const cmd = `osascript -e '${appleScript}'`;

      try {
        spawner("osascript", ["-e", appleScript], { detached: true, stdio: "ignore" });
        return { delivered: true, command: cmd };
      } catch {
        return { delivered: false, command: cmd };
      }
    }

    case "linux": {
      const messageBody = payload.subtitle
        ? `${payload.subtitle}\n${payload.message}`
        : payload.message;
      const cmd = `notify-send "${payload.title}" "${messageBody}"`;

      try {
        spawner("notify-send", [payload.title, messageBody], { detached: true, stdio: "ignore" });
        return { delivered: true, command: cmd };
      } catch {
        return { delivered: false, command: cmd };
      }
    }

    case "win32": {
      const psCommand = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null; $notify = New-Object System.Windows.Forms.NotifyIcon; $notify.Icon = [System.Drawing.SystemIcons]::Information; $notify.Visible = $true; $notify.ShowBalloonTip(5000, '${escapePowerShellString(payload.title)}', '${escapePowerShellString(payload.message)}', [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Milliseconds 100; $notify.Dispose()`;
      const cmd = `powershell -NoProfile -NonInteractive -Command "${psCommand}"`;

      try {
        spawner("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
          detached: true,
          stdio: "ignore",
        });
        return { delivered: true, command: cmd };
      } catch {
        return { delivered: false, command: cmd };
      }
    }

    default:
      return { delivered: false };
  }
}

/**
 * Plays a native OS completion audio chime (e.g. Glass.aiff on macOS).
 */
export function playCompletionChime(
  soundFile?: string | undefined,
  options?: {
    platform?: NotificationPlatform | undefined;
    customSpawn?: NotificationProcessSpawner | undefined;
  },
): { delivered: boolean; command?: string | undefined } {
  const platform = options?.platform !== undefined ? options.platform : process.platform;
  const spawner =
    options?.customSpawn !== undefined ? options.customSpawn : defaultNotificationSpawner;

  switch (platform) {
    case "darwin": {
      const resolvedSound = soundFile !== undefined ? soundFile : DEFAULT_DARWIN_NOTIFICATION_SOUND;
      const cmd = `afplay "${resolvedSound}"`;

      try {
        spawner("afplay", [resolvedSound], { detached: true, stdio: "ignore" });
        return { delivered: true, command: cmd };
      } catch {
        return { delivered: false, command: cmd };
      }
    }

    case "linux": {
      const resolvedSound = soundFile !== undefined ? soundFile : DEFAULT_LINUX_NOTIFICATION_SOUND;
      const cmd = `paplay "${resolvedSound}"`;

      try {
        spawner("paplay", [resolvedSound], { detached: true, stdio: "ignore" });
        return { delivered: true, command: cmd };
      } catch {
        return { delivered: false, command: cmd };
      }
    }

    case "win32": {
      const psCommand = "[System.Media.SystemSounds]::Asterisk.Play()";
      const cmd = `powershell -NoProfile -NonInteractive -Command "${psCommand}"`;

      try {
        spawner("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
          detached: true,
          stdio: "ignore",
        });
        return { delivered: true, command: cmd };
      } catch {
        return { delivered: false, command: cmd };
      }
    }

    default:
      return { delivered: false };
  }
}

/**
 * Dispatches both visual and auditory native OS push notifications in a non-blocking manner.
 */
export function sendSystemNotification(
  payload: NotificationPayload,
  options?: {
    platform?: NotificationPlatform | undefined;
    customSpawn?: NotificationProcessSpawner | undefined;
    silent?: boolean | undefined;
  },
): NotificationResult {
  const platform = options?.platform !== undefined ? options.platform : process.platform;

  let visualResult: { delivered: boolean; command?: string | undefined } = { delivered: false };
  let audioResult: { delivered: boolean; command?: string | undefined } = { delivered: false };
  let errorMsg: string | undefined;

  try {
    visualResult = displaySystemNotification(payload, {
      platform,
      customSpawn: options?.customSpawn,
    });
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  if (payload.soundEnabled && !options?.silent) {
    try {
      audioResult = playCompletionChime(payload.soundFile, {
        platform,
        customSpawn: options?.customSpawn,
      });
    } catch (err) {
      const audioErr = err instanceof Error ? err.message : String(err);
      errorMsg = errorMsg ? `${errorMsg}; ${audioErr}` : audioErr;
    }
  }

  const success = visualResult.delivered || audioResult.delivered || platform === "unknown";

  return {
    success,
    visualDelivered: visualResult.delivered,
    audioDelivered: audioResult.delivered,
    platform,
    payload,
    visualCommand: visualResult.command,
    audioCommand: audioResult.command,
    error: errorMsg,
  };
}

/**
 * High-level helper to trigger a phase completion notification.
 */
export function notifyPhaseCompletion(
  options: PhaseCompletionNotificationOptions,
): NotificationResult {
  const payload = buildPhaseNotificationPayload(options);
  return sendSystemNotification(payload, {
    platform: options.platform,
    customSpawn: options.customSpawn,
    silent: options.silent,
  });
}
