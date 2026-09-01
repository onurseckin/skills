import type { ScopedExecutionPolicy } from "../../../olt/scripts/src/testing/scoped-execution.ts";

export function createSampleScopedPolicy(
  overrides: Partial<ScopedExecutionPolicy> = {},
): ScopedExecutionPolicy {
  return {
    allowedDomains: ["testing", "engine"],
    maxAllowedTestFiles: 1,
    maxDurationMs: 5000,
    maxMemoryMb: 512,
    maxCpuPercent: 100,
    allowFullSuite: false,
    ...overrides,
  };
}
