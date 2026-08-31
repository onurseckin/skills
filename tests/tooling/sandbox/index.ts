/**
 * Tooling Sandbox, Resource Governor & Policy Facade.
 */
export {
  SandboxedToolExecutor,
  type SandboxExecutionOptions,
  type SandboxExecutionResult,
} from "../../../olt/scripts/src/tooling/sandbox/sandbox-executor.ts";

export {
  ResourceGovernor,
  type SystemMetricsProvider,
  type MetricSample,
} from "../../../olt/scripts/src/tooling/sandbox/resource-governor.ts";

export {
  TimeoutWatcher,
  type TimeoutWatcherOptions,
  type TimeoutWatcherState,
} from "../../../olt/scripts/src/tooling/sandbox/timeout-watcher.ts";

export {
  createDefaultSandboxPolicy,
  createCustomSandboxPolicy,
  createDefaultResourcePolicy,
  mergeQuotas,
  resolveIsolationPolicy,
  validateSandboxPolicy,
  BALANCED_QUOTA,
  STRICT_QUOTA,
  PERMISSIVE_QUOTA,
  UNCONSTRAINED_QUOTA,
} from "../../../olt/scripts/src/tooling/sandbox/policy.ts";

export type {
  ResourceQuota,
  SandboxPolicy,
  IsolationLevel,
  QuotaViolation,
  IsolationConfig,
} from "../../../olt/scripts/src/tooling/sandbox/types.ts";
