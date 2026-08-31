import { describe, expect, test } from "bun:test";
import { applicableValidatorDomains } from "../../olt/scripts/src/core/contracts/index.ts";
import { claimTask } from "../../olt/scripts/src/workflow/lease/claim.ts";
import { finishTask } from "../../olt/scripts/src/workflow/gates/finish-task.ts";
import { attachGateResult } from "../../olt/scripts/src/workflow/gates/attach-result.ts";
import { beginValidation } from "../../olt/scripts/src/workflow/review/begin-validation.ts";
import { recordReview } from "../../olt/scripts/src/workflow/review/record-review.ts";
import { everyApplicableDomainPassed } from "../../olt/scripts/src/workflow/review/validation-state.ts";
import { submitTask } from "../../olt/scripts/src/workflow/submission/submit.ts";
import {
  appendGateProof,
  type GateProofRecord,
} from "../../olt/scripts/src/graph/gate-proof.ts";
import {
  at,
  registerCommand,
  registerTaskPacket,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";

const clock = at("2026-08-20T12:00:00.000Z");

const UI_WRITE_SCOPE = ["src/components/App.tsx"];
const NON_UI_WRITE_SCOPE = ["src/utils/math.ts"];

const reportFor = (scope: string[]) => ({
  summary: "Implemented features and added tests",
  requirement_ids: ["R-1"],
  files_changed: scope,
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff" }],
});

const passPayload = (validatorId: string) => ({
  verdict: "pass" as const,
  requirement_ids: ["R-1"],
  checks: [{ command_id: `C-${validatorId}` }],
  findings: [],
});

function seedFalsifiableProof(port: TestPort, writeScope: string[]): void {
  const record: GateProofRecord = {
    task_id: "T-1",
    gate_argv: [...TEST_GATE_ARGV],
    write_scope: writeScope,
    base: "HEAD",
    falsifiable: true,
    exit_code: 1,
    timed_out: false,
    proved_at: "2026-08-20T12:00:00.000Z",
    actor: "coordinator",
  };
  port.transact("coordinator", "gate-proved", { task_id: "T-1" }, (draft) =>
    appendGateProof(draft, record),
  );
}

function openValidation(port: TestPort, validatorId: string, domain?: string): string {
  registerCommand(port, `C-${validatorId}`, validatorId, { gate_id: "G-1" });
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

describe("Harness Dual-Validation Hardening & Mandatory Validator Pairing", () => {
  describe("1. everyApplicableDomainPassed predicate", () => {
    test("single-domain task passes once code-quality is verified", () => {
      const state = workflowState();
      state.tasks["T-1"]!.write_scope = NON_UI_WRITE_SCOPE;
      const task = state.tasks["T-1"]!;

      expect(applicableValidatorDomains(task.write_scope)).toEqual(["code-quality"]);
      expect(everyApplicableDomainPassed(task)).toBe(false);

      task.validations = [
        {
          validator_id: "validator-mechanic",
          domain: "code-quality",
          token_digest: "digest",
          attempt: 1,
          started_at: "2026-08-20T12:00:00.000Z",
          verdict: "pass",
        },
      ];

      expect(everyApplicableDomainPassed(task)).toBe(true);
    });

    test("dual-domain task (UI scope) rejects single sign-off and requires both domains", () => {
      const state = workflowState();
      state.tasks["T-1"]!.write_scope = UI_WRITE_SCOPE;
      const task = state.tasks["T-1"]!;

      expect(applicableValidatorDomains(task.write_scope)).toEqual(["code-quality", "ui-design"]);

      // 1. No validations -> false
      expect(everyApplicableDomainPassed(task)).toBe(false);

      // 2. Only mechanic validator (code-quality) passed -> still false!
      task.validations = [
        {
          validator_id: "validator-mechanic",
          domain: "code-quality",
          token_digest: "digest-1",
          attempt: 1,
          started_at: "2026-08-20T12:00:00.000Z",
          verdict: "pass",
        },
      ];
      expect(everyApplicableDomainPassed(task)).toBe(false);

      // 3. Only cognitive / UI validator passed -> still false!
      task.validations = [
        {
          validator_id: "validator-ui",
          domain: "ui-design",
          token_digest: "digest-2",
          attempt: 1,
          started_at: "2026-08-20T12:00:00.000Z",
          verdict: "pass",
        },
      ];
      expect(everyApplicableDomainPassed(task)).toBe(false);

      // 4. BOTH independent validators have passed -> true!
      task.validations = [
        {
          validator_id: "validator-mechanic",
          domain: "code-quality",
          token_digest: "digest-1",
          attempt: 1,
          started_at: "2026-08-20T12:00:00.000Z",
          verdict: "pass",
        },
        {
          validator_id: "validator-ui",
          domain: "ui-design",
          token_digest: "digest-2",
          attempt: 1,
          started_at: "2026-08-20T12:00:00.000Z",
          verdict: "pass",
        },
      ];
      expect(everyApplicableDomainPassed(task)).toBe(true);
    });

    test("dual-domain task triggered by requirement text signals UI domain", () => {
      const state = workflowState();
      state.tasks["T-1"]!.write_scope = NON_UI_WRITE_SCOPE; // .ts file
      const task = state.tasks["T-1"]!;
      const reqTexts = ["Build interactive visual UI dashboard component"];

      expect(applicableValidatorDomains(task.write_scope, reqTexts)).toEqual([
        "code-quality",
        "ui-design",
      ]);

      task.validations = [
        {
          validator_id: "validator-mechanic",
          domain: "code-quality",
          token_digest: "digest-1",
          attempt: 1,
          started_at: "2026-08-20T12:00:00.000Z",
          verdict: "pass",
        },
      ];

      // With reqTexts, requires both code-quality and ui-design
      expect(everyApplicableDomainPassed(task, reqTexts)).toBe(false);

      task.validations.push({
        validator_id: "validator-ui",
        domain: "ui-design",
        token_digest: "digest-2",
        attempt: 1,
        started_at: "2026-08-20T12:00:00.000Z",
        verdict: "pass",
      });

      expect(everyApplicableDomainPassed(task, reqTexts)).toBe(true);
    });
  });

  describe("2. finishTask enforcement of dual-validation", () => {
    test("refuses to finish a UI task when only code-quality validator has signed off", () => {
      const state = workflowState();
      state.tasks["T-1"]!.write_scope = UI_WRITE_SCOPE;
      const port = new TestPort(state);
      const { token } = claimTask(port, "T-1", "implementer-1", "implementer", { clock });
      registerTaskPacket(port, "implementer", "implementer-1", 1);
      submitTask(port, "T-1", "implementer-1", token, reportFor(UI_WRITE_SCOPE), clock);

      // Start validation for mechanic validator (code-quality)
      const tokenMech = openValidation(port, "validator-mechanic", "code-quality");
      seedFalsifiableProof(port, UI_WRITE_SCOPE);

      const reviewState = recordReview(
        port,
        "T-1",
        "validator-mechanic",
        { ...passPayload("validator-mechanic"), validation_token: tokenMech },
        clock,
      );

      // Task must remain in 'validating', NOT 'validated'
      expect(reviewState.tasks["T-1"]!.status).toBe("validating");

      // Attempting to finish must be rejected
      expect(() => finishTask(port, "T-1", "coordinator", clock)).toThrow(
        "only validated or gating tasks can finish",
      );
    });

    test("successfully finishes once both mechanic and cognitive UI validators sign off", () => {
      const state = workflowState();
      state.tasks["T-1"]!.write_scope = UI_WRITE_SCOPE;
      const port = new TestPort(state);
      const { token } = claimTask(port, "T-1", "implementer-1", "implementer", { clock });
      registerTaskPacket(port, "implementer", "implementer-1", 1);
      submitTask(port, "T-1", "implementer-1", token, reportFor(UI_WRITE_SCOPE), clock);

      const tokenMech = openValidation(port, "validator-mechanic", "code-quality");
      const tokenUi = openValidation(port, "validator-ui", "ui-design");
      seedFalsifiableProof(port, UI_WRITE_SCOPE);

      // Mechanic validator passes
      let reviewState = recordReview(
        port,
        "T-1",
        "validator-mechanic",
        { ...passPayload("validator-mechanic"), validation_token: tokenMech },
        clock,
      );
      expect(reviewState.tasks["T-1"]!.status).toBe("validating");

      // Cognitive UI validator passes
      reviewState = recordReview(
        port,
        "T-1",
        "validator-ui",
        { ...passPayload("validator-ui"), validation_token: tokenUi },
        clock,
      );
      expect(reviewState.tasks["T-1"]!.status).toBe("validated");

      // Attach gate result
      registerCommand(port, "C-GATE", "validator-mechanic", { gate_id: "G-1" });
      attachGateResult(port, "T-1", "G-1", "C-GATE", "coordinator", clock);

      // Now finishTask succeeds
      const finishResult = finishTask(port, "T-1", "coordinator", clock);
      expect(finishResult.tasks["T-1"]!.status).toBe("done");
      expect(finishResult.requirements[0]?.status).toBe("satisfied");
    });
  });

  describe("3. submitTask confinement", () => {
    test("rejects submission by supervisor roles", () => {
      const state = workflowState();
      const port = new TestPort(state);
      const { token } = claimTask(port, "T-1", "coordinator-1", "implementer", { clock });
      registerTaskPacket(port, "implementer", "coordinator-1", 1);

      expect(() =>
        submitTask(port, "T-1", "coordinator-1", token, reportFor(NON_UI_WRITE_SCOPE), clock),
      ).toThrow("Supervisors");
    });
  });
});
