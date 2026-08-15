import { describe, expect, test } from "bun:test";
import {
  leasedActions,
  validationActions,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/active-actions.ts";
import { taskActions } from "../../../orchestrating-long-tasks/scripts/src/reporting/task-actions.ts";
import type {
  GateView,
  PacketView,
  TaskView,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/action-types.ts";

describe("reporting actions generators", () => {
  test("leasedActions handles existing packet and missing packet", () => {
    const prefix = ["bun", "harness.ts"];
    const runRoot = "/path/to/run";
    const task: TaskView = {
      id: "task-1",
      status: "leased",
      owner: "worker-1",
      role: "implementer",
      attempt: 1,
      gate_results: [],
    };

    // No matching packet -> includes packet command
    const actionsWithoutPacket = leasedActions(prefix, runRoot, task, []);
    expect(actionsWithoutPacket.some((cmd) => cmd.includes("packet"))).toBe(true);
    expect(actionsWithoutPacket.some((cmd) => cmd.includes("heartbeat"))).toBe(true);
    expect(actionsWithoutPacket.some((cmd) => cmd.includes("submit"))).toBe(true);

    // Matching packet exists -> omits packet command
    const matchingPacket: PacketView = {
      id: "P-1",
      task_id: "task-1",
      agent_id: "worker-1",
      role: "implementer",
      attempt: 1,
      packet_sha256: "sha-1",
    };
    const actionsWithPacket = leasedActions(prefix, runRoot, task, [matchingPacket]);
    expect(actionsWithPacket.some((cmd) => cmd.includes("packet"))).toBe(false);
    expect(actionsWithPacket.some((cmd) => cmd.includes("heartbeat"))).toBe(true);
    expect(actionsWithPacket.some((cmd) => cmd.includes("submit"))).toBe(true);
  });

  test("validationActions handles existing packet and missing packet", () => {
    const prefix = ["bun", "harness.ts"];
    const runRoot = "/path/to/run";
    const task: TaskView = {
      id: "task-1",
      status: "validating",
      validation: { validator_id: "val-1", attempt: 1 },
      gate_results: [],
    };

    // No matching packet -> includes packet command
    const actionsWithoutPacket = validationActions(prefix, runRoot, task, []);
    expect(actionsWithoutPacket.some((cmd) => cmd.includes("packet"))).toBe(true);
    expect(actionsWithoutPacket.some((cmd) => cmd.includes("review"))).toBe(true);

    // Matching packet exists -> omits packet command
    const matchingPacket: PacketView = {
      id: "P-VAL-1",
      task_id: "task-1",
      agent_id: "val-1",
      role: "validator",
      attempt: 1,
      packet_sha256: "sha-val",
    };
    const actionsWithPacket = validationActions(prefix, runRoot, task, [matchingPacket]);
    expect(actionsWithPacket.some((cmd) => cmd.includes("packet"))).toBe(false);
    expect(actionsWithPacket.some((cmd) => cmd.includes("review"))).toBe(true);
  });

  test("taskActions generates appropriate commands across all task statuses", () => {
    const prefix = ["bun", "harness.ts"];
    const runRoot = "/path/to/run";
    const gates: GateView[] = [
      {
        id: "gate-1",
        scope: "task",
        command: ["bun", "test"],
        cwd: ".",
        requirement_ids: ["R-1"],
        mandatory: true,
      },
    ];

    // Status: ready & retry_ready
    const readyTask: TaskView = { id: "t1", status: "ready", gate_results: [] };
    expect(taskActions(prefix, runRoot, readyTask, gates, [])[0]).toContain("claim");

    const retryTask: TaskView = {
      id: "t1",
      status: "retry_ready",
      original_implementer: "orig-worker",
      gate_results: [],
    };
    expect(taskActions(prefix, runRoot, retryTask, gates, [])[0]).toContain("orig-worker");

    // Status: changes_requested
    const crTask: TaskView = {
      id: "t1",
      status: "changes_requested",
      repair_assignee: "rep-1",
      gate_results: [],
    };
    expect(taskActions(prefix, runRoot, crTask, gates, [])[0]).toContain("rep-1");

    // Status: submitted
    const subTask: TaskView = { id: "t1", status: "submitted", gate_results: [] };
    expect(taskActions(prefix, runRoot, subTask, gates, [])[0]).toContain("begin-validation");

    // Status: validated
    const valTask: TaskView = {
      id: "t1",
      status: "validated",
      requirement_ids: ["R-1"],
      gate_results: [],
    };
    const valActions = taskActions(prefix, runRoot, valTask, gates, []);
    expect(valActions.some((cmd) => cmd.includes("gate"))).toBe(true);

    // Status: gating
    const gatingTask: TaskView = { id: "t1", status: "gating", gate_results: [] };
    expect(taskActions(prefix, runRoot, gatingTask, gates, [])[0]).toContain("finish");
  });
});
