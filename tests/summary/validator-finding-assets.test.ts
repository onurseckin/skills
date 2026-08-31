import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { CompletionReview, TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { mapFindingDetails } from "../../../olt/scripts/src/summary/assets/index.ts";

describe("Round 3: Validator Findings & Asset Pipeline", () => {
  describe("Rich Validator Finding Extraction", () => {
    test("extracts task findings with pushbackReason, opposedChanges, rejection rounds, targetFiles, and proofs", () => {
      const task: TaskRecord = {
        id: "T-auth",
        label: "Implement Authentication Service",
        status: "changes_requested",
        requirement_ids: ["REQ-AUTH-01"],
        write_scope: ["src/auth/service.ts", "src/auth/service.test.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 2,
        validations: [
          {
            validator_id: "validator-sec-audit",
            domain: "code-quality",
            token_digest: "digest-123",
            attempt: 2,
            started_at: "2026-08-15T19:00:00.000Z",
            deadline_at: "2026-08-15T19:15:00.000Z",
            verdict: "reject",
          },
        ],
        findings: [
          {
            id: "FINDING-AUTH-101",
            requirement_id: "REQ-AUTH-01",
            severity: "critical",
            observation: "JWT signature validation is bypassed when algorithm is set to none",
            remediation: "Enforce HS256 algorithm verification and reject none algorithm",
            revalidation: "Run security audit unit tests",
            status: "open",
            evidence: [
              {
                kind: "command",
                reference: "cmd-val-1",
                observation: "Failed test: jwt_none_algorithm_exploit",
              },
            ],
          },
          {
            id: "FINDING-AUTH-102",
            requirement_id: "REQ-AUTH-01",
            severity: "minor",
            observation: "Token expiration time should be configurable via environment variable",
            remediation: "Expose AUTH_TOKEN_EXPIRY in config",
            revalidation: "Check config loader",
            status: "resolved",
          },
        ],
      };

      const findings = mapFindingDetails(task);
      expect(findings).toHaveLength(2);

      const f1 = findings.find((f) => f.id === "FINDING-AUTH-101");
      expect(f1).toBeDefined();
      expect(f1?.requirementId).toBe("REQ-AUTH-01");
      expect(f1?.severity).toBe("critical");
      expect(f1?.observation).toContain("JWT signature validation is bypassed");
      expect(f1?.pushbackReason).toContain("JWT signature validation is bypassed");
      // The finding named no opposed changes and no target files, and the task's write scope is
      // not an objection anyone raised, so nothing stands in for one.
      expect(f1?.opposedChanges).toBeUndefined();
      expect(f1?.remediation).toContain("Enforce HS256");
      expect(f1?.round).toBe(2);
      expect(f1?.rejectionRound).toBe(2);
      expect(f1?.validatorId).toBe("validator-sec-audit");
      expect(f1?.status).toBe("open");
      expect(f1?.revalidationProof?.method).toBe("Run security audit unit tests");
      expect(f1?.evidence?.[0]?.reference).toBe("cmd-val-1");

      const f2 = findings.find((f) => f.id === "FINDING-AUTH-102");
      expect(f2).toBeDefined();
      expect(f2?.severity).toBe("suggestion");
      expect(f2?.status).toBe("resolved");
    });

    test("extracts findings from completion review for completeness critic authority", () => {
      const completionReview: CompletionReview = {
        critic_id: "critic-authority-lead",
        packet_id: "packet-seal-01",
        packet_sha256: "sha-packet",
        graph_revision: 3,
        readiness_sha256: "sha-ready",
        repository_binding: {
          schema: "harness.repository-binding",
          version: 1,
          inspection_sha256: "sha-insp",
          git_identity_sha256: "sha-git",
          content_sha256: "sha-content",
          file_count: 120,
          total_bytes: 450000,
        },
        status: "findings",
        unresolved_finding_ids: ["FINDING-CRITIC-201"],
        findings: [
          {
            id: "FINDING-CRITIC-201",
            requirement_id: "REQ-PERF-01",
            severity: "critical",
            observation: "Bundle size increased by 45% without dynamic import splitting",
            remediation: "Split large dashboard visualizer into async lazy chunk",
            revalidation: "bun run build:analyze",
            file_paths: ["src/visualizer/bundle.ts"],
          },
        ],
        integrity_evidence: [
          {
            kind: "command",
            command_id: "cmd-critic-build",
            observation: "Build size audit failed chunk threshold",
          },
        ],
        requirement_proofs: [],
        residual_risks: [],
        repository_command_ids: [],
        checks: [],
        reviewed_at: "2026-08-15T19:30:00.000Z",
        review_sha256: "sha-rev-201",
      };

      const findings = mapFindingDetails(undefined, { completionReview });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.id).toBe("FINDING-CRITIC-201");
      expect(f.severity).toBe("critical");
      expect(f.observation).toContain("Bundle size increased by 45%");
      expect(f.pushbackReason).toContain("Bundle size increased by 45%");
      expect(f.status).toBe("open");
      expect(f.author).toBe("critic-authority-lead");
      expect(f.validatorId).toBe("critic-authority-lead");
      expect(f.targetFiles).toEqual(["src/visualizer/bundle.ts"]);
      expect(f.fileRefs).toEqual([{ path: "src/visualizer/bundle.ts", mode: "write" }]);
      expect(f.revalidationProof?.method).toBe("bun run build:analyze");
    });

    test("keeps a remediation proof under its own label when both proofs are present", () => {
      const task: TaskRecord = {
        id: "T-proofs",
        label: "Both proofs",
        status: "done",
        requirement_ids: ["REQ-01"],
        write_scope: ["src/proofs.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
        findings: [
          {
            id: "F-PROOFS-01",
            requirement_id: "REQ-01",
            severity: "important",
            observation: "The retry path was never exercised",
            remediation: "Cover the retry path",
            revalidation: "Rerun the gate",
            status: "resolved",
            revalidation_proof: { method: "independent rerun", evidence: ["cmd-reval"] },
            remediation_proof: { method: "patch applied", evidence: ["cmd-patch"] },
          },
        ],
      } as unknown as TaskRecord;

      const [finding] = mapFindingDetails(task);
      // Evidence of one kind was being shown under the label of the other: the revalidation proof
      // overwrote the remediation proof, so the patch evidence disappeared behind a rerun.
      expect(finding?.revalidationProof).toEqual({
        method: "independent rerun",
        evidence: ["cmd-reval"],
      });
      expect(finding?.remediationProof).toEqual({
        method: "patch applied",
        evidence: ["cmd-patch"],
      });
    });

    test("records no finding for a rejection event that carries no finding", () => {
      const task: TaskRecord = {
        id: "T-legacy-task",
        label: "Legacy Worker Task",
        status: "done",
        requirement_ids: ["REQ-01"],
        write_scope: ["src/legacy.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
      };

      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          kind: "review-recorded",
          sequence: 12,
          timestamp: "2026-08-15T19:10:00.000Z",
          actor: "validator-sec",
          payload: {
            task_id: "T-legacy-task",
            verdict: "reject",
            round: 1,
            pushback_reason: "Missing bounds check in buffer decoder",
            reason: "Missing bounds check in buffer decoder",
            findings: 1,
            severity: "critical",
          },
        },
      ];

      // The event states that a verdict happened. The defect it refers to lives in task.findings,
      // and this task has none: a finding minted out of the event would carry an id, a severity and
      // an observation the validator never wrote.
      expect(mapFindingDetails(task, { events })).toEqual([]);
    });
  });
});
