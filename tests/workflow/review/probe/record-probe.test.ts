import { describe, expect, test } from "bun:test";
import {
  recordProbe,
  validateProbe,
} from "../../../../olt/scripts/src/workflow/review/record-probe.ts";
import { at, TestPort, workflowState } from "../../shared/test-port.ts";
import type { TransactionPort, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";

describe("validateProbe", () => {
  test("rejects a non-object probe value (null, array, primitive)", () => {
    expect(() => validateProbe(null)).toThrow(/probe must be an object/);
    expect(() => validateProbe([])).toThrow(/probe must be an object/);
    expect(() => validateProbe("nope")).toThrow(/probe must be an object/);
    expect(() => validateProbe(42)).toThrow(/probe must be an object/);
  });

  test("rejects a probe with no findings", () => {
    expect(() => validateProbe({ findings: [] })).toThrow(/a probe requires at least one demand/);
    expect(() => validateProbe({})).toThrow(/a probe requires at least one demand/);
  });

  test("accepts and copies a probe carrying at least one finding", () => {
    const findings = [{ id: "F-1" }];
    const probe = validateProbe({ findings });
    expect(probe.findings).toEqual(findings);
    expect(probe.findings).not.toBe(findings);
  });
});

describe("recordProbe: concurrent-mutation guard", () => {
  test("rejects when the probe round advanced between the read that computed it and the transaction", () => {
    const state = workflowState();
    Object.assign(state.tasks["T-1"]!, {
      status: "validating",
      validations: [
        {
          validator_id: "validator",
          domain: "code-quality",
          token_digest: tokenDigest("tok"),
          attempt: 1,
          started_at: "2026-08-13T12:00:00.000Z",
          deadline_at: "2026-08-13T13:00:00.000Z",
        },
      ],
    });
    const port = new TestPort(state);
    const clock = at("2026-08-13T12:30:00.000Z");
    const demand = (id: string) => ({
      id,
      requirement_id: "R-1",
      severity: "minor" as const,
      class: "probe_demand" as const,
      evidence: [{ note: "adversarial probe demand" }],
      observation: "prove it",
      remediation: "address the demand",
      revalidation: "re-run the gate",
    });
    // A first, real probe advances the underlying state's probe_round to 1.
    recordProbe(
      port,
      "T-1",
      "validator",
      { findings: [demand("F-1")], validation_token: "tok" },
      clock,
    );

    // A port whose read() hands back a snapshot from BEFORE that advance (as if computed
    // concurrently), while transact() still operates on the real, now-advanced state — the same
    // shape a genuine race would produce.
    const staleSnapshot: WorkflowState = structuredClone(state);
    (staleSnapshot.tasks["T-1"] as { probe_round?: number }).probe_round = 0;
    const stalePort: TransactionPort = {
      read: () => staleSnapshot,
      transact: (...args) => port.transact(...args),
    };

    expect(() =>
      recordProbe(
        stalePort,
        "T-1",
        "validator",
        { findings: [demand("F-2")], validation_token: "tok" },
        clock,
      ),
    ).toThrow(/probe round changed during the transaction/);
  });
});
