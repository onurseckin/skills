import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  authorityAuditIssues,
  authorizedRequirementIds,
  recordAuthorityDecision,
  requirementExecutionState,
  type AuthorityDecisionInput,
  type AuthorityDecisionRecord,
} from "../../../../olt/scripts/src/workflow/authority/index.ts";
import { decisionHistory } from "../../../../olt/scripts/src/workflow/authority/decision-record.ts";
import { claimTask } from "../../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "../../shared/test-port.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

const clock = at("2026-08-13T12:00:00.000Z");

function pendingPort(): TestPort {
  const state = workflowState();
  state.requirements[0]!.disposition = "needs_authority";
  state.requirements[0]!.dependencies = [];
  return new TestPort(state);
}

describe("authority decision recording", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("an exact retry returns durable evidence without replaying the decision event", () => {
    const port = pendingPort();
    const input = { decision: "grant" as const, rationale: "The user approved this change." };
    const first = recordAuthorityDecision(port, "R-1", "coordinator", input, clock);
    const eventCount = port.events.length;
    const retried = recordAuthorityDecision(
      port,
      "R-1",
      "coordinator",
      input,
      at("2026-08-13T12:05:00.000Z"),
    );
    expect(retried).toEqual(first);
    expect(port.events).toHaveLength(eventCount);
  });

  test("authorityAuditIssues detects all validation error branches", () => {
    // Invalid status
    expect(
      authorityAuditIssues({ id: "R-1", authority_status: "invalid_status" as "granted" }),
    ).toEqual(["authority_status is invalid"]);

    // Invalid history shape
    expect(
      authorityAuditIssues({ id: "R-1", authority_status: "granted", authority_history: [] }),
    ).toEqual(["authority_history must contain exactly one decision record"]);

    // Non-string actor
    expect(
      authorityAuditIssues({
        id: "R-1",
        authority_status: "granted",
        authority_history: [
          {
            requirement_id: "R-1",
            decision: "grant",
            prior_disposition: "needs_authority",
            resulting_disposition: "actionable",
            actor: 123,
            rationale: "valid",
            decided_at: "2026-08-20T00:00:00.000Z",
          },
        ],
      }),
    ).toEqual(["authority decision record does not match the requirement authority state"]);

    // Non-string / invalid date decided_at
    expect(
      authorityAuditIssues({
        id: "R-1",
        authority_status: "granted",
        authority_history: [
          {
            requirement_id: "R-1",
            decision: "grant",
            prior_disposition: "needs_authority",
            resulting_disposition: "actionable",
            actor: "coordinator",
            rationale: "valid",
            decided_at: "not-a-valid-date",
          },
        ],
      }),
    ).toEqual(["authority decision record does not match the requirement authority state"]);

    // Invalid decision_id mismatch
    expect(
      authorityAuditIssues({
        id: "R-1",
        authority_status: "granted",
        authority_history: [
          {
            requirement_id: "R-1",
            decision: "grant",
            prior_disposition: "needs_authority",
            resulting_disposition: "actionable",
            actor: "coordinator",
            rationale: "valid",
            decided_at: "2026-08-20T00:00:00.000Z",
            decision_sha256: "b0b2e88a09f87ba6f1b34e405a39cb65d0a68d71d37418243302bc1121d5a864",
            decision_id: "authority-wrong-id",
          },
        ],
      }),
    ).toEqual(["authority decision digest is invalid"]);
  });

  test("recordAuthorityDecision validates non-record input and unknown requirement", () => {
    const port = pendingPort();
    expect(() =>
      recordAuthorityDecision(
        port,
        "R-1",
        "coordinator",
        null as unknown as AuthorityDecisionInput,
      ),
    ).toThrow("decision must be grant or decline");

    expect(() =>
      recordAuthorityDecision(port, "R-999", "coordinator", {
        decision: "grant",
        rationale: "valid",
      }),
    ).toThrow("unknown requirement: R-999");
  });

  test("authorizedRequirementIds handles nested requirements object and dependency resolution", () => {
    // Non-record state
    expect(authorizedRequirementIds(null)).toEqual(new Set());

    // Nested requirements record
    const nestedState = {
      requirements: {
        requirements: [
          { id: "R-1", disposition: "actionable", dependencies: [] },
          { id: "R-2", disposition: "actionable", dependencies: ["R-1"] },
          { id: "R-3", disposition: "actionable", dependencies: ["R-UNRESOLVED"] },
        ],
      },
    };
    expect(authorizedRequirementIds(nestedState)).toEqual(new Set(["R-1", "R-2"]));
  });

  test("decisionHistory throws when history is not an object list", () => {
    expect(() =>
      decisionHistory({
        id: "R-1",
        authority_history: "not-an-array" as unknown as AuthorityDecisionRecord[],
      }),
    ).toThrow("requirement authority_history must be an object list");
  });
});
