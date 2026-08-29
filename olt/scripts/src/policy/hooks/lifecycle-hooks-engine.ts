import { spawn } from "node:child_process";
import { findRepoRoot } from "../../core/index.ts";
import { inspectRepoPolicy } from "../repo-policy.ts";
import {
  formatDuration,
  interpolateHookCommand,
  type HookInterpolationContext,
} from "./interpolator.ts";
import type { LifecycleEventType, RepoPolicy } from "../types/index.ts";

export { formatDuration };

export interface ExecuteLifecycleHooksOptions {
  readonly event: LifecycleEventType;
  readonly context: HookInterpolationContext;
  readonly repoRoot?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly customSpawn?: typeof spawn | undefined;
  readonly nonBlocking?: boolean | undefined;
}

export interface LifecycleHookExecutionResult {
  readonly event: LifecycleEventType;
  readonly commandCount: number;
  readonly executedCommands: readonly string[];
  readonly skipped: boolean;
  readonly errors: readonly string[];
}

export function executeLifecycleHooks(
  options: ExecuteLifecycleHooksOptions,
): LifecycleHookExecutionResult {
  const policy = options.policy ?? inspectRepoPolicy(options.repoRoot).policy;
  const commands = policy.hooks?.[options.event];

  if (!commands || commands.length === 0) {
    return {
      event: options.event,
      commandCount: 0,
      executedCommands: [],
      skipped: true,
      errors: [],
    };
  }

  const repoRoot = options.repoRoot ?? findRepoRoot();
  const enrichedContext: HookInterpolationContext = {
    repo_root: repoRoot,
    repoRoot,
    ...options.context,
  };

  const executedCommands: string[] = [];
  const errors: string[] = [];
  const spawnFn = options.customSpawn ?? spawn;
  const isNonBlocking = options.nonBlocking !== false;

  for (const template of commands) {
    const interpolated = interpolateHookCommand(template, enrichedContext);
    try {
      const child = spawnFn(interpolated, {
        shell: true,
        detached: options.nonBlocking ?? true,
        stdio: "ignore",
        cwd: repoRoot,
      });

      if (isNonBlocking && child && typeof child.unref === "function") {
        child.unref();
      }

      executedCommands.push(interpolated);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push(errorMessage);
    }
  }

  return {
    event: options.event,
    commandCount: executedCommands.length,
    executedCommands,
    skipped: false,
    errors,
  };
}
