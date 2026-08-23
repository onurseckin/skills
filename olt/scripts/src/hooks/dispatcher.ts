import { spawnSync } from "node:child_process";
import { DEFAULT_DARWIN_SOUND_PATH, loadHookConfig } from "./config.ts";
import type { HookConfig, HookDefinition, HookResult, LifecycleEvent } from "./types.ts";

/**
 * Evaluates whether an event name matches a hook event pattern.
 * Supports exact match, universal wildcard (*), prefix wildcard (gate:*), and suffix wildcard (*:complete).
 */
export function matchesEvent(pattern: string, event: string): boolean {
  if (pattern === "*" || pattern === event) {
    return true;
  }
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2);
    return event === prefix || event.startsWith(`${prefix}:`);
  }
  if (pattern.startsWith("*:") && event.endsWith(pattern.slice(1))) {
    return true;
  }
  return false;
}

/**
 * Checks if the current operating platform is included in the hook's platform whitelist.
 */
export function isPlatformSupported(
  platforms?: readonly (NodeJS.Platform | string)[] | undefined,
  currentPlatform: string = process.platform,
): boolean {
  if (platforms === undefined || platforms.length === 0) {
    return true;
  }
  return platforms.includes(currentPlatform);
}

/**
 * Resolves the absolute or system sound path for an audio notification.
 */
export function resolveAudioSoundPath(
  sound?: string | undefined,
  file?: string | undefined,
): string {
  if (file !== undefined && file.trim().length > 0) {
    return file.trim();
  }
  if (sound !== undefined && sound.trim().length > 0) {
    const trimmed = sound.trim();
    if (trimmed.startsWith("/") || trimmed.includes(".")) {
      return trimmed;
    }
    return `/System/Library/Sounds/${trimmed}.aiff`;
  }
  return DEFAULT_DARWIN_SOUND_PATH;
}

/**
 * Executes an audio notification action safely across platforms.
 */
export async function executeAudioAction(
  hook: HookDefinition,
  currentPlatform: string = process.platform,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (currentPlatform === "darwin") {
    const soundPath = resolveAudioSoundPath(hook.sound, hook.file);
    const command = hook.command ?? `afplay "${soundPath}"`;
    try {
      const result = spawnSync("sh", ["-c", command], {
        timeout: hook.timeout_ms ?? 5000,
        stdio: hook.silent === true ? "ignore" : "pipe",
        encoding: "utf8",
      });

      if (result.status === 0) {
        return { success: true, output: `Played audio: ${soundPath}` };
      }
      const err = result.stderr
        ? result.stderr.trim()
        : `Process exited with code ${result.status}`;
      return { success: false, error: err && err.length > 0 ? err : "Audio playback failed" };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (currentPlatform === "linux") {
    const file = hook.file ?? (hook.sound ? `/usr/share/sounds/${hook.sound}` : undefined);
    const command = hook.command ?? (file ? `paplay "${file}" || aplay "${file}"` : `printf '\\a'`);
    try {
      const result = spawnSync("sh", ["-c", command], {
        timeout: hook.timeout_ms ?? 5000,
        stdio: "ignore",
      });
      return {
        success: result.status === 0,
        output: result.status === 0 ? "Played Linux audio notification" : undefined,
        error: result.status !== 0 ? `Process exited with code ${result.status}` : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    success: true,
    output: `Audio action skipped on platform: ${currentPlatform}`,
  };
}

/**
 * Executes a shell command action safely with execution timeout and isolated environment.
 */
export async function executeShellAction(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (hook.command === undefined || hook.command.trim().length === 0) {
    return { success: false, error: "Missing shell command in hook definition" };
  }

  try {
    const processEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === "string") {
        processEnv[key] = value;
      }
    }

    const env: Record<string, string> = {
      ...processEnv,
      ...(hook.env ?? {}),
      LIFECYCLE_EVENT: event,
      LIFECYCLE_PAYLOAD: JSON.stringify(payload ?? {}),
    };

    const result = spawnSync("sh", ["-c", hook.command], {
      cwd: hook.cwd ?? process.cwd(),
      env,
      timeout: hook.timeout_ms ?? 10_000,
      stdio: "pipe",
      encoding: "utf8",
    });

    if (result.status === 0) {
      const stdout = result.stdout ? result.stdout.trim() : "";
      return { success: true, output: stdout };
    }

    const stderr = result.stderr ? result.stderr.trim() : "";
    const stdout = result.stdout ? result.stdout.trim() : "";
    return {
      success: false,
      output: stdout.length > 0 ? stdout : undefined,
      error: stderr.length > 0 ? stderr : `Process exited with status ${result.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Executes a webhook HTTP notification action safely with timeout.
 */
export async function executeWebhookAction(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (hook.url === undefined || hook.url.trim().length === 0) {
    return { success: false, error: "Missing webhook URL in hook definition" };
  }

  try {
    const method = typeof hook.method === "string" ? hook.method : "POST";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(hook.headers ?? {}),
    };

    const hasBody = method !== "GET";
    const body = hasBody
      ? JSON.stringify({
          event,
          payload: payload ?? {},
          timestamp: new Date().toISOString(),
        })
      : undefined;

    const timeout = hook.timeout_ms ?? 5000;
    const response = await fetch(hook.url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });

    if (response.ok) {
      return { success: true, output: `HTTP ${response.status} ${response.statusText}` };
    }

    const text = await response.text().catch(() => "");
    return {
      success: false,
      error: `HTTP ${response.status}: ${text.length > 0 ? text : response.statusText}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Executes an in-process custom handler action safely.
 */
export async function executeCustomAction(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (typeof hook.handler !== "function") {
    return { success: false, error: "Missing custom hook handler function" };
  }

  try {
    const result = await hook.handler(event, payload);
    const output =
      typeof result === "string"
        ? result
        : result !== undefined && result !== null
          ? JSON.stringify(result)
          : undefined;
    return { success: true, output };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Dispatches an individual hook definition safely, recording duration, status, and output.
 */
export async function dispatchSingleHook(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
  currentPlatform: string = process.platform,
): Promise<HookResult> {
  const hookId = hook.id ?? `hook-${hook.action}`;
  const startTime = Date.now();

  if (hook.enabled === false) {
    return {
      hookId,
      event,
      action: hook.action,
      success: true,
      skipped: true,
      skipReason: "hook_disabled",
      durationMs: 0,
    };
  }

  if (!isPlatformSupported(hook.platforms, currentPlatform)) {
    return {
      hookId,
      event,
      action: hook.action,
      success: true,
      skipped: true,
      skipReason: `platform_${currentPlatform}_not_supported`,
      durationMs: 0,
    };
  }

  let actionResult: {
    success: boolean;
    output?: string | undefined;
    error?: string | undefined;
  };

  try {
    switch (hook.action) {
      case "audio":
        actionResult = await executeAudioAction(hook, currentPlatform);
        break;
      case "shell":
        actionResult = await executeShellAction(hook, event, payload);
        break;
      case "webhook":
        actionResult = await executeWebhookAction(hook, event, payload);
        break;
      case "custom":
        actionResult = await executeCustomAction(hook, event, payload);
        break;
      default:
        actionResult = {
          success: false,
          error: `Unsupported hook action: ${String(hook.action)}`,
        };
        break;
    }
  } catch (err) {
    actionResult = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const durationMs = Date.now() - startTime;
  return {
    hookId,
    event,
    action: hook.action,
    success: actionResult.success,
    durationMs,
    output: actionResult.output,
    error: actionResult.error,
  };
}

/**
 * Dispatches all registered lifecycle hooks matching the event.
 * Non-blocking: errors in one hook never stop other hooks or throw to the caller.
 */
export async function dispatchLifecycleHook(
  event: LifecycleEvent,
  payload?: Record<string, unknown> | undefined,
  customConfig?: HookConfig | undefined,
): Promise<HookResult[]> {
  const config = customConfig ?? loadHookConfig();

  if (config.enabled === false) {
    return [];
  }

  const matchingHooks = config.hooks.filter((hook) => {
    if (hook.enabled === false) return false;
    return hook.events.some((pat) => matchesEvent(pat, event));
  });

  if (matchingHooks.length === 0) {
    return [];
  }

  const results: HookResult[] = [];
  for (const hook of matchingHooks) {
    try {
      const result = await dispatchSingleHook(hook, event, payload);
      results.push(result);
    } catch (err) {
      results.push({
        hookId: hook.id ?? "unknown-hook",
        event,
        action: hook.action,
        success: false,
        durationMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
