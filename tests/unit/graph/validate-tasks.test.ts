import { describe, expect, test } from "bun:test";
import { validateTasks } from "../../../olt/scripts/src/graph/validate-tasks.ts";

describe("graph validate tasks", () => {
  test("validates requirement_ids, write_scope, and resource_scope constraints", () => {
    const requirementIds = new Set(["R-1", "R-2"]);
    const artifactIds = new Set(["art-1"]);
    const produced = new Map<string, Set<string>>([["task-1", new Set(["art-1"])]]);

    // Non-array requirement_ids, empty write_scope, non-array resource_scope
    const invalidTasks = [
      {
        id: "task-1",
        requirement_ids: "not-an-array",
        write_scope: [],
        resource_scope: "not-array",
        status: "ready",
        priority: 10,
        effort: 3,
        created_order: 1,
      },
    ];
    const issues1: string[] = [];
    validateTasks(invalidTasks, requirementIds, artifactIds, produced, issues1);
    expect(issues1).toContain("task task-1.requirement_ids must be a list");
    expect(issues1).toContain("task task-1 must reference at least one requirement");
    expect(issues1).toContain("task task-1 must declare a non-empty write_scope");
    expect(issues1).toContain("task task-1.resource_scope must be a list");

    // Non-normalized write_scope, repeated write scope, invalid & repeated resource
    const invalidScopeTasks = [
      {
        id: "task-1",
        requirement_ids: ["R-1", "R-1", "R-UNKNOWN"],
        write_scope: ["/absolute/path", "src/valid", "src/valid"],
        resource_scope: ["invalid resource", "valid-res", "valid-res"],
        status: "ready",
        priority: 10,
        effort: 3,
        created_order: 1,
      },
    ];
    const issues2: string[] = [];
    validateTasks(invalidScopeTasks, requirementIds, artifactIds, produced, issues2);
    expect(issues2).toContain("task task-1 repeats requirement R-1");
    expect(issues2).toContain("task task-1 references unknown requirement R-UNKNOWN");
    expect(issues2).toContain("task task-1 has a non-normalized write scope");
    expect(issues2).toContain("task task-1 repeats write scope src/valid");
    expect(issues2).toContain("task task-1 has an invalid resource scope");
    expect(issues2).toContain("task task-1 repeats resource valid-res");
  });

  test("validates artifact references, status, priority, effort, and created_order", () => {
    const requirementIds = new Set(["R-1"]);
    const artifactIds = new Set(["art-1"]);
    const emptyProduced = new Map<string, Set<string>>();

    const invalidTasks = [
      {
        id: "task-1",
        requirement_ids: ["R-1"],
        write_scope: ["src/code"],
        resource_scope: [],
        artifact_ids: ["art-1", "art-1", "unknown-art"],
        status: "invalid-status",
        priority: "high",
        effort: 0,
        created_order: -1,
      },
    ];
    const issues: string[] = [];
    validateTasks(invalidTasks, requirementIds, artifactIds, emptyProduced, issues);
    expect(issues).toContain("task task-1 references unknown artifact unknown-art");
    expect(issues).toContain("task task-1 repeats artifact art-1");
    expect(issues).toContain("task task-1.status is invalid");
    expect(issues).toContain("task task-1.priority must be an integer");
    expect(issues).toContain("task task-1.effort must be between 1 and 1000000");
    expect(issues).toContain("task task-1.created_order must be a non-negative integer");

    // Task producing zero artifacts
    const zeroArtifactTask = [
      {
        id: "task-2",
        requirement_ids: ["R-1"],
        write_scope: ["src/code"],
        resource_scope: [],
        status: "ready",
        priority: 1,
        effort: 1,
        created_order: 1,
      },
    ];
    const zeroArtIssues: string[] = [];
    validateTasks(zeroArtifactTask, requirementIds, artifactIds, emptyProduced, zeroArtIssues);
    expect(zeroArtIssues).toContain("task task-2 must produce at least one artifact");
  });

  test("allows runtime statuses when allowRuntimeStatuses flag is set", () => {
    const requirementIds = new Set(["R-1"]);
    const artifactIds = new Set(["art-1"]);
    const produced = new Map<string, Set<string>>([["task-1", new Set(["art-1"])]]);

    const runningTask = [
      {
        id: "task-1",
        requirement_ids: ["R-1"],
        write_scope: ["src/code"],
        resource_scope: [],
        status: "running",
        priority: 1,
        effort: 1,
        created_order: 1,
      },
    ];

    // Disallowed by default in planning phase
    const plannableIssues: string[] = [];
    validateTasks(runningTask, requirementIds, artifactIds, produced, plannableIssues, false);
    expect(plannableIssues).toContain("task task-1.status is invalid");

    // Allowed in runtime projection
    const runtimeIssues: string[] = [];
    validateTasks(runningTask, requirementIds, artifactIds, produced, runtimeIssues, true);
    expect(runtimeIssues).toEqual([]);
  });
});
