import { spawn } from "node:child_process";

export type PolicyLifecycleEvent =
  | "on_phase_completion"
  | "on_task_completion"
  | "on_release_push"
  | "on_error";

export interface HookVariableContext {
  readonly phase_name?: string | undefined;
  readonly phaseName?: string | undefined;
  readonly commit_sha?: string | undefined;
  readonly commitSha?: string | undefined;
  readonly duration_formatted?: string | undefined;
  readonly durationFormatted?: string | undefined;
  readonly duration_ms?: number | string | undefined;
  readonly durationMs?: number | string | undefined;
  readonly task_count?: number | string | undefined;
  readonly taskCount?: number | string | undefined;
  readonly repo_root?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly error_message?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly task_id?: string | undefined;
  readonly taskId?: string | undefined;
  readonly status?: string | undefined;
  readonly [key: string]: unknown;
}

export interface PolicyHooksConfig {
  readonly on_phase_completion?: readonly string[] | undefined;
  readonly on_task_completion?: readonly string[] | undefined;
  readonly on_release_push?: readonly string[] | undefined;
  readonly on_error?: readonly string[] | undefined;
  readonly [key: string]: readonly string[] | undefined;
}

export const DEFAULT_POLICY_HOOKS: PolicyHooksConfig = {
  on_phase_completion: [
    "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --tasks {task_count}",
  ],
};

export function formatHookDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

function str(val: unknown): string {
  return typeof val === "string" ? val : "";
}

export function interpolateLifecycleHookCommand(
  template: string,
  context: HookVariableContext,
): string {
  const phaseName = str(context.phase_name ?? context.phaseName);
  const commitSha = str(context.commit_sha ?? context.commitSha);
  const rawMs = context.duration_ms ?? context.durationMs;
  const numMs =
    typeof rawMs === "number"
      ? rawMs
      : typeof rawMs === "string" && !Number.isNaN(Number(rawMs))
        ? Number(rawMs)
        : undefined;
  const durationFormatted =
    str(context.duration_formatted ?? context.durationFormatted) ||
    (numMs !== undefined ? formatHookDuration(numMs) : "0s");
  const durationMs = numMs !== undefined ? String(numMs) : "0";
  const rawCount = context.task_count ?? context.taskCount;
  const taskCount = rawCount !== undefined ? String(rawCount) : "0";
  const repoRoot = str(context.repo_root ?? context.repoRoot);
  const errorMessage = str(context.error_message ?? context.errorMessage);
  const taskId = str(context.task_id ?? context.taskId);
  const status = str(context.status) || "SUCCESS";

  const replacements: Record<string, string> = {
    "{phase_name}": phaseName,
    "{phaseName}": phaseName,
    "{commit_sha}": commitSha,
    "{commitSha}": commitSha,
    "{duration_formatted}": durationFormatted,
    "{durationFormatted}": durationFormatted,
    "{duration_ms}": durationMs,
    "{durationMs}": durationMs,
    "{task_count}": taskCount,
    "{taskCount}": taskCount,
    "{repo_root}": repoRoot,
    "{repoRoot}": repoRoot,
    "{error_message}": errorMessage,
    "{errorMessage}": errorMessage,
    "{task_id}": taskId,
    "{taskId}": taskId,
    "{status}": status,
  };

  let result = template;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value);
  }
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && value !== null && typeof value !== "object") {
      result = result.split(`{${key}}`).join(String(value));
    }
  }
  return result;
}

export interface PolicyHooksValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly hooks?: PolicyHooksConfig | undefined;
  readonly configuredEvents: readonly string[];
  readonly totalCommandCount: number;
}

export function validatePolicyHooksConfiguration(
  policyHooks: unknown,
): PolicyHooksValidationResult {
  if (policyHooks === undefined || policyHooks === null) {
    return {
      valid: true,
      errors: [],
      hooks: undefined,
      configuredEvents: [],
      totalCommandCount: 0,
    };
  }
  if (typeof policyHooks !== "object" || Array.isArray(policyHooks)) {
    return {
      valid: false,
      errors: ["Policy hooks configuration must be an object"],
      configuredEvents: [],
      totalCommandCount: 0,
    };
  }
  const record = policyHooks as Record<string, unknown>;
  const errors: string[] = [];
  const configuredEvents: string[] = [];
  let totalCommandCount = 0;
  const validatedHooks: Record<string, string[]> = {};

  for (const [eventKey, commands] of Object.entries(record)) {
    if (!Array.isArray(commands)) {
      errors.push(`Hook event "${eventKey}" must be an array of command strings`);
      continue;
    }
    const commandList: string[] = [];
    let eventValid = true;
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      if (typeof cmd !== "string") {
        errors.push(`Hook command at index ${i} for event "${eventKey}" must be a string`);
        eventValid = false;
      } else if (cmd.trim().length === 0) {
        errors.push(`Hook command at index ${i} for event "${eventKey}" cannot be empty`);
        eventValid = false;
      } else {
        commandList.push(cmd);
      }
    }
    if (eventValid) {
      validatedHooks[eventKey] = commandList;
      configuredEvents.push(eventKey);
      totalCommandCount += commandList.length;
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors, configuredEvents, totalCommandCount };
  }
  return {
    valid: true,
    errors: [],
    hooks: validatedHooks as PolicyHooksConfig,
    configuredEvents,
    totalCommandCount,
  };
}

export type HookSpawnRunner = (
  command: string,
  options: { shell: boolean; detached: boolean; stdio: string; cwd: string },
) => unknown;

export interface HookExecutionRecord {
  readonly template: string;
  readonly command: string;
  readonly success: boolean;
  readonly error?: string | undefined;
}

export interface PolicyHooksExecutionOptions {
  readonly event: PolicyLifecycleEvent | string;
  readonly context: HookVariableContext;
  readonly hooks?: PolicyHooksConfig | undefined;
  readonly repoRoot?: string | undefined;
  readonly customSpawn?: HookSpawnRunner | typeof spawn | undefined;
  readonly nonBlocking?: boolean | undefined;
}

export interface LifecycleHooksExecutionResult {
  readonly event: PolicyLifecycleEvent | string;
  readonly commandCount: number;
  readonly executedCommands: readonly string[];
  readonly records: readonly HookExecutionRecord[];
  readonly skipped: boolean;
  readonly errors: readonly string[];
  readonly success: boolean;
}

export function executePolicyLifecycleHooks(
  options: PolicyHooksExecutionOptions,
): LifecycleHooksExecutionResult {
  const commands = options.hooks?.[options.event];
  if (!commands || commands.length === 0) {
    return {
      event: options.event,
      commandCount: 0,
      executedCommands: [],
      records: [],
      skipped: true,
      errors: [],
      success: true,
    };
  }

  const repoRoot =
    options.repoRoot ??
    (typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/");
  const enrichedContext: HookVariableContext = {
    repo_root: repoRoot,
    repoRoot,
    ...options.context,
  };
  const executedCommands: string[] = [];
  const records: HookExecutionRecord[] = [];
  const errors: string[] = [];
  const spawnFn = options.customSpawn ?? spawn;
  const isNonBlocking = options.nonBlocking !== false;

  for (const template of commands) {
    const interpolated = interpolateLifecycleHookCommand(template, enrichedContext);
    try {
      const child = spawnFn(interpolated, {
        shell: true,
        detached: isNonBlocking,
        stdio: "ignore",
        cwd: repoRoot,
      });
      if (
        isNonBlocking &&
        child !== null &&
        typeof child === "object" &&
        "unref" in child &&
        typeof (child as { unref?: unknown }).unref === "function"
      ) {
        (child as { unref: () => void }).unref();
      }
      executedCommands.push(interpolated);
      records.push({ template, command: interpolated, success: true });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push(errorMessage);
      records.push({ template, command: interpolated, success: false, error: errorMessage });
    }
  }

  return {
    event: options.event,
    commandCount: executedCommands.length,
    executedCommands,
    records,
    skipped: false,
    errors,
    success: errors.length === 0,
  };
}

export interface EvaluateHooksEngineOptions {
  readonly event: PolicyLifecycleEvent | string;
  readonly context: HookVariableContext;
  readonly policyHooks?: unknown;
  readonly repoRoot?: string | undefined;
  readonly customSpawn?: HookSpawnRunner | typeof spawn | undefined;
  readonly nonBlocking?: boolean | undefined;
}

export function evaluatePolicyHooksEngine(
  options: EvaluateHooksEngineOptions,
): LifecycleHooksExecutionResult {
  let activeHooks: PolicyHooksConfig | undefined;
  if (options.policyHooks === undefined) {
    activeHooks = DEFAULT_POLICY_HOOKS;
  } else {
    const validation = validatePolicyHooksConfiguration(options.policyHooks);
    if (!validation.valid) {
      return {
        event: options.event,
        commandCount: 0,
        executedCommands: [],
        records: [],
        skipped: false,
        errors: validation.errors,
        success: false,
      };
    }
    activeHooks = validation.hooks;
  }

  return executePolicyLifecycleHooks({
    event: options.event,
    context: options.context,
    hooks: activeHooks,
    repoRoot: options.repoRoot,
    customSpawn: options.customSpawn,
    nonBlocking: options.nonBlocking,
  });
}
