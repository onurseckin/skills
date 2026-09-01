import type { TestRuntimeSummary } from "../../../scripts/testing/reporting/index.ts";

export function createSampleRuntimeSummary(
  overrides: Partial<TestRuntimeSummary> = {},
): TestRuntimeSummary {
  return {
    totalFiles: 2,
    totalDurationMs: 150,
    avgDurationMs: 75,
    medianDurationMs: 75,
    files: [
      { file: "tests/testing/runner/test-runner.test.ts", durationMs: 100, passed: true },
      { file: "tests/testing/virtual-fs/virtual-memory-fs.test.ts", durationMs: 50, passed: true },
    ],
    slowestFile: {
      file: "tests/testing/runner/test-runner.test.ts",
      durationMs: 100,
      passed: true,
    },
    pareto50FileCount: 1,
    pareto90FileCount: 2,
    ...overrides,
  };
}
