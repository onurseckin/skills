import { describe, expect, test } from "bun:test";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { recoverStale } from "../../../../olt/scripts/src/workflow/lease/recover-stale.ts";
import { releaseLease } from "../../../../olt/scripts/src/workflow/lease/release.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import { recordAuthorityDecision } from "../../../../olt/scripts/src/workflow/authority/index.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "../../shared/test-port.ts";

const start = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "implemented",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff", path: "src/owned/a.ts" }],
};

describe("lease policy", () => {
  test("snapshots write and resource scopes into the lease", () => {
    const state = workflowState();
    state.tasks["T-1"]!.resource_scope = ["db:test"];
    const port = new TestPort(state);
    const claimed = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    expect(claimed.state.tasks["T-1"]!.lease!.write_scope).toEqual(["src/owned"]);
    expect(claimed.state.tasks["T-1"]!.lease!.resource_scope).toEqual(["db:test"]);
  });

  test("never claims a proposed task", () => {
    const state = workflowState();
    state.tasks["T-1"]!.status = "proposed";
    expect(() =>
      claimTask(new TestPort(state), "T-1", "agent", "implementer", { clock: start }),
    ).toThrow();
  });

  test("direct claim cannot bypass requirement authority", () => {
    const state = workflowState();
    delete state.requirements[0]!.disposition;
    expect(() =>
      claimTask(new TestPort(state), "T-1", "agent", "implementer", { clock: start }),
    ).toThrow("task requirements are not authorized");

    const missingDocument = workflowState();
    missingDocument.requirements = [];
    expect(() =>
      claimTask(new TestPort(missingDocument), "T-1", "agent", "implementer", { clock: start }),
    ).toThrow("task requirements are not authorized");

    state.requirements[0]!.disposition = "needs_authority";
    expect(() =>
      claimTask(new TestPort(state), "T-1", "agent", "implementer", { clock: start }),
    ).toThrow("task requirements are not authorized");

    state.requirements[0]!.disposition = "actionable";
    state.requirements[0]!.dependencies = ["R-2"];
    state.requirements.push({
      id: "R-2",
      status: "planned",
      evidence: [],
      disposition: "needs_authority",
      dependencies: [],
    });
    expect(() =>
      claimTask(new TestPort(state), "T-1", "agent", "implementer", { clock: start }),
    ).toThrow("task requirements are not authorized");
  });

  test("direct claim uses the scheduler rule for mixed declined requirements", () => {
    const state = workflowState();
    state.requirements.push({
      id: "R-2",
      status: "planned",
      evidence: [],
      disposition: "needs_authority",
      dependencies: [],
    });
    state.tasks["T-1"]!.requirement_ids = ["R-1", "R-2"];
    const port = new TestPort(state);
    recordAuthorityDecision(
      port,
      "R-2",
      "coordinator",
      { decision: "decline", rationale: "The user declined this optional authority." },
      start,
    );

    expect(() => claimTask(port, "T-1", "agent", "implementer", { clock: start })).not.toThrow();
  });

  test("direct claim cannot bypass active write or resource ownership", () => {
    const base = workflowState();
    base.requirements[0]!.disposition = "actionable";
    base.requirements[0]!.dependencies = [];
    base.tasks["T-active"] = {
      ...structuredClone(base.tasks["T-1"]!),
      id: "T-active",
      status: "running",
      write_scope: ["src/owned/child"],
      resource_scope: [],
    };
    expect(() =>
      claimTask(new TestPort(base), "T-1", "agent", "implementer", { clock: start }),
    ).toThrow("active ownership conflict");

    const resource = workflowState();
    resource.requirements[0]!.disposition = "actionable";
    resource.requirements[0]!.dependencies = [];
    resource.tasks["T-1"]!.resource_scope = ["database:test"];
    resource.tasks["T-active"] = {
      ...structuredClone(resource.tasks["T-1"]!),
      id: "T-active",
      status: "validating",
      write_scope: ["src/independent"],
      resource_scope: ["database:test"],
    };
    expect(() =>
      claimTask(new TestPort(resource), "T-1", "agent", "implementer", { clock: start }),
    ).toThrow("active ownership conflict");
  });

  test("waits for expiry grace before stale recovery", () => {
    const port = new TestPort(workflowState());
    claimTask(port, "T-1", "agent", "implementer", { leaseSeconds: 5, clock: start });
    recoverStale(port, "coordinator", at("2026-08-13T12:00:06.000Z"), { graceSeconds: 30 });
    expect(port.read().tasks["T-1"]!.status).toBe("leased");
    recoverStale(port, "coordinator", at("2026-08-13T12:00:36.000Z"), { graceSeconds: 30 });
    expect(port.read().tasks["T-1"]!.status).toBe("retry_ready");
  });

  test("preserves a late correct-token report after stale recovery", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      leaseSeconds: 5,
      clock: start,
    });
    registerTaskPacket(port, "implementer", "agent", 1);
    recoverStale(port, "coordinator", at("2026-08-13T12:00:36.000Z"), { graceSeconds: 30 });
    const result = submitTask(port, "T-1", "agent", token, report, at("2026-08-13T12:00:37.000Z"));
    expect(result.orphaned).toBeTrue();
    expect(result.state.tasks["T-1"]!.status).toBe("retry_ready");
    expect(result.state.orphan_evidence).toHaveLength(1);
  });

  test("only the current identity and token can release a lease", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    expect(() => releaseLease(port, "T-1", "agent", "wrong", start)).toThrow();
    expect(() => releaseLease(port, "T-1", "other", token, start)).toThrow();
    const state = releaseLease(port, "T-1", "agent", token, start);
    expect(state.tasks["T-1"]!.status).toBe("retry_ready");
    expect(state.tasks["T-1"]!.lease).toBeUndefined();
  });
});
