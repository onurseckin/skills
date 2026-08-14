import { describe, expect, test } from "bun:test";
import { checkCompletion } from "../../orchestrating-long-tasks/scripts/src/workflow/completion/check-completion.ts";
import { dispositionOrphanEvidence } from "../../orchestrating-long-tasks/scripts/src/workflow/orphan-evidence/disposition.ts";
import { orphanEvidenceSha256 } from "../../orchestrating-long-tasks/scripts/src/workflow/orphan-evidence/digest.ts";
import { at, TestPort, workflowState } from "./test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");

describe("orphan evidence disposition", () => {
  test("preserves immutable evidence and records one auditable terminal disposition", () => {
    const state = workflowState();
    const orphan = { task_id: "T-1", report_sha256: "late", reason: "expired_lease" };
    state.orphan_evidence.push(orphan);
    const port = new TestPort(state);
    const sha = orphanEvidenceSha256(orphan);
    expect(checkCompletion(port)).toContain(`orphan evidence is open: ${sha}`);

    const decided = dispositionOrphanEvidence(
      port,
      "coordinator",
      {
        orphan_sha256: sha,
        disposition: "superseded",
        rationale: "a newer independently validated submission replaced this late report",
        evidence: [{ task_id: "T-1", authoritative_attempt: 2 }],
      },
      clock,
    );
    expect(decided.orphan_evidence).toEqual([orphan]);
    expect(decided.orphan_evidence_dispositions?.[0]).toMatchObject({
      orphan_sha256: sha,
      disposition: "superseded",
      actor: "coordinator",
    });
    expect(decided.orphan_evidence_dispositions?.[0]?.disposition_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkCompletion(port)).not.toContain(`orphan evidence is open: ${sha}`);
    expect(() =>
      dispositionOrphanEvidence(
        port,
        "coordinator",
        {
          orphan_sha256: sha,
          disposition: "rejected",
          rationale: "duplicate decision",
          evidence: [{ reason: "duplicate" }],
        },
        clock,
      ),
    ).toThrow("already dispositioned");
  });

  test("rejects dispositions without an immutable source or substantive evidence", () => {
    const port = new TestPort(workflowState());
    expect(() =>
      dispositionOrphanEvidence(
        port,
        "coordinator",
        {
          orphan_sha256: "a".repeat(64),
          disposition: "rejected",
          rationale: "not linked",
          evidence: [{ reason: "missing" }],
        },
        clock,
      ),
    ).toThrow("does not exist");
    const orphan = { report_sha256: "late" };
    port.transact("test", "orphan", {}, (draft) => draft.orphan_evidence.push(orphan));
    expect(() =>
      dispositionOrphanEvidence(
        port,
        "coordinator",
        {
          orphan_sha256: orphanEvidenceSha256(orphan),
          disposition: "rejected",
          rationale: "bad evidence",
          evidence: [{}],
        },
        clock,
      ),
    ).toThrow("substantive");
  });
});
