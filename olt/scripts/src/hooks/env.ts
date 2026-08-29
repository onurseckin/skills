import { resolve, sep } from "node:path";
import type { HookCwdResolution, HookDefinition, LifecycleEvent } from "./types.ts";

export const AMBIENT_HOOK_ENVIRONMENT_KEYS: readonly string[] = Object.freeze([
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "WINDIR",
]);

export function resolvePinnedHookCwd(hook: HookDefinition, repoRoot: string): HookCwdResolution {
  const root = resolve(repoRoot);
  if (hook.cwd === undefined || hook.cwd.trim().length === 0) {
    return { ok: true, cwd: root };
  }

  const resolved = resolve(root, hook.cwd);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    return {
      ok: false,
      reason: `hook.cwd "${hook.cwd}" resolves to "${resolved}", which is outside the repository root "${root}"`,
    };
  }
  return { ok: true, cwd: resolved };
}

export function buildHookChildEnvironment(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
  parentEnv: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of AMBIENT_HOOK_ENVIRONMENT_KEYS) {
    const value = parentEnv[key];
    if (typeof value === "string") {
      environment[key] = value;
    }
  }

  for (const [key, value] of Object.entries(hook.env ?? {})) {
    if (key.toUpperCase() !== "PATH") {
      environment[key] = value;
    }
  }

  environment.LIFECYCLE_EVENT = event;
  environment.LIFECYCLE_PAYLOAD = JSON.stringify(payload ?? {});
  return environment;
}
