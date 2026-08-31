import { describe, expect, test } from "bun:test";
import { beginPlanValidation } from "../../../../olt/scripts/src/workflow/plan-review/begin-plan-validation.ts";
import { recordPlanReview } from "../../../../olt/scripts/src/workflow/plan-review/record-plan-review.ts";
import type { PacketRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { clock, compiledPort, fourAnswers } from "../fixtures/plan-review-fixture.ts";
import { commandRecord } from "../../shared/test-port.ts";

function planValidatorPacket(overrides: Partial<PacketRecord> = {}): PacketRecord {
  return {
    id: "pkt-1",
    status: "published",
    role: "plan-validator",
    agent_id: "plan-val-1",
    task_id: null,
    attempt: 1,
    graph_revision: 1,
    markdown_path: "packets/pkt-1/packet.md",
    metadata_path: "packets/pkt-1/metadata.json",
    packet_sha256: "a".repeat(64),
    published_at: "2026-08-13T12:00:00.000Z",
    ...overrides,
  };
}

describe("recordPlanReview — checks", () => {
  test("rejects a non-array checks field", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
          checks: "C-1",
        },
        clock,
      ),
    ).toThrow(/checks must be an array/);
  });

  test("names the check that is not an authoritative command run by this validator", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    port.transact("test", "command-recorded", {}, (draft) => {
      draft.commands["C-OTHER"] = commandRecord("C-OTHER", {
        task_id: null,
        actor: "someone-else",
      });
    });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
          checks: ["C-OTHER"],
        },
        clock,
      ),
    ).toThrow(/plan validator check is invalid: C-OTHER/);
  });

  test("records a check that is an authoritative command run by this validator", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    port.transact("test", "command-recorded", {}, (draft) => {
      draft.commands["C-SELF"] = commandRecord("C-SELF", {
        task_id: null,
        actor: "plan-val-1",
      });
    });
    const state = recordPlanReview(
      port,
      "plan-val-1",
      {
        validator_token: opened.token,
        graph_revision: 1,
        plan_digest: opened.state.plan_validation!.plan_digest,
        status: "approved",
        summary: "Sound.",
        ...fourAnswers,
        checks: ["C-SELF"],
      },
      clock,
    );
    expect(state.plan_review?.checks).toEqual([{ command_id: "C-SELF" }]);
  });
});

describe("recordPlanReview — dependency_edges_reviewed shape", () => {
  test("rejects an entry that is not an object", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
          dependency_edges_reviewed: ["not-an-object"],
        },
        clock,
      ),
    ).toThrow(/dependency_edges_reviewed\[0\] must be an object/);
  });
});

describe("recordPlanReview — findings shape", () => {
  test("rejects a finding with an unrecognized severity", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "changes_requested",
          summary: "No.",
          ...fourAnswers,
          findings: [
            {
              id: "PV-1",
              severity: "urgent",
              observation: "x",
              remediation: "y",
            },
          ],
        },
        clock,
      ),
    ).toThrow(/findings\[0\]\.severity must be critical, important or minor/);
  });
});

describe("recordPlanReview — graph revision drift", () => {
  test("refuses a review whose graph_revision no longer matches the open assignment", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 2,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
        },
        clock,
      ),
    ).toThrow(/graph revision has drifted since validation started/);
  });
});

describe("recordPlanReview — packet_sha256 correlation", () => {
  test("rejects a malformed packet_sha256", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
          packet_sha256: "not-a-digest",
        },
        clock,
      ),
    ).toThrow(/packet_sha256 must be a sha256 digest when present/);
  });

  test("requires a packet_sha256 when the named packet was actually published", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    port.transact("test", "packet-published", {}, (draft) => {
      draft.packets ??= {};
      draft.packets["pkt-1"] = planValidatorPacket();
    });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
          packet_id: "pkt-1",
        },
        clock,
      ),
    ).toThrow(/plan review omits its published packet digest/);
  });

  test("rejects a packet_sha256 that does not match the published packet", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    port.transact("test", "packet-published", {}, (draft) => {
      draft.packets ??= {};
      draft.packets["pkt-1"] = planValidatorPacket();
    });
    expect(() =>
      recordPlanReview(
        port,
        "plan-val-1",
        {
          validator_token: opened.token,
          graph_revision: 1,
          plan_digest: opened.state.plan_validation!.plan_digest,
          status: "approved",
          summary: "Sound.",
          ...fourAnswers,
          packet_id: "pkt-1",
          packet_sha256: "b".repeat(64),
        },
        clock,
      ),
    ).toThrow(/plan review does not match its published packet/);
  });

  test("records a review whose packet_sha256 matches its published packet exactly", () => {
    const port = compiledPort();
    const opened = beginPlanValidation(port, "plan-val-1", { clock });
    port.transact("test", "packet-published", {}, (draft) => {
      draft.packets ??= {};
      draft.packets["pkt-1"] = planValidatorPacket();
    });
    const state = recordPlanReview(
      port,
      "plan-val-1",
      {
        validator_token: opened.token,
        graph_revision: 1,
        plan_digest: opened.state.plan_validation!.plan_digest,
        status: "approved",
        summary: "Sound.",
        ...fourAnswers,
        packet_id: "pkt-1",
        packet_sha256: "a".repeat(64),
      },
      clock,
    );
    expect(state.plan_review?.packet_id).toBe("pkt-1");
    expect(state.plan_review?.packet_sha256).toBe("a".repeat(64));
    expect(state.plan_validation_history?.[0]).toMatchObject({
      status: "reviewed",
      packet_id: "pkt-1",
    });
  });
});
