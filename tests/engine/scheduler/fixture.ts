export function createTestTask(id = "task-1", status = "ready") {
  return {
    id,
    status,
    requirement_ids: [],
    write_scope: ["src/index.ts"],
    resource_scope: [],
    dependencies: [],
  };
}

export function createTestRunState(tasks: Record<string, ReturnType<typeof createTestTask>> = {}) {
  return {
    schema: "harness.run-state",
    version: 1,
    graph: {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: Object.keys(tasks).map((id) => ({ id })),
      edges: [],
      gates: [],
    },
    requirements: [],
    tasks,
  };
}
