import { spawn } from "node:child_process";
import {
  interpolateHookCommand,
  type HookVariableContext,
} from "./interpolator.ts";
import type { LifecycleHooksConfig } from "../types/index.ts";

export type PolicyLifecycleEvent =
  | "on_phase_completion"
  | "on_task_completion"
  | "on_release_push"
  | "on_wave_completion"
  | "on_wave_complete"
  | "on_error"
  | "on_task_validate"
  | "on_defect_resolved"
  | "POST_PHASE"
  | "POST_PUSH"
  | "POST_TASK_SUBMIT"
  | "POST_TASK_VALIDATE"
  | "ON_DEFECT_RESOLVED";

export type PolicyHooksConfig = LifecycleHooksConfig & {
  readonly [key: string]: readonly string[] | undefined;
};

export const DEFAULT_POLICY_HOOKS: PolicyHooksConfig = {
  on_phase_completion: [
    "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --tasks {task_count}",
  ],
};

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
  if (policyHooks === undefined ? true : policyHooks === null) {
    return {
      valid: true,
      errors: [],
      hooks: undefined,
      configuredEvents: [],
      totalCommandCount: 0,
    };
  }
  if (typeof policyHooks !== "object" ? true : Array.isArray(policyHooks)) {
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
  if (errors.length > 0) return { valid: false, errors, configuredEvents, totalCommandCount };
  return {
    valid: true,
    errors: [],
    hooks: validatedHooks as PolicyHooksConfig,
    configuredEvents,
    totalCommandCount,
  };
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

export type HookSpawnRunner = (
  command: string,
  options: { detached: boolean; stdio: string; cwd: string },
) => unknown;

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
  const fallbackRoot =
    typeof process !== "undefined" && typeof process.cwd === "function" ? process.cwd() : "/";
  const repoRoot = options.repoRoot !== undefined ? options.repoRoot : fallbackRoot;
  const enrichedContext: HookVariableContext = { repo_root: repoRoot, repoRoot, ...context };
  const isNonBlocking = options.nonBlocking !== false;
  const interpolated = interpolateHookCommand(commandTemplate, enrichedContext);
  const parsedArgs = parseCommandLineArgs(interpolated);
  const [firstArg, ...args] = parsedArgs;
  const executable = firstArg !== undefined ? firstArg : "";

  if (executable.length === 0) {
    return {
      template: commandTemplate,
      command: interpolated,
      success: false,
      error: "Empty command",
    };
  }

  try {
    const spawnOpts = { detached: isNonBlocking, stdio: "ignore" as const, cwd: repoRoot };
    const child = options.customSpawn
      ? options.customSpawn(interpolated, spawnOpts)
      : spawn(executable, args, spawnOpts);
    if (
      isNonBlocking &&
      child !== null &&
      typeof child === "object" &&
      "unref" in child &&
      typeof (child as { unref?: unknown }).unref === "function"
    ) {
      (child as { unref: () => void }).unref();
    }
    return { template: commandTemplate, command: interpolated, success: true };
  } catch (err) {
    return {
      template: commandTemplate,
      command: interpolated,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
