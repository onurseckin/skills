import type { TestRuntimeSummary } from "../../../scripts/testing/reporting/index.ts";

export function createSampleRuntimeSummary(
  overrides: Partial<TestRuntimeSummary> = {},
): TestRuntimeSummary {
  const file1 = {
    file: "tests/testing/runner/test-runner.test.ts",
    durationMs: 100,
    percentage: 66.67,
    passed: true,
  };
  const file2 = {
    file: "tests/testing/virtual-fs/virtual-memory-fs.test.ts",
    durationMs: 50,
    percentage: 33.33,
    passed: true,
  };
  return {
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    totalFiles: 2,
    totalDurationMs: 150,
    avgDurationMs: 75,
    medianDurationMs: 75,
    files: [file1, file2],
    slowestFile: file1,
    pareto50: { percentage: 50, fileCount: 1, cumulativeDurationMs: 100, files: [file1] },
    pareto90: { percentage: 90, fileCount: 2, cumulativeDurationMs: 150, files: [file1, file2] },
    ...overrides,
  };
}
