import { describe, expect, test } from "bun:test";
import { claimTask } from "../../orchestrating-long-tasks/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../orchestrating-long-tasks/scripts/src/workflow/submission/submit.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "implemented",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed", evidence: "command:C-1" }],
  evidence: [{ kind: "diff", path: "src/owned/a.ts" }],
};

describe("workflow submissions", () => {
  test("accepts scoped evidence under a current lease", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    const result = submitTask(port, "T-1", "agent", token, report, at("2026-08-13T12:01:00.000Z"));
    expect(result.orphaned).toBeFalse();
    expect(result.state.tasks["T-1"]!.status).toBe("submitted");
    expect(result.state.tasks["T-1"]!.lease).toBeUndefined();
  });

  test("rejects out-of-scope and malformed reports without mutation", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    const before = port.read();
    expect(() =>
      submitTask(
        port,
        "T-1",
        "agent",
        token,
        { ...report, files_changed: ["src/other/a.ts"] },
        start,
      ),
    ).toThrow();
    expect(port.read()).toEqual(before);
    expect(() => submitTask(port, "T-1", "agent", token, [], start)).toThrow();
  });

  test("requires nonempty substantive checks and evidence", () => {
    for (const invalid of [
      { ...report, checks: [] },
      { ...report, checks: [{}] },
      { ...report, evidence: [] },
      { ...report, evidence: [{}] },
    ]) {
      const port = new TestPort(workflowState());
      const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
      registerTaskPacket(port, "implementer", "agent", 1);
      expect(() => submitTask(port, "T-1", "agent", token, invalid, start)).toThrow();
    }
  });

  test("preserves expired correct-token reports only as orphan evidence", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      leaseSeconds: 5,
      clock: start,
    });
    registerTaskPacket(port, "implementer", "agent", 1);
    const result = submitTask(port, "T-1", "agent", token, report, at("2026-08-13T12:00:06.000Z"));
    expect(result.orphaned).toBeTrue();
    expect(result.state.tasks["T-1"]!.status).toBe("leased");
    expect(result.state.orphan_evidence).toHaveLength(1);
    expect(JSON.stringify(result.state.orphan_evidence)).not.toContain(token);
  });

  test("wrong tokens create no orphan evidence", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent", "implementer", { leaseSeconds: 5, clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);
    expect(() =>
      submitTask(port, "T-1", "agent", "wrong", report, at("2026-08-13T12:00:06.000Z")),
    ).toThrow();
    expect(port.read().orphan_evidence).toEqual([]);
  });

  test("refuses submission without matching durable packet authority", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    expect(() => submitTask(port, "T-1", "agent", token, report, start)).toThrow();
  });
});
