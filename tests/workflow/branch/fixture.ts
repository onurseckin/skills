import type {
  BranchRecord,
  BranchSubTask,
} from "../../../olt/scripts/src/core/contracts/index.ts";

export function subTask(overrides: Partial<BranchSubTask> = {}): BranchSubTask {
  return {
    id: "ST-1",
    label: "Sub task",
    write_scope: ["src/a"],
    status: "open",
    ...overrides,
  };
}

export function branchRecord(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: "B-1",
    parent_task_id: "T-1",
    parent_agent_id: "agent-1",
    reason: "needs a scoped sub-agent",
    depth: 1,
    sub_tasks: [subTask()],
    status: "open",
    opened_at: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}
