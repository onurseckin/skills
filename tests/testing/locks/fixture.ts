import {
  createTestSummaryRecord,
  type TestSummaryRecord,
} from "../../../olt/scripts/src/testing/concurrency-lock.ts";

export function createSampleTestSummary(
  overrides: Partial<TestSummaryRecord> = {},
): TestSummaryRecord {
  return createTestSummaryRecord({
    passed_count: 10,
    failed_count: 0,
    skipped_count: 0,
    duration_ms: 100,
    coverage_percentage: 95.0,
    test_files_count: 2,
    scope: "scoped",
    agent_id: "agent-tester",
    ...overrides,
  });
}
