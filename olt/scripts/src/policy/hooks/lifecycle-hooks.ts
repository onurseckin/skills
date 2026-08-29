import type { spawn } from "node:child_process";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { inspectRepoPolicy } from "../repo-policy.ts";
import {
  executeLifecycleHooks,
  executePolicyLifecycleHooks,
  type HookExecutionRecord,
  type HookSpawnRunner,
  type LifecycleHooksExecutionResult,
  type PolicyHooksConfig,
  type PolicyLifecycleEvent,
} from "./lifecycle-hooks-engine.ts";
import type { HookInterpolationContext, HookVariableContext } from "./interpolator.ts";
import type { LifecycleHooksConfig, RepoPolicy } from "../types/index.ts";

export type {
  HookExecutionRecord,
  HookInterpolationContext,
  HookSpawnRunner,
  HookVariableContext,
  LifecycleHooksConfig,
  LifecycleHooksExecutionResult,
  PolicyHooksConfig,
  PolicyLifecycleEvent,
  RepoPolicy,
};

export type HookContext = HookVariableContext;

export interface ExecutePolicyHookOptions {
  readonly repoRoot?: string | undefined;
  readonly policy?: RepoPolicy | undefined;
  readonly hooks?: PolicyHooksConfig | LifecycleHooksConfig | undefined;
  readonly customSpawn?: HookSpawnRunner | typeof spawn | undefined;
  readonly nonBlocking?: boolean | undefined;
}

export async function executePolicyHook(
  event: PolicyLifecycleEvent | string,
  ctx: HookContext = {},
  options: ExecutePolicyHookOptions = {},
): Promise<void> {
  const repoRoot = options.repoRoot !== undefined ? options.repoRoot : findRepoRoot();
  let hooks = options.hooks;
  if (!hooks) {
    const policy =
      options.policy !== undefined ? options.policy : inspectRepoPolicy(repoRoot).policy;
    hooks = policy !== undefined ? policy.hooks : undefined;
  }
  const isNonBlocking = options.nonBlocking !== undefined ? options.nonBlocking : false;
  executePolicyLifecycleHooks({
    event,
    context: ctx,
    hooks,
    repoRoot,
    customSpawn: options.customSpawn,
    nonBlocking: isNonBlocking,
  });
}
