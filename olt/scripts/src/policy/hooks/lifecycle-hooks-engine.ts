import { type spawn } from "node:child_process";
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
import {
  DEFAULT_POLICY_HOOKS,
  executeHookCommand,
  parseCommandLineArgs,
  validatePolicyHooksConfiguration,
  type HookExecutionRecord,
  type HookSpawnRunner,
  type PolicyHooksConfig,
  type PolicyHooksValidationResult,
  type PolicyLifecycleEvent,
} from "./hook-executor.ts";
import type { LifecycleEventType, LifecycleHooksConfig, RepoPolicy } from "../types/index.ts";

export {
  DEFAULT_POLICY_HOOKS,
  executeHookCommand,
  formatDuration,
  formatHookDuration,
  interpolateHookCommand,
  interpolateLifecycleHookCommand,
  parseCommandLineArgs,
  validatePolicyHooksConfiguration,
  type HookExecutionRecord,
  type HookSpawnRunner,
  type PolicyHooksConfig,
  type PolicyHooksValidationResult,
  type PolicyLifecycleEvent,
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

export function executePolicyLifecycleHooks(
  options: PolicyHooksExecutionOptions,
): LifecycleHooksExecutionResult {
  const hooksRecord = options.hooks as Record<string, readonly string[] | undefined> | undefined;
  const eventKey = options.event;
  const altKey = EVENT_CANONICAL_MAP[eventKey];
  let commands: readonly string[] | undefined =
    hooksRecord !== undefined ? hooksRecord[eventKey] : undefined;
  if (commands === undefined && altKey !== undefined && hooksRecord !== undefined) {
    commands = hooksRecord[altKey];
  }

  if (commands === undefined ? true : commands.length === 0) {
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

export function executeLifecycleHooks(
  options: ExecuteLifecycleHooksOptions,
): LifecycleHooksExecutionResult {
  const repoRoot = options.repoRoot !== undefined ? options.repoRoot : findRepoRoot();
  let hooks = options.hooks;
  if (!hooks) {
    const policy =
      options.policy !== undefined ? options.policy : inspectRepoPolicy(repoRoot).policy;
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
