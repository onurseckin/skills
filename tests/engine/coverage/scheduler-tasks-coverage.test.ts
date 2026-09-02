import { describe, expect, it } from "bun:test";
import {
  boundedEvidenceCause,
  probeOrphanedTasks,
  probeStaleLeases,
} from "../../../olt/scripts/src/engine/scheduler/core/tasks/tasks.ts";

describe("scheduler-tasks-coverage", () => {
  it("bounds and normalizes error evidence causes across all types and edge cases", () => {
    expect(boundedEvidenceCause("Short error")).toBe("Short error");
    expect(boundedEvidenceCause("A".repeat(300))).toBe("A".repeat(240));
    expect(boundedEvidenceCause(404)).toBe("404");
    expect(boundedEvidenceCause(true)).toBe("true");
    expect(boundedEvidenceCause(123n)).toBe("123");
    expect(boundedEvidenceCause(Symbol("test"))).toBe("Symbol(test)");
    expect(boundedEvidenceCause(null)).toBe("null");
    expect(boundedEvidenceCause(undefined)).toBe("undefined");

    expect(boundedEvidenceCause({ message: "Custom object error" })).toBe("Custom object error");
    expect(boundedEvidenceCause({ message: "B".repeat(300) })).toBe("B".repeat(240));
    expect(boundedEvidenceCause({ message: 123 })).toBe("unknown error");
    expect(boundedEvidenceCause(Object.create({ message: "proto error" }))).toBe("unknown error");

    const throwingGetter = {};
    Object.defineProperty(throwingGetter, "message", {
      get() {
        throw new Error("Getter error");
      },
    });
    expect(boundedEvidenceCause(throwingGetter)).toBe("unknown error");
  });

  it("handles probeOrphanedTasks with invalid state and record validation", () => {
    const resInvalidState = probeOrphanedTasks(null);
    expect(resInvalidState.passed).toBe(false);
    expect(resInvalidState.details[0]).toContain("State has no valid tasks record.");

    const resNoTasks = probeOrphanedTasks({ tasks: "not-a-record" });
    expect(resNoTasks.passed).toBe(false);

    const resEmpty = probeOrphanedTasks({ tasks: {} });
    expect(resEmpty.passed).toBe(true);

    const resMalformedTask = probeOrphanedTasks({ tasks: { "t-bad": null } });
    expect(resMalformedTask.passed).toBe(false);
    expect(resMalformedTask.orphanedTaskIds).toContain("t-bad");

    const resNonArrayReqs = probeOrphanedTasks({
      requirements: { not_requirements: true },
      tasks: { "t-no-deps": { requirement_ids: [] } },
    });
    expect(resNonArrayReqs.passed).toBe(false);
  });

  it("probes orphaned tasks across requirement sources and unmapped checks", () => {
    const stateWithObjectReqs = {
      requirements: { requirements: [{ id: "req-1" }, { id: 123 }, null] },
      tasks: {
        "t-no-req": { requirement_ids: [] },
        "t-unknown-req": { requirement_ids: ["req-missing"] },
        "t-valid": { requirement_ids: ["req-1"] },
      },
    };
    const res1 = probeOrphanedTasks(stateWithObjectReqs);
    expect(res1.orphanedTaskIds).toContain("t-no-req");
    expect(res1.orphanedTaskIds).toContain("t-unknown-req");
    expect(res1.unmappedRequirementTaskIds).toEqual(["t-no-req", "t-unknown-req"]);
    expect(res1.orphanedTaskIds).not.toContain("t-valid");

    const stateWithArrayReqs = {
      requirements: [{ id: "req-2" }, "invalid"],
      tasks: {
        "t-valid-2": { requirement_ids: ["req-2"] },
      },
    };
    const res2 = probeOrphanedTasks(stateWithArrayReqs);
    expect(res2.passed).toBe(true);
  });

  it("probes disconnected and orphaned tasks using graph nodes", () => {
    const stateWithGraph = {
      requirements: { requirements: [{ id: "req-g1" }] },
      graph: {
        nodes: [
          { type: "requirement", requirement_id: "req-g2" },
          { type: "task", id: "t-in-graph" },
          { type: "other", id: "t-other" },
        ],
      },
      tasks: {
        "t-in-graph": { requirement_ids: ["req-g1"] },
        "t-missing-from-graph": { requirement_ids: ["req-g2"] },
        "t-both-orphaned": { requirement_ids: ["unknown-req"] },
      },
    };
    const res = probeOrphanedTasks(stateWithGraph);
    expect(res.passed).toBe(false);
    expect(res.disconnectedTaskIds).toContain("t-missing-from-graph");
    expect(res.disconnectedTaskIds).toContain("t-both-orphaned");
    expect(res.orphanedTaskIds).toContain("t-missing-from-graph");
    expect(res.orphanedTaskIds).toContain("t-both-orphaned");
  });

  it("handles probeStaleLeases invalid states, explicit stale tasks, and ignored statuses", () => {
    expect(probeStaleLeases(null).passed).toBe(true);
    expect(probeStaleLeases({ tasks: "invalid" }).passed).toBe(true);

    const state = {
      tasks: {
        "t-invalid": null,
        "t-explicit-stale": { status: "stale" },
        "t-pending-ignored": {
          status: "pending",
          lease: { expires_at: "2020-01-01T00:00:00.000Z" },
        },
        "t-no-lease-record": { status: "leased", lease: null },
      },
    };
    const res = probeStaleLeases(state);
    expect(res.passed).toBe(false);
    expect(res.staleTaskIds).toEqual(["t-explicit-stale"]);
    expect(res.details[0]).toContain("is explicitly marked stale");
  });

  it("detects expired timestamps and heartbeat timeouts on active leases", () => {
    const fixedNow = "2026-09-01T12:00:00.000Z";
    const state = {
      tasks: {
        "t-expired": {
          status: "leased",
          lease: {
            expires_at: "2026-09-01T11:00:00.000Z",
            heartbeat_at: "2026-09-01T11:59:00.000Z",
            issued_at: "2026-09-01T10:00:00.000Z",
            agent_id: "agent-1",
            role: "worker",
            duration_seconds: 600,
          },
        },
        "t-heartbeat-timeout": {
          status: "running",
          lease: {
            expires_at: "2026-09-01T13:00:00.000Z",
            heartbeat_at: "2026-09-01T11:00:00.000Z",
          },
        },
        "t-healthy": {
          status: "validating",
          lease: {
            expires_at: "2026-09-01T13:00:00.000Z",
            heartbeat_at: "2026-09-01T11:59:00.000Z",
          },
        },
      },
    };

    const res = probeStaleLeases(state, { now: fixedNow, timeoutMs: 300_000 });
    expect(res.passed).toBe(false);
    expect(res.staleTaskIds).toEqual(["t-expired", "t-heartbeat-timeout"]);

    const expiredLease = res.staleLeases.find((l) => l.taskId === "t-expired");
    expect(expiredLease?.reason).toBe("expired_timestamp");
    expect(expiredLease?.agentId).toBe("agent-1");
    expect(expiredLease?.role).toBe("worker");
    expect(expiredLease?.overdueMs).toBe(3600000);

    const hbLease = res.staleLeases.find((l) => l.taskId === "t-heartbeat-timeout");
    expect(hbLease?.reason).toBe("heartbeat_timeout");
    expect(hbLease?.agentId).toBe("unknown");
    expect(hbLease?.role).toBe("unknown");
    expect(hbLease?.durationSeconds).toBe(300);
  });
});
