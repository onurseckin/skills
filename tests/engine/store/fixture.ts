export function createTestDefect(dedupKey = "test_defect_1") {
  return {
    type: "validation_failure",
    severity: "high" as const,
    summary: "Test gate verification failed",
    dedup_key: dedupKey,
    details: { taskId: "task-test-01" },
  };
}

export function createTestEventPayload(note = "test event") {
  return {
    note,
    timestamp: new Date().toISOString(),
  };
}
