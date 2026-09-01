import type {
  NewTaskQueueInput,
  TaskQueueItem,
} from "../../../olt/scripts/src/task/queue/index.ts";

export function createSampleQueueItemInput(
  overrides: Partial<NewTaskQueueInput> = {},
): NewTaskQueueInput {
  return {
    taskId: "task-test-01",
    role: "implementer",
    priority: "high",
    effort: 3,
    title: "Implement task subsystem",
    description: "Build robust in-memory task queue",
    ...overrides,
  };
}

export function createSampleActiveQueueItem(overrides: Partial<TaskQueueItem> = {}): TaskQueueItem {
  return {
    taskId: "task-active-01",
    role: "implementer",
    priority: "high",
    status: "ready",
    effort: 2,
    retries: 0,
    maxRetries: 3,
    blockedBy: [],
    dependents: [],
    history: [],
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
