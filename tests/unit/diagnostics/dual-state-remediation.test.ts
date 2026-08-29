import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  auditDefectLog,
  categorizeDefect,
  formulateDefectCandidates,
  parseDefectLog,
  resolveDefect,
  serializeDefectLog,
  type DefectEntry,
  type DefectResolutionProof,
} from "../../../olt/scripts/src/mind/defects.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (let i = 0; i < tempRoots.length; i += 1) {
    const r = tempRoots[i];
    if (r !== undefined) {
      try {
        rmSync(r, { recursive: true, force: true });
      } catch {
        // Cleanup errors ignored
      }
    }
  }
  tempRoots.length = 0;
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

describe("Diagnostics Dual-State Remediation Engine", () => {
  describe("Scenario 1: Main Thread Boundary Violation (Direct Execution)", () => {
    const unhandledDefect: DefectEntry = {
      id: "defect-dual-main-thread-01",
      type: "main_thread_direct_execution",
      severity: "critical",
      timestamp: "2026-08-22T08:00:00.000Z",
      category: "boundary_violation",
      status: "open",
      observation: "Execution detected on interactive main thread modifying source files directly.",
      remediation:
        "Main thread must not modify code. Dispatch Tier 3 Implementers via invoke_subagent.",
      role: "main_thread",
    };

    test("State 1 (Defect State): Flags open boundary violation, blocks closure without proof", () => {
      // 1. Invariant: Status is open, category is boundary_violation
      expect(unhandledDefect.status).toBe("open");
      expect(unhandledDefect.category).toBe("boundary_violation");
      expect(unhandledDefect.resolution).toBeUndefined();

      // 2. Candidate Proposal generation: Unresolved defect generates actionable candidate proposal
      const candidates = formulateDefectCandidates([unhandledDefect], ["G1", "G2"]);
      expect(candidates.length).toBe(1);
      const cand = candidates[0];
      expect(cand !== undefined).toBeTrue();
      if (cand !== undefined) {
        expect(cand.id).toBe("cand-defect-dual-main-thread-01");
        expect(cand.kind).toBe("proposal");
        expect(cand.status).toBe("needs_authority");
        expect(cand.disposition).toBe("actionable");
        expect(cand.charter_goal_ids).toContain("G2");
      }

      // 3. Negative resolution attempt with invalid/empty proof fails with HarnessError
      const invalidProof: DefectResolutionProof = {
        task_id: "",
        test_assertion: "bun test",
        resolved_at: "2026-08-22T08:15:00.000Z",
      };
      expect(() => resolveDefect(unhandledDefect, invalidProof)).toThrow(HarnessError);
    });

    test("State 2 (Remediated State): Resolves defect with Tier 3 delegation proof and verified commit", () => {
      const validProof: DefectResolutionProof = {
        task_id: "task-tier3-delegation-fix",
        test_assertion: "bun test tests/unit/diagnostics/dual-state-remediation.test.ts",
        resolved_at: "2026-08-22T08:30:00.000Z",
        commit_sha: "commit-sha-boundary-verified-01",
      };

      const resolved = resolveDefect(unhandledDefect, validProof);

      // 1. Verified status transition
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution !== undefined).toBeTrue();
      if (resolved.resolution) {
        expect(resolved.resolution.task_id).toBe("task-tier3-delegation-fix");
        expect(resolved.resolution.test_assertion).toBe(
          "bun test tests/unit/diagnostics/dual-state-remediation.test.ts",
        );
        expect(resolved.resolution.commit_sha).toBe("commit-sha-boundary-verified-01");
        expect(resolved.resolution.resolved_at).toBe("2026-08-22T08:30:00.000Z");
      }

      // 2. Candidate proposals should now be empty for resolved defect
      const candidates = formulateDefectCandidates([resolved], ["G1", "G2"]);
      expect(candidates.length).toBe(0);

      // 3. Immutability: Original defect remains unchanged
      expect(unhandledDefect.status).toBe("open");
    });
  });

  describe("Scenario 2: Model Reasoning Error (Plan Revision Paralysis)", () => {
    const unhandledReasoningError: DefectEntry = {
      id: "defect-dual-paralysis-02",
      type: "plan_revision_paralysis",
      severity: "high",
      timestamp: "2026-08-22T08:35:00.000Z",
      category: "model_reasoning_error",
      status: "open",
      observation:
        "Tier 0 Mind exhibited passive inertia and failed to trigger plan revision tools.",
      remediation:
        "Trigger dynamic multi-orchestrator dispatch and autonomic loop rollover in recycler.ts.",
      role: "mind",
    };

    test("State 1 (Defect State): Identifies model reasoning error and generates G1 candidate", () => {
      expect(categorizeDefect(unhandledReasoningError)).toBe("model_reasoning_error");
      expect(unhandledReasoningError.status).toBe("open");

      const candidates = formulateDefectCandidates([unhandledReasoningError], ["G1", "G2"]);
      expect(candidates.length).toBe(1);
      const cand = candidates[0];
      expect(cand !== undefined).toBeTrue();
      if (cand !== undefined) {
        expect(cand.id).toBe("cand-defect-dual-paralysis-02");
        expect(cand.kind).toBe("proposal");
        expect(cand.charter_goal_ids).toContain("G1");
        expect(cand.statement).toContain("model reasoning error");
      }
    });

    test("State 2 (Remediated State): Proves autonomic rollover and attaches resolution proof", () => {
      const proof: DefectResolutionProof = {
        task_id: "task-autonomic-recycler-rollover",
        test_assertion: "bun test tests/unit/mind/recycler.test.ts",
        resolved_at: "2026-08-22T08:45:00.000Z",
        commit_sha: "commit-sha-recycler-proven",
      };

      const resolved = resolveDefect(unhandledReasoningError, proof);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.task_id).toBe("task-autonomic-recycler-rollover");
      expect(resolved.resolution?.commit_sha).toBe("commit-sha-recycler-proven");
    });
  });

  describe("Scenario 3: Code Defect (Type Error / Implicit Any)", () => {
    const unhandledCodeDefect: DefectEntry = {
      id: "defect-dual-type-defect-03",
      type: "type_error",
      severity: "critical",
      timestamp: "2026-08-22T08:50:00.000Z",
      category: "code_defect",
      status: "open",
      observation: "Implicit any detected in diagnostics telemetry module.",
      remediation:
        "Add strict TypeScript type annotations; verify tsc -p tsconfig.json --noEmit exits with code 0.",
    };

    test("State 1 (Defect State): Flags defect kind candidate with G1 goal", () => {
      expect(categorizeDefect(unhandledCodeDefect)).toBe("code_defect");
      expect(unhandledCodeDefect.status).toBe("open");

      const candidates = formulateDefectCandidates([unhandledCodeDefect], ["G1", "G2"]);
      expect(candidates.length).toBe(1);
      expect(candidates[0]?.kind).toBe("defect");
      expect(candidates[0]?.charter_goal_ids).toContain("G1");
    });

    test("State 2 (Remediated State): Attaches tsc zero-emit proof and closes defect", () => {
      const proof: DefectResolutionProof = {
        task_id: "task-strict-typescript-typing",
        test_assertion: "bun x tsc -p tsconfig.json --noEmit",
        resolved_at: "2026-08-22T09:00:00.000Z",
        commit_sha: "commit-sha-tsc-clean",
      };

      const resolved = resolveDefect(unhandledCodeDefect, proof);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution?.test_assertion).toBe("bun x tsc -p tsconfig.json --noEmit");
    });
  });

  describe("Scenario 4: Multi-Capsule Audit Transition from Defect to Remediated State", () => {
    test("tracks audit aggregation transition across capsule lifecycle", () => {
      const testDir = createTempDir("dual-state-capsule-");
      const capsuleDir = join(testDir, "capsule-run-1");
      mkdirSync(capsuleDir, { recursive: true });

      const openEntry: DefectEntry = {
        id: "defect-audit-trans-1",
        type: "role_amnesia",
        severity: "high",
        timestamp: "2026-08-22T09:10:00.000Z",
        category: "boundary_violation",
        status: "open",
        observation: "Missing whoami self-identification.",
        remediation: "Execute whoami on startup.",
      };

      // State 1: Write initial open defect log
      writeFileSync(join(capsuleDir, "defects.jsonl"), `${JSON.stringify(openEntry)}\n`);

      const auditState1 = auditDefectLog([capsuleDir]);
      expect(auditState1.total_defects).toBe(1);
      expect(auditState1.open_count).toBe(1);
      expect(auditState1.resolved_count).toBe(0);
      expect(auditState1.by_category.boundary_violation).toBe(1);

      // State 2: Append resolved record with resolution proof
      const resolvedEntry = resolveDefect(openEntry, {
        task_id: "task-whoami-enforcement",
        test_assertion: "bun test tests/unit/cli/whoami.test.ts",
        resolved_at: "2026-08-22T09:20:00.000Z",
        commit_sha: "commit-whoami-verified",
      });

      writeFileSync(
        join(capsuleDir, "defects.jsonl"),
        `${JSON.stringify(openEntry)}\n${JSON.stringify(resolvedEntry)}\n`,
      );

      const auditState2 = auditDefectLog([capsuleDir]);
      expect(auditState2.total_defects).toBe(1); // Deduplicated by ID
      expect(auditState2.open_count).toBe(0);
      expect(auditState2.resolved_count).toBe(1);
      expect(auditState2.defects[0]?.status).toBe("resolved");
      expect(auditState2.defects[0]?.resolution?.task_id).toBe("task-whoami-enforcement");
    });
  });
});
