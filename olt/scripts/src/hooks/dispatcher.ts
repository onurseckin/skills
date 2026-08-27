import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { resolve, sep } from "node:path";
import { findRepoRoot } from "../core/shared/paths.ts";
import { loadRepoPolicy } from "../policy/repo-policy.ts";
import { DEFAULT_DARWIN_SOUND_PATH, loadHookConfig } from "./config.ts";
import type { HookConfig, HookDefinition, HookResult, LifecycleEvent } from "./types.ts";

const RECURSIVE_DELETE_TOKENS = new Set(["rm", "rmdir", "del", "rd"]);

export const ALLOWED_SHELL_EXECUTABLES: readonly string[] = Object.freeze([
  "echo",
  "printf",
  "pwd",
  "date",
]);

const ALLOWED_SHELL_EXECUTABLE_SET = new Set(ALLOWED_SHELL_EXECUTABLES);

const TRUSTED_EXECUTABLE_CANDIDATE_PATHS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    echo: ["/bin/echo", "/usr/bin/echo"],
    printf: ["/usr/bin/printf", "/bin/printf"],
    pwd: ["/bin/pwd", "/usr/bin/pwd"],
    date: ["/bin/date", "/usr/bin/date"],
  });

const resolvedTrustedExecutablePathCache = new Map<string, string | null>();

function isHardenedShellExecutableName(executable: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRUSTED_EXECUTABLE_CANDIDATE_PATHS, executable);
}

export function resolveTrustedExecutablePath(executable: string): string | undefined {
  const cached = resolvedTrustedExecutablePathCache.get(executable);
  if (cached !== undefined) {
    return cached === null ? undefined : cached;
  }
  const candidates = TRUSTED_EXECUTABLE_CANDIDATE_PATHS[executable] ?? [];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      resolvedTrustedExecutablePathCache.set(executable, candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  resolvedTrustedExecutablePathCache.set(executable, null);
  return undefined;
}

const AUDIO_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  ".aiff",
  ".wav",
  ".mp3",
  ".m4a",
  ".caf",
  ".au",
]);

const AMBIENT_HOOK_ENVIRONMENT_KEYS: readonly string[] = Object.freeze([
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

export type HookShellRefusalRule =
  | "SHELL_STRING_COMMAND_REJECTED"
  | "MISSING_COMMAND_ARGV"
  | "EXECUTABLE_NOT_ALLOWLISTED"
  | "RECURSIVE_DELETE_DETECTED"
  | "FORBIDDEN_COMMANDS_POLICY"
  | "CWD_OUTSIDE_REPOSITORY";

export type HookAudioRefusalRule = "AUDIO_COMMAND_STRING_REJECTED" | "AUDIO_FILE_PATH_INVALID";

export interface ProcessRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type ProcessRunner = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string>> | undefined;
    readonly timeoutMs: number;
    readonly captureOutput: boolean;
  },
) => ProcessRunResult;

function runSpawnSync(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string>> | undefined;
    readonly timeoutMs: number;
    readonly captureOutput: boolean;
  },
): ProcessRunResult {
  const result = spawnSync(executable, [...args], {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeoutMs,
    stdio: options.captureOutput ? "pipe" : "ignore",
    encoding: "utf8",
    shell: false,
  });

  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr:
      typeof result.stderr === "string"
        ? result.stderr
        : result.error !== undefined
          ? result.error.message
          : "",
  };
}

export const defaultProcessRunner: ProcessRunner = (executable, args, options) => {
  if (isHardenedShellExecutableName(executable)) {
    const trustedPath = resolveTrustedExecutablePath(executable);
    if (trustedPath === undefined) {
      return {
        status: null,
        stdout: "",
        stderr: `no trusted absolute path could be resolved for allowlisted executable "${executable}" on this system; refusing to fall back to a PATH-based lookup`,
      };
    }
    return runSpawnSync(trustedPath, args, options);
  }
  return runSpawnSync(executable, args, options);
};

function formatArgvLiteral(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

function formatHookRefusal(
  rule: HookShellRefusalRule | HookAudioRefusalRule,
  message: string,
): string {
  return `Refused hook [${rule}]: ${message}`;
}

function tokenizeLegacyCommandForDisplay(command: string): string[] {
  const pattern = /'[^']*'|"[^"]*"|\S+/g;
  const matches = command.match(pattern) ?? [];
  return matches.map((raw) => {
    if (
      raw.length >= 2 &&
      ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"')))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  });
}

export function isAllowedShellExecutable(executable: string): boolean {
  return ALLOWED_SHELL_EXECUTABLE_SET.has(executable);
}

function stripShellEscapes(token: string): string {
  return token
    .replace(/\\/g, "")
    .replace(/^['"]+/, "")
    .replace(/['"]+$/, "");
}

export function commandContainsRecursiveDelete(command: string): boolean {
  const segments = command.split(/[;&|\n]+/);
  for (const segment of segments) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    for (let i = 0; i < tokens.length; i++) {
      const base = stripShellEscapes(tokens[i]!).replace(/^.*\//, "").toLowerCase();
      if (!RECURSIVE_DELETE_TOKENS.has(base)) {
        continue;
      }
      let hasRecursive = false;
      for (const rawFlag of tokens.slice(i + 1, i + 12)) {
        const flag = stripShellEscapes(rawFlag);
        if (!flag.startsWith("-")) {
          continue;
        }
        if (flag === "--recursive" || /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(flag)) {
          hasRecursive = true;
        }
      }
      if (hasRecursive) {
        return true;
      }
    }
  }
  return false;
}

export function findForbiddenCommandMatch(
  command: string,
  forbiddenCommands: readonly string[],
): string | undefined {
  const normalized = stripShellEscapes(command).toLowerCase();
  for (const entry of forbiddenCommands) {
    const needle = entry.trim().toLowerCase();
    if (needle.length > 0 && normalized.includes(needle)) {
      return entry;
    }
  }
  return undefined;
}

export type HookCwdResolution =
  | { readonly ok: true; readonly cwd: string }
  | { readonly ok: false; readonly reason: string };

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

function isValidAudioFilePath(candidate: string): boolean {
  if (!candidate.startsWith("/")) {
    return false;
  }
  const lower = candidate.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function executeAudioAction(
  hook: HookDefinition,
  currentPlatform: string = process.platform,
  runner: ProcessRunner = defaultProcessRunner,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (hook.command !== undefined && hook.command.trim().length > 0) {
    return {
      success: false,
      error: formatHookRefusal(
        "AUDIO_COMMAND_STRING_REJECTED",
        `audio hooks no longer accept a raw "command" shell string ("${hook.command}"); declare "sound" and/or "file" instead, e.g. { "action": "audio", "sound": "Bottle" }.`,
      ),
    };
  }

  if (currentPlatform === "darwin") {
    const soundPath = resolveAudioSoundPath(hook.sound, hook.file);
    if (!isValidAudioFilePath(soundPath)) {
      return {
        success: false,
        error: formatHookRefusal(
          "AUDIO_FILE_PATH_INVALID",
          `resolved audio path "${soundPath}" is not an absolute path ending in a recognized audio extension (${AUDIO_FILE_EXTENSIONS.join(", ")}).`,
        ),
      };
    }
    try {
      const result = runner("afplay", [soundPath], {
        timeoutMs: hook.timeout_ms ?? 5000,
        captureOutput: hook.silent !== true,
      });

      if (result.status === 0) {
        return { success: true, output: `Played audio: ${soundPath}` };
      }
      const err = result.stderr.trim();
      return { success: false, error: err.length > 0 ? err : "Audio playback failed" };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (currentPlatform === "linux") {
    const file =
      hook.file !== undefined
        ? hook.file
        : hook.sound !== undefined
          ? `/usr/share/sounds/${hook.sound}`
          : undefined;

    if (file === undefined) {
      process.stdout.write("");
      return { success: true, output: "Played terminal bell" };
    }

    if (!isValidAudioFilePath(file)) {
      return {
        success: false,
        error: formatHookRefusal(
          "AUDIO_FILE_PATH_INVALID",
          `resolved audio path "${file}" is not an absolute path ending in a recognized audio extension (${AUDIO_FILE_EXTENSIONS.join(", ")}).`,
        ),
      };
    }

    try {
      for (const player of ["paplay", "aplay"]) {
        const result = runner(player, [file], {
          timeoutMs: hook.timeout_ms ?? 5000,
          captureOutput: false,
        });
        if (result.status === 0) {
          return { success: true, output: "Played Linux audio notification" };
        }
      }
      return { success: false, error: "Audio playback failed on paplay and aplay" };
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

export async function executeShellAction(
  hook: HookDefinition,
  event: LifecycleEvent,
  payload?: Readonly<Record<string, unknown>> | undefined,
  runner: ProcessRunner = defaultProcessRunner,
): Promise<{ success: boolean; output?: string | undefined; error?: string | undefined }> {
  if (hook.command !== undefined && hook.command.trim().length > 0) {
    const suggestion = tokenizeLegacyCommandForDisplay(hook.command);
    return {
      success: false,
      error: formatHookRefusal(
        "SHELL_STRING_COMMAND_REJECTED",
        `shell hooks no longer accept a "command" shell string ("${hook.command}"); declare "commandArgv" as an argv array instead, e.g. commandArgv: ${formatArgvLiteral(suggestion)} (only these executables are allowlisted: ${ALLOWED_SHELL_EXECUTABLES.join(", ")}).`,
      ),
    };
  }

  if (hook.commandArgv === undefined || hook.commandArgv.length === 0) {
    return {
      success: false,
      error: formatHookRefusal(
        "MISSING_COMMAND_ARGV",
        `shell hooks require a non-empty "commandArgv" array, e.g. commandArgv: ["echo", "hello"].`,
      ),
    };
  }

  const argv = hook.commandArgv;
  const executable = argv[0]!;

  if (!isAllowedShellExecutable(executable)) {
    return {
      success: false,
      error: formatHookRefusal(
        "EXECUTABLE_NOT_ALLOWLISTED",
        `"${executable}" is not an allowlisted hook executable. Allowed: ${ALLOWED_SHELL_EXECUTABLES.join(", ")}. Got commandArgv: ${formatArgvLiteral(argv)}.`,
      ),
    };
  }

  const reconstructed = argv.join(" ");
  if (commandContainsRecursiveDelete(reconstructed)) {
    return {
      success: false,
      error: formatHookRefusal(
        "RECURSIVE_DELETE_DETECTED",
        `recursive delete detected in commandArgv ${formatArgvLiteral(argv)}.`,
      ),
    };
  }

  const repoRoot = findRepoRoot();
  const forbiddenCommands = loadRepoPolicy(repoRoot).forbidden_commands ?? [];
  const forbiddenMatch = findForbiddenCommandMatch(reconstructed, forbiddenCommands);
  if (forbiddenMatch !== undefined) {
    return {
      success: false,
      error: formatHookRefusal(
        "FORBIDDEN_COMMANDS_POLICY",
        `commandArgv ${formatArgvLiteral(argv)} matches forbidden_commands entry "${forbiddenMatch}".`,
      ),
    };
  }

  const cwdResolution = resolvePinnedHookCwd(hook, repoRoot);
  if (!cwdResolution.ok) {
    return {
      success: false,
      error: formatHookRefusal("CWD_OUTSIDE_REPOSITORY", cwdResolution.reason),
    };
  }

  try {
    const env = buildHookChildEnvironment(hook, event, payload);

    const result = runner(executable, argv.slice(1), {
      cwd: cwdResolution.cwd,
      env,
      timeoutMs: hook.timeout_ms ?? 10_000,
      captureOutput: true,
    });

    if (result.status === 0) {
      return { success: true, output: result.stdout.trim() };
    }

    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
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
