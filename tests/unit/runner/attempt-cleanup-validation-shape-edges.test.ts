import { describe, expect, test } from "bun:test";
import { dispositionShapeIssues } from "../../../olt/scripts/src/engine/runner/attempt-cleanup-validation.ts";
import type { CommandAttemptCleanupDisposition } from "../../../olt/scripts/src/core/contracts/index.ts";

function validDisposition(
  overrides: Partial<CommandAttemptCleanupDisposition> = {},
): CommandAttemptCleanupDisposition {
  return {
    status: "uncertain",
    sequence: 1,
    recorded_at: "2026-08-19T00:00:00.000Z",
    reason: "settlement in progress",
    signals_sent: [],
    root_pid_identity: null,
    proof_kind: null,
    previous_sha256: "a".repeat(64),
    previous_signature: null,
    signature: Buffer.alloc(64, 7).toString("base64"),
    sha256: "b".repeat(64),
    ...overrides,
  };
}

describe("dispositionShapeIssues proof-kind/status coupling", () => {
  test("flags a non-terminal disposition that carries a leftover terminal proof kind", () => {
    const issues = dispositionShapeIssues(
      validDisposition({ status: "record_pending", proof_kind: "settled" }),
    );
    expect(issues).toContain("nonterminal cleanup disposition contains terminal proof");
  });

  test("does not flag a non-terminal disposition with no proof kind", () => {
    const issues = dispositionShapeIssues(validDisposition({ status: "uncertain" }));
    expect(issues).not.toContain("nonterminal cleanup disposition contains terminal proof");
  });

  test("does not flag a terminal disposition carrying a proof kind", () => {
    const issues = dispositionShapeIssues(
      validDisposition({ status: "terminal_proof", proof_kind: "settled" }),
    );
    expect(issues).not.toContain("nonterminal cleanup disposition contains terminal proof");
  });
});
