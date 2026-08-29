import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { findRepoRoot } from "../core/shared/paths.ts";
import { loadRepoPolicy } from "../policy/repo-policy.ts";
import {
  AMBIENT_HOOK_ENVIRONMENT_KEYS,
  buildHookChildEnvironment,
  resolvePinnedHookCwd,
} from "./env.ts";
import type {
  HookDefinition,
  HookShellRefusalRule,
  LifecycleEvent,
  ProcessRunner,
  ProcessRunResult,
} from "./types.ts";

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

export function formatArgvLiteral(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

export function formatHookRefusal(rule: HookShellRefusalRule | string, message: string): string {
  return `Refused hook [${rule}]: ${message}`;
}

export function tokenizeLegacyCommandForDisplay(command: string): string[] {
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

export function stripShellEscapes(token: string): string {
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

export { AMBIENT_HOOK_ENVIRONMENT_KEYS, buildHookChildEnvironment, resolvePinnedHookCwd };
