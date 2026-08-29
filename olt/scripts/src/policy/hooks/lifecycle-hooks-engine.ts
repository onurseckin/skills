import { spawn } from "node:child_process";
import { findRepoRoot } from "../../core/index.ts";
import { inspectRepoPolicy } from "../repo-policy.ts";
import {
  formatDuration,
  formatHookDuration,
  interpolateHookCommand,
  interpolateLifecycleHookCommand,
  type HookInterpolationContext,
  type HookVariableContext,
} from "./interpolator.ts";
import type { LifecycleEventType, LifecycleHooksConfig, RepoPolicy } from "../types/index.ts";

export { formatDuration, formatHookDuration, interpolateHookCommand, interpolateLifecycleHookCommand };

export type PolicyLifecycleEvent =
  | "on_phase_completion" | "on_task_completion" | "on_release_push" | "on_wave_completion"
  | "on_wave_complete" | "on_error" | "on_task_validate" | "on_defect_resolved"
  | "POST_PHASE" | "POST_PUSH" | "POST_TASK_SUBMIT" | "POST_TASK_VALIDATE" | "ON_DEFECT_RESOLVED";

export type PolicyHooksConfig = LifecycleHooksConfig & {
  readonly [key: string]: readonly string[] | undefined;
};

export const DEFAULT_POLICY_HOOKS: PolicyHooksConfig = {
  on_phase_completion: [
    "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --tasks {task_count}",
  ],
};

const EVENT_CANONICAL_MAP: Record<string, string> = {
  POST_PHASE: "on_phase_completion",
  POST_PUSH: "on_release_push",
  POST_TASK_SUBMIT: "on_task_completion",
  POST_TASK_VALIDATE: "on_task_validate",
  ON_DEFECT_RESOLVED: "on_defect_resolved",
  on_phase_completion: "POST_PHASE",
  on_release_push: "POST_PUSH",
  on_task_completion: "POST_TASK_SUBMIT",
  on_task_validate: "POST_TASK_VALIDATE",
  on_defect_resolved: "ON_DEFECT_RESOLVED",
  on_wave_complete: "on_wave_completion",
  on_wave_completion: "on_wave_complete",
};

export interface PolicyHooksValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly hooks?: PolicyHooksConfig | undefined;
  readonly configuredEvents: readonly string[];
  readonly totalCommandCount: number;
}

export function validatePolicyHooksConfiguration(policyHooks: unknown): PolicyHooksValidationResult {
  if (policyHooks === undefined ? true : policyHooks === null) {
    return { valid: true, errors: [], hooks: undefined, configuredEvents: [], totalCommandCount: 0 };
  }
  if (typeof policyHooks !== "object" ? true : Array.isArray(policyHooks)) {
    return { valid: false, errors: ["Policy hooks configuration must be an object"], configuredEvents: [], totalCommandCount: 0 };
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
  if (errors.length > 0) return { valid: false, errors, configuredEvents, totalCommandCount };
  return { valid: true, errors: [], hooks: validatedHooks as PolicyHooksConfig, configuredEvents, totalCommandCount };
}

export function parseCommandLineArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < command.length; i++) {
    const rawChar = command[i];
    const char = rawChar !== undefined ? rawChar : "";
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) args.push(current);
  return args;
}

export type HookSpawnRunner = (command: string, options: { detached: boolean; stdio: string; cwd: string }) => unknown;

export interface HookExecutionRecord {
  readonly template: string;
  readonly command: string;
  readonly success: boolean;
  readonly error?: string | undefined;
}

export function executeHookCommand(
  commandTemplate: string,
  context: HookVariableContext,
  options: {
    readonly repoRoot?: string | undefined;
    readonly customSpawn?: HookSpawnRunner | typeof spawn | undefined;
    readonly nonBlocking?: boolean | undefined;
  } = {},
): HookExecutionRecord {
  const fallbackRoot = typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/";
  const repoRoot = options.repoRoot !== undefined ? options.repoRoot : fallbackRoot;
  const enrichedContext: HookVariableContext = { repo_root: repoRoot, repoRoot, ...context };
  const isNonBlocking = options.nonBlocking !== false;
  const interpolated = interpolateHookCommand(commandTemplate, enrichedContext);
  const parsedArgs = parseCommandLineArgs(interpolated);
  const [firstArg, ...args] = parsedArgs;
  const executable = firstArg !== undefined ? firstArg : "";

  if (executable.length === 0) {
    return { template: commandTemplate, command: interpolated, success: false, error: "Empty command" };
  }

  try {
    const spawnOpts = { detached: isNonBlocking, stdio: "ignore" as const, cwd: repoRoot };
    const child = options.customSpawn ? options.customSpawn(interpolated, spawnOpts) : spawn(executable, args, spawnOpts);
    if (isNonBlocking && child !== null && typeof child === "object" && "unref" in child && typeof (child as { unref?: unknown }).unref === "function") {
      (child as { unref: () => void }).unref();
    }
    return { template: commandTemplate, command: interpolated, success: true };
  } catch (err) {
    return { template: commandTemplate, command: interpolated, success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PolicyHooksExecutionOptions {
  readonly event: PolicyLifecycleEvent | LifecycleEventType | string;
  readonly context: HookVariableContext;
  readonly hooks?: PolicyHooksConfig | LifecycleHooksConfig | undefined;
  readonly repoRoot?: string | undefined;
  readonly customSpawn?: HookSpawnRunner | typeof spawn | undefined;
  readonly nonBlocking?: boolean | undefined;
}

export interface LifecycleHooksExecutionResult {
  readonly event: PolicyLifecycleEvent | LifecycleEventType | string;
  readonly commandCount: number;
  readonly executedCommands: readonly string[];
  readonly records: readonly HookExecutionRecord[];
  readonly skipped: boolean;
  readonly errors: readonly string[];
  readonly success: boolean;
}

export interface ExecuteLifecycleHooksOptions {
  readonly event: LifecycleEventType | PolicyLifecycleEvent | string;
  readonly context: HookInterpolationContext;
  readonly repoRoot?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly hooks?: PolicyHooksConfig | LifecycleHooksConfig | undefined;
  readonly customSpawn?: HookSpawnRunner | typeof spawn | undefined;
  readonly nonBlocking?: boolean | undefined;
}

export type LifecycleHookExecutionResult = LifecycleHooksExecutionResult;

export function executePolicyLifecycleHooks(options: PolicyHooksExecutionOptions): LifecycleHooksExecutionResult {
  const hooksRecord = options.hooks as Record<string, readonly string[] | undefined> | undefined;
  const eventKey = options.event;
  const altKey = EVENT_CANONICAL_MAP[eventKey];
  let commands: readonly string[] | undefined = hooksRecord !== undefined ? hooksRecord[eventKey] : undefined;
  if (commands === undefined && altKey !== undefined && hooksRecord !== undefined) {
    commands = hooksRecord[altKey];
  }

  if (commands === undefined ? true : commands.length === 0) {
    return { event: options.event, commandCount: 0, executedCommands: [], records: [], skipped: true, errors: [], success: true };
  }

  const executedCommands: string[] = [];
  const records: HookExecutionRecord[] = [];
  const errors: string[] = [];

  if (commands && Array.isArray(commands)) {
    for (const template of commands) {
      const record = executeHookCommand(template, options.context, {
        repoRoot: options.repoRoot,
        customSpawn: options.customSpawn,
        nonBlocking: options.nonBlocking,
      });
      records.push(record);
      if (record.success) executedCommands.push(record.command);
      else if (record.error) errors.push(record.error);
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

export function executeLifecycleHooks(options: ExecuteLifecycleHooksOptions): LifecycleHooksExecutionResult {
  const repoRoot = options.repoRoot !== undefined ? options.repoRoot : findRepoRoot();
  let hooks = options.hooks;
  if (!hooks) {
    const policy = options.policy !== undefined ? options.policy : inspectRepoPolicy(repoRoot).policy;
    hooks = policy !== undefined ? policy.hooks : undefined;
  }
  return executePolicyLifecycleHooks({
    event: options.event,
    context: options.context,
    hooks,
    repoRoot,
    customSpawn: options.customSpawn,
    nonBlocking: options.nonBlocking,
  });
}

export interface EvaluateHooksEngineOptions {
  readonly event: PolicyLifecycleEvent | LifecycleEventType | string;
  readonly context: HookVariableContext;
  readonly policyHooks?: unknown;
  readonly repoRoot?: string | undefined;
  readonly customSpawn?: HookSpawnRunner | typeof spawn | undefined;
  readonly nonBlocking?: boolean | undefined;
}

export function evaluatePolicyHooksEngine(options: EvaluateHooksEngineOptions): LifecycleHooksExecutionResult {
  let activeHooks: PolicyHooksConfig | undefined;
  if (options.policyHooks === undefined) {
    activeHooks = DEFAULT_POLICY_HOOKS;
  } else {
    const validation = validatePolicyHooksConfiguration(options.policyHooks);
    if (!validation.valid) {
      return { event: options.event, commandCount: 0, executedCommands: [], records: [], skipped: false, errors: validation.errors, success: false };
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
