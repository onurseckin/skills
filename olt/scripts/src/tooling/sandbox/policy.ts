import type { IsolationLevel, ResourceQuota, SandboxPolicyConfig, SandboxTier } from "./types.ts";

export const STRICT_QUOTA: ResourceQuota = {
  timeoutMs: 5000,
  gracePeriodMs: 1000,
  heartbeatIntervalMs: 2000,
  maxMemoryRssBytes: 128 * 1024 * 1024,
  memoryWarningBytes: 96 * 1024 * 1024,
  maxHeapBytes: 64 * 1024 * 1024,
  maxCpuPercent: 60,
  cpuSampleIntervalMs: 50,
  maxCpuViolationCount: 3,
  maxConcurrentRuns: 2,
};

export const BALANCED_QUOTA: ResourceQuota = {
  timeoutMs: 30000,
  gracePeriodMs: 3000,
  heartbeatIntervalMs: 5000,
  maxMemoryRssBytes: 512 * 1024 * 1024,
  memoryWarningBytes: 384 * 1024 * 1024,
  maxHeapBytes: 256 * 1024 * 1024,
  maxCpuPercent: 80,
  cpuSampleIntervalMs: 100,
  maxCpuViolationCount: 5,
  maxConcurrentRuns: 5,
};

export const PERMISSIVE_QUOTA: ResourceQuota = {
  timeoutMs: 120000,
  gracePeriodMs: 10000,
  heartbeatIntervalMs: 15000,
  maxMemoryRssBytes: 2048 * 1024 * 1024,
  memoryWarningBytes: 1536 * 1024 * 1024,
  maxHeapBytes: 1024 * 1024 * 1024,
  maxCpuPercent: 95,
  cpuSampleIntervalMs: 200,
  maxCpuViolationCount: 10,
  maxConcurrentRuns: 10,
};

export const UNCONSTRAINED_QUOTA: ResourceQuota = {
  timeoutMs: 600000,
  gracePeriodMs: 30000,
  heartbeatIntervalMs: 30000,
  maxMemoryRssBytes: 8192 * 1024 * 1024,
  memoryWarningBytes: 6144 * 1024 * 1024,
  maxHeapBytes: 4096 * 1024 * 1024,
  maxCpuPercent: 100,
  cpuSampleIntervalMs: 500,
  maxCpuViolationCount: 20,
  maxConcurrentRuns: 20,
};

export const STRICT_SANDBOX_POLICY: SandboxPolicyConfig = {
  isolationLevel: "strict",
  defaultTier: "strict",
  tierQuotas: {
    strict: STRICT_QUOTA,
    balanced: BALANCED_QUOTA,
    permissive: PERMISSIVE_QUOTA,
    unconstrained: UNCONSTRAINED_QUOTA,
  },
  allowedDirectories: [],
  blockedDirectories: ["/etc", "/var", "/usr", "/root", "/System", "/Library", "/private"],
  readOnlyDirectories: [],
  allowedEnvironmentKeys: ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL"],
  blockedEnvironmentKeys: [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "SSH_AUTH_SOCK",
    "SSH_AGENT_PID",
  ],
  maxMemoryMb: 512,
  maxExecutionTimeMs: 10_000,
  allowSubprocess: false,
  allowNetwork: false,
  maxOutputSizeBytes: 1024 * 1024,
};

export const RESTRICTED_SANDBOX_POLICY: SandboxPolicyConfig = {
  isolationLevel: "restricted",
  defaultTier: "balanced",
  tierQuotas: {
    strict: STRICT_QUOTA,
    balanced: BALANCED_QUOTA,
    permissive: PERMISSIVE_QUOTA,
    unconstrained: UNCONSTRAINED_QUOTA,
  },
  allowedDirectories: [],
  blockedDirectories: ["/etc", "/var", "/usr", "/root", "/System", "/Library", "/private"],
  readOnlyDirectories: [],
  allowedEnvironmentKeys: ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "NODE_ENV"],
  blockedEnvironmentKeys: [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "SSH_AUTH_SOCK",
  ],
  maxMemoryMb: 1024,
  maxExecutionTimeMs: 30_000,
  allowSubprocess: true,
  allowNetwork: false,
  maxOutputSizeBytes: 5 * 1024 * 1024,
};

export const READ_ONLY_SANDBOX_POLICY: SandboxPolicyConfig = {
  isolationLevel: "read_only",
  defaultTier: "balanced",
  tierQuotas: {
    strict: STRICT_QUOTA,
    balanced: BALANCED_QUOTA,
    permissive: PERMISSIVE_QUOTA,
    unconstrained: UNCONSTRAINED_QUOTA,
  },
  allowedDirectories: [],
  blockedDirectories: ["/etc", "/var", "/usr", "/root", "/System", "/Library", "/private"],
  readOnlyDirectories: ["/"],
  allowedEnvironmentKeys: ["PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "NODE_ENV"],
  blockedEnvironmentKeys: [
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ACCESS_KEY_ID",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
  ],
  maxMemoryMb: 1024,
  maxExecutionTimeMs: 30_000,
  allowSubprocess: true,
  allowNetwork: true,
  maxOutputSizeBytes: 5 * 1024 * 1024,
};

export const PERMISSIVE_SANDBOX_POLICY: SandboxPolicyConfig = {
  isolationLevel: "permissive",
  defaultTier: "permissive",
  tierQuotas: {
    strict: STRICT_QUOTA,
    balanced: BALANCED_QUOTA,
    permissive: PERMISSIVE_QUOTA,
    unconstrained: UNCONSTRAINED_QUOTA,
  },
  allowedDirectories: [],
  blockedDirectories: ["/etc/shadow", "/etc/sudoers", "/root"],
  readOnlyDirectories: [],
  allowedEnvironmentKeys: [],
  blockedEnvironmentKeys: ["SSH_AUTH_SOCK"],
  maxMemoryMb: 4096,
  maxExecutionTimeMs: 300_000,
  allowSubprocess: true,
  allowNetwork: true,
  maxOutputSizeBytes: 50 * 1024 * 1024,
};

export function createDefaultSandboxPolicy(): SandboxPolicyConfig {
  return {
    defaultTier: "balanced",
    tierQuotas: {
      strict: STRICT_QUOTA,
      balanced: BALANCED_QUOTA,
      permissive: PERMISSIVE_QUOTA,
      unconstrained: UNCONSTRAINED_QUOTA,
    },
    categoryOverrides: {
      fs: { timeoutMs: 15000, maxMemoryRssBytes: 256 * 1024 * 1024 },
      network: { timeoutMs: 60000, maxMemoryRssBytes: 512 * 1024 * 1024 },
      compute: { timeoutMs: 90000, maxCpuPercent: 95, maxCpuViolationCount: 10 },
      eval: { timeoutMs: 5000, maxMemoryRssBytes: 64 * 1024 * 1024, maxCpuPercent: 50 },
    },
    toolOverrides: {},
  };
}

export const createDefaultResourcePolicy = createDefaultSandboxPolicy;

export function mergeQuotas(
  base: ResourceQuota,
  overrides?: Partial<ResourceQuota>,
): ResourceQuota {
  if (!overrides) return { ...base };
  return {
    timeoutMs: overrides.timeoutMs ?? base.timeoutMs,
    gracePeriodMs: overrides.gracePeriodMs ?? base.gracePeriodMs,
    heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? base.heartbeatIntervalMs,
    maxMemoryRssBytes: overrides.maxMemoryRssBytes ?? base.maxMemoryRssBytes,
    memoryWarningBytes: overrides.memoryWarningBytes ?? base.memoryWarningBytes,
    maxHeapBytes: overrides.maxHeapBytes ?? base.maxHeapBytes,
    maxCpuPercent: overrides.maxCpuPercent ?? base.maxCpuPercent,
    cpuSampleIntervalMs: overrides.cpuSampleIntervalMs ?? base.cpuSampleIntervalMs,
    maxCpuViolationCount: overrides.maxCpuViolationCount ?? base.maxCpuViolationCount,
    maxConcurrentRuns: overrides.maxConcurrentRuns ?? base.maxConcurrentRuns,
  };
}

export function resolveSandboxQuota(
  policy: SandboxPolicyConfig,
  tier?: SandboxTier,
  category?: string,
  toolName?: string,
): ResourceQuota {
  const selectedTier = tier ?? policy.defaultTier ?? "balanced";
  const baseQuota = policy.tierQuotas?.[selectedTier] ?? BALANCED_QUOTA;

  let resolved = { ...baseQuota };

  if (category && policy.categoryOverrides?.[category]) {
    resolved = mergeQuotas(resolved, policy.categoryOverrides[category]);
  }

  if (toolName && policy.toolOverrides?.[toolName]) {
    resolved = mergeQuotas(resolved, policy.toolOverrides[toolName]);
  }

  return resolved;
}

export function resolveSandboxPolicy(level: IsolationLevel): SandboxPolicyConfig {
  switch (level) {
    case "strict":
      return STRICT_SANDBOX_POLICY;
    case "restricted":
      return RESTRICTED_SANDBOX_POLICY;
    case "read_only":
      return READ_ONLY_SANDBOX_POLICY;
    case "permissive":
      return PERMISSIVE_SANDBOX_POLICY;
  }
}

export function createCustomSandboxPolicy(
  overrides: Partial<SandboxPolicyConfig> & { readonly isolationLevel?: IsolationLevel },
): SandboxPolicyConfig {
  const base = resolveSandboxPolicy(overrides.isolationLevel ?? "restricted");
  return {
    isolationLevel: overrides.isolationLevel ?? base.isolationLevel,
    defaultTier: overrides.defaultTier ?? base.defaultTier,
    tierQuotas: overrides.tierQuotas ?? base.tierQuotas,
    allowedDirectories: overrides.allowedDirectories ?? base.allowedDirectories ?? [],
    blockedDirectories: overrides.blockedDirectories ?? base.blockedDirectories ?? [],
    readOnlyDirectories: overrides.readOnlyDirectories ?? base.readOnlyDirectories ?? [],
    allowedEnvironmentKeys: overrides.allowedEnvironmentKeys ?? base.allowedEnvironmentKeys ?? [],
    blockedEnvironmentKeys: overrides.blockedEnvironmentKeys ?? base.blockedEnvironmentKeys ?? [],
    maxMemoryMb: overrides.maxMemoryMb ?? base.maxMemoryMb ?? 1024,
    maxExecutionTimeMs: overrides.maxExecutionTimeMs ?? base.maxExecutionTimeMs ?? 30000,
    allowSubprocess: overrides.allowSubprocess ?? base.allowSubprocess ?? true,
    allowNetwork: overrides.allowNetwork ?? base.allowNetwork ?? false,
    maxOutputSizeBytes: overrides.maxOutputSizeBytes ?? base.maxOutputSizeBytes ?? 5242880,
  };
}

export function validatePolicyConfiguration(policy: SandboxPolicyConfig): readonly string[] {
  const errors: string[] = [];
  if (policy.maxMemoryMb !== undefined && policy.maxMemoryMb <= 0) {
    errors.push("maxMemoryMb must be greater than 0");
  }
  if (policy.maxExecutionTimeMs !== undefined && policy.maxExecutionTimeMs <= 0) {
    errors.push("maxExecutionTimeMs must be greater than 0");
  }
  if (policy.maxOutputSizeBytes !== undefined && policy.maxOutputSizeBytes <= 0) {
    errors.push("maxOutputSizeBytes must be greater than 0");
  }
  return errors;
}
