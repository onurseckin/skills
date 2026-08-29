import { loadHookConfig } from "./config/io.ts";
import { executeAudioAction, resolveAudioSoundPath } from "./audio.ts";
import {
  ALLOWED_SHELL_EXECUTABLES,
  buildHookChildEnvironment,
  commandContainsRecursiveDelete,
  defaultProcessRunner,
  executeShellAction,
  findForbiddenCommandMatch,
  isAllowedShellExecutable,
  resolvePinnedHookCwd,
  resolveTrustedExecutablePath,
} from "./shell.ts";
import { executeCustomAction, executeWebhookAction } from "./actions.ts";
import type {
  HookAudioRefusalRule,
  HookConfig,
  HookCwdResolution,
  HookDefinition,
  HookResult,
  HookShellRefusalRule,
  LifecycleEvent,
  ProcessRunner,
  ProcessRunResult,
} from "./types.ts";

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

export function isPlatformSupported(
  platforms?: readonly (NodeJS.Platform | string)[] | undefined,
  currentPlatform: string = process.platform,
): boolean {
  if (platforms === undefined || platforms.length === 0) {
    return true;
  }
  return platforms.includes(currentPlatform);
}

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

export {
  ALLOWED_SHELL_EXECUTABLES,
  buildHookChildEnvironment,
  commandContainsRecursiveDelete,
  defaultProcessRunner,
  executeAudioAction,
  executeCustomAction,
  executeShellAction,
  executeWebhookAction,
  findForbiddenCommandMatch,
  isAllowedShellExecutable,
  resolveAudioSoundPath,
  resolvePinnedHookCwd,
  resolveTrustedExecutablePath,
};

export type {
  HookAudioRefusalRule,
  HookCwdResolution,
  HookShellRefusalRule,
  ProcessRunner,
  ProcessRunResult,
};
