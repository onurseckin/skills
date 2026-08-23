import { describe, expect, test } from "bun:test";
import { mapFindingDetails } from "../../../olt/scripts/src/summary/asset-mapper.ts";
import type { CompletionReview, TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { makeTask } from "./graph-fixtures.ts";

describe("mapFindingDetails: field-name fallbacks a harness or an older log format might use", () => {
  test("falls back from requirement_id to camelCase requirementId", () => {
    const task = makeTask("T-1", {
      findings: [
        {
          id: "F-A",
          requirementId: "REQ-CAMEL",
          observation: "stated plainly",
        } as unknown as Record<string, unknown>,
      ] as unknown as TaskRecord["findings"],
    });
    const [finding] = mapFindingDetails(task);
    expect(finding?.requirementId).toBe("REQ-CAMEL");
  });

  test("falls back from observation, to reason, to message, in that order", () => {
    const task = makeTask("T-1", {
      findings: [
        { id: "F-REASON", reason: "reason-based observation text" },
        { id: "F-MESSAGE", message: "message-based observation text" },
      ] as unknown as TaskRecord["findings"],
    });
    const findings = mapFindingDetails(task);
    expect(findings.find((f) => f.id === "F-REASON")?.observation).toBe(
      "reason-based observation text",
    );
    expect(findings.find((f) => f.id === "F-MESSAGE")?.observation).toBe(
      "message-based observation text",
    );
  });

  test("turns target_files into both targetFiles and a write-scoped fileRefs list", () => {
    const task = makeTask("T-1", {
      findings: [
        {
          id: "F-TARGETS",
          observation: "touches two files",
          target_files: ["src/one.ts", "src/two.ts"],
        },
      ] as unknown as TaskRecord["findings"],
    });
    const [finding] = mapFindingDetails(task);
    expect(finding?.targetFiles).toEqual(["src/one.ts", "src/two.ts"]);
    expect(finding?.fileRefs).toEqual([
      { path: "src/one.ts", mode: "write" },
      { path: "src/two.ts", mode: "write" },
    ]);
  });

  test("reads a command_id off an evidence object inside a revalidation proof", () => {
    const task = makeTask("T-1", {
      findings: [
        {
          id: "F-PROOF",
          observation: "resolved and reproven",
          revalidation_proof: {
            method: "manual-recheck",
            evidence: [{ command_id: "C-reval-1" }, "not-an-object-but-already-a-string"],
          },
        },
      ] as unknown as TaskRecord["findings"],
    });
    const [finding] = mapFindingDetails(task);
    expect(finding?.revalidationProof).toEqual({
      method: "manual-recheck",
      evidence: ["C-reval-1", "not-an-object-but-already-a-string"],
    });
  });

  test("drops an evidence entry that is neither a reference string nor an object, without failing", () => {
    const task = makeTask("T-1", {
      findings: [
        {
          id: "F-JUNK-EVIDENCE",
          observation: "carries one unusable evidence entry",
          evidence: [42],
        },
      ] as unknown as TaskRecord["findings"],
    });
    const [finding] = mapFindingDetails(task);
    expect(finding?.evidence).toEqual([{}]);
  });
});

describe("mapFindingDetails: a critic's own completion-review findings", () => {
  function review(overrides: Partial<CompletionReview> = {}): CompletionReview {
    return {
      critic_id: "critic-1",
      packet_id: "packet-1",
      graph_revision: 1,
      readiness_sha256: "r".repeat(64),
      repository_binding: {
        commit: "c".repeat(40),
      } as unknown as CompletionReview["repository_binding"],
      summary: "Reviewed",
      status: "findings",
      unresolved_finding_ids: ["F-MINOR"],
      findings: [
        {
          id: "F-MINOR",
          requirement_id: "REQ-1",
          severity: "minor",
          observation: "a cosmetic issue",
        },
      ],
      requirement_proofs: [],
      residual_risks: [],
      integrity_evidence: [],
      repository_command_ids: [],
      checks: [],
      reviewed_at: "2026-08-19T00:00:00.000Z",
      review_sha256: "s".repeat(64),
      ...overrides,
    };
  }

  test("maps a minor critic finding to suggestion severity, same as a task-level finding would", () => {
    const [finding] = mapFindingDetails(undefined, { completionReview: review() });
    expect(finding?.severity).toBe("suggestion");
    expect(finding?.status).toBe("open");
  });
});
