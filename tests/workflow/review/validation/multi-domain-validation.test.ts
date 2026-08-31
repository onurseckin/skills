import { describe, expect, test } from "bun:test";
import { applicableValidatorDomains } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../../../olt/scripts/src/graph/gate-proof.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { beginValidation } from "../../../../olt/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../../../olt/scripts/src/workflow/review/record-review.ts";
import { everyApplicableDomainPassed } from "../../../../olt/scripts/src/workflow/review/validation-state.ts";
import { submitTask } from "../../../../olt/scripts/src/workflow/submission/submit.ts";
import {
  at,
  registerCommand,
  registerTaskPacket,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "../../shared/test-port.ts";

// B12.2's own worked example, exercised concurrently rather than in isolation: `.tsx` draws
// `ui-design`, `.graphql` draws `system-design`, and every task draws `code-quality`
// unconditionally — three domains from one write scope, none of them named by a caller.
const MULTI_DOMAIN_SCOPE = ["src/owned/Widget.tsx", "src/owned/schema.graphql"];

const clock = at("2026-08-13T12:00:00.000Z");

const report = {
  summary: "done",
  requirement_ids: ["R-1"],
  files_changed: MULTI_DOMAIN_SCOPE,
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
};

function multiDomainSubmitted(): TestPort {
  const state = workflowState();
  state.tasks["T-1"]!.write_scope = MULTI_DOMAIN_SCOPE;
  const port = new TestPort(state);
  const { token } = claimTask(port, "T-1", "implementer", "implementer", { clock });
  registerTaskPacket(port, "implementer", "implementer", 1);
  submitTask(port, "T-1", "implementer", token, report, clock);
  return port;
}

const passPayload = (validatorId: string) => ({
  verdict: "pass",
  requirement_ids: ["R-1"],
  checks: [{ command_id: `C-${validatorId}` }],
  findings: [],
});

const rejectPayload = (validatorId: string, findingId: string) => ({
  ...passPayload(validatorId),
  verdict: "reject",
  findings: [
    {
      id: findingId,
      requirement_id: "R-1",
      severity: "important",
      observation: "missing test",
      evidence: [{ path: "a.ts" }],
      remediation: "add test",
      revalidation: "bun test",
      status: "open",
    },
  ],
});

function seedFalsifiableProof(port: TestPort): void {
  const record: GateProofRecord = {
    task_id: "T-1",
    gate_argv: [...TEST_GATE_ARGV],
    write_scope: MULTI_DOMAIN_SCOPE,
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-13T12:00:00.000Z",
    actor: "coordinator",
  };
  port.transact("coordinator", "gate-proved", { task_id: "T-1" }, (draft) =>
    appendGateProof(draft, record),
  );
}

/** Opens a validation and returns its bearer token, registering the command its own review cites. */
function openValidation(port: TestPort, validatorId: string, domain?: string): string {
  registerCommand(port, `C-${validatorId}`, validatorId);
  const state = beginValidation(port, "T-1", validatorId, clock, undefined, domain);
  const token = state.tasks["T-1"]!.validation_token;
  if (typeof token !== "string") throw new TypeError("validation token missing");
  registerTaskPacket(
    port,
    "validator",
    validatorId,
    state.tasks["T-1"]!.validations!.at(-1)!.attempt,
  );
  return token;
}

describe("B12.2: per-domain validation collection", () => {
  test("derivation draws every domain the write scope names, code-quality included unconditionally", () => {
    expect(applicableValidatorDomains(MULTI_DOMAIN_SCOPE)).toEqual([
      "code-quality",
      "system-design",
      "ui-design",
    ]);
  });

  test("domain omitted: successive validators each claim the next unclaimed domain, then are refused", () => {
    const port = multiDomainSubmitted();

    const first = beginValidation(port, "T-1", "validator-a", clock);
    expect(first.tasks["T-1"]!.validations!.map((v) => v.domain)).toEqual(["code-quality"]);
    expect(first.tasks["T-1"]!.status).toBe("validating");

    // The second domain validator joins the window the first already opened rather than being
    // refused as "not submitted" (the task stays "validating", it does not re-transition).
    const second = beginValidation(port, "T-1", "validator-b", clock);
    expect(second.tasks["T-1"]!.validations!.map((v) => v.domain)).toEqual([
      "code-quality",
      "system-design",
    ]);
    expect(second.tasks["T-1"]!.status).toBe("validating");

    const third = beginValidation(port, "T-1", "validator-c", clock);
    expect(third.tasks["T-1"]!.validations!.map((v) => v.domain)).toEqual([
      "code-quality",
      "system-design",
      "ui-design",
    ]);

    expect(() => beginValidation(port, "T-1", "validator-d", clock)).toThrow(
      "every validator domain applicable to T-1 already has an open validation",
    );
  });

  test("--validator-domain overrides the derivation order and still enforces applicability", () => {
    const port = multiDomainSubmitted();

    const state = beginValidation(port, "T-1", "validator-b", clock, undefined, "system-design");
    expect(state.tasks["T-1"]!.validations!.map((v) => v.domain)).toEqual(["system-design"]);

    expect(() => beginValidation(port, "T-1", "validator-x", clock, undefined, "product")).toThrow(
      "validator domain product is not applicable to T-1's write scope",
    );

    expect(() =>
      beginValidation(port, "T-1", "validator-y", clock, undefined, "made-up-domain"),
    ).toThrow("unrecognized validator domain: made-up-domain");

    expect(() =>
      beginValidation(port, "T-1", "validator-z", clock, undefined, "system-design"),
    ).toThrow("validator domain system-design already has an open validation for T-1");
  });

  test("a validator already validating the task cannot also claim a second domain on it", () => {
    const port = multiDomainSubmitted();
    beginValidation(port, "T-1", "validator-a", clock);
    expect(() =>
      beginValidation(port, "T-1", "validator-a", clock, undefined, "system-design"),
    ).toThrow("validator must be independent from implementers");
  });

  test("the task reaches validated only once every domain it drew has its own pass on record", () => {
    const port = multiDomainSubmitted();
    const tokenA = openValidation(port, "validator-a"); // code-quality
    const tokenB = openValidation(port, "validator-b"); // system-design
    const tokenC = openValidation(port, "validator-c"); // ui-design
    seedFalsifiableProof(port);

    let state = recordReview(
      port,
      "T-1",
      "validator-a",
      { ...passPayload("validator-a"), validation_token: tokenA },
      clock,
    );
    expect(state.tasks["T-1"]!.status).toBe("validating");
    expect(everyApplicableDomainPassed(state.tasks["T-1"]!)).toBe(false);

    state = recordReview(
      port,
      "T-1",
      "validator-b",
      { ...passPayload("validator-b"), validation_token: tokenB },
      clock,
    );
    expect(state.tasks["T-1"]!.status).toBe("validating");
    expect(everyApplicableDomainPassed(state.tasks["T-1"]!)).toBe(false);

    state = recordReview(
      port,
      "T-1",
      "validator-c",
      { ...passPayload("validator-c"), validation_token: tokenC },
      clock,
    );
    expect(state.tasks["T-1"]!.status).toBe("validated");
    expect(everyApplicableDomainPassed(state.tasks["T-1"]!)).toBe(true);
    expect(state.tasks["T-1"]!.validations).toHaveLength(3);
  });

  test("a reject from one domain ends the round for every domain still open", () => {
    const port = multiDomainSubmitted();
    const tokenA = openValidation(port, "validator-a"); // code-quality
    const tokenB = openValidation(port, "validator-b"); // system-design
    openValidation(port, "validator-c"); // ui-design, left open deliberately

    const state = recordReview(
      port,
      "T-1",
      "validator-b",
      { ...rejectPayload("validator-b", "F-multi"), validation_token: tokenB },
      clock,
    );
    expect(state.tasks["T-1"]!.status).toBe("changes_requested");
    expect(state.tasks["T-1"]!.validations ?? []).toHaveLength(0);
    expect(state.tasks["T-1"]!.validation_history).toHaveLength(3);
    // One reject is one repair round, not one round per domain that happened to be open.
    expect(state.tasks["T-1"]!.repair_round).toBe(1);
    expect(
      state.tasks["T-1"]!.validation_history!.map((entry) => entry.validator_id).sort(),
    ).toEqual(["validator-a", "validator-b", "validator-c"]);

    // validator-a's still-in-flight pass no longer names a live validation on the task: it was
    // archived along with the domain that rejected, not left dangling as live state.
    expect(() =>
      recordReview(
        port,
        "T-1",
        "validator-a",
        { ...passPayload("validator-a"), validation_token: tokenA },
        clock,
      ),
    ).toThrow("validator does not own the current validation");
  });
});
