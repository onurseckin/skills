import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { validateAntiBatchingIsolation } from "../../../olt/scripts/src/mind/tasks/smart/index.ts";
import {
  assertDefectCandidatesIsolated,
  partitionDefectsToIsolatedTasks,
} from "../../../olt/scripts/src/orchestrator/anti-batching.ts";

describe("Strict Anti-Batching Pipeline & 1:1 Isolated Implementer-Validator Verification", () => {
  let session: VirtualFSSession;
  let vfs: VirtualMemoryFS;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("1. Strict 1:1 Feedback & Directive Partitioning", () => {
    describe("7. Orchestrator Defect Candidate Partitioning", () => {
      it("partitionDefectsToIsolatedTasks creates 1:1 isolated repair tasks from findings", () => {
        const findings = [
          {
            id: "FINDING-NULL-PTR",
            requirement_id: "REQ-1",
            severity: "critical" as const,
            observation: "Null pointer when payload is empty in src/parser.ts",
            remediation: "Add null check in src/parser.ts",
            revalidation: "bun test tests/validation/parser.test.ts",
            file_paths: ["src/parser.ts"],
          },
          {
            id: "FINDING-RACE-COND",
            requirement_id: "REQ-2",
            severity: "important" as const,
            observation: "Race condition in transaction ledger in src/ledger.ts",
            remediation: "Add mutex lock in src/ledger.ts",
            revalidation: "bun test tests/validation/ledger.test.ts",
            file_paths: ["src/ledger.ts"],
          },
        ];

        const repairTasks = partitionDefectsToIsolatedTasks(findings, { roundNumber: 2 });
        expect(repairTasks.length).toBe(2);

        expect(repairTasks[0]!.id).toContain("repair-r2-1-finding-null-ptr");
        expect(repairTasks[0]!.assigned_implementer).toBe("implementer-finding-null-ptr");
        expect(repairTasks[0]!.assigned_validator).toBe("validator-finding-null-ptr");
        expect(repairTasks[0]!.priority).toBe("CRITICAL");
        expect(repairTasks[0]!.write_scope).toEqual(["src/parser.ts"]);

        expect(repairTasks[1]!.id).toContain("repair-r2-2-finding-race-cond");
        expect(repairTasks[1]!.assigned_implementer).toBe("implementer-finding-race-cond");
        expect(repairTasks[1]!.assigned_validator).toBe("validator-finding-race-cond");
        expect(repairTasks[1]!.priority).toBe("HIGH");
        expect(repairTasks[1]!.write_scope).toEqual(["src/ledger.ts"]);

        const report = validateAntiBatchingIsolation(repairTasks);
        expect(report.compliant).toBe(true);
        expect(report.isolated_task_count).toBe(2);
      });

      it("assertDefectCandidatesIsolated checks for duplicate finding IDs", () => {
        const duplicateFindings = [
          {
            id: "FINDING-1",
            requirement_id: "REQ-1",
            severity: "minor" as const,
            observation: "obs 1",
            remediation: "rem 1",
          },
          {
            id: "FINDING-1",
            requirement_id: "REQ-2",
            severity: "minor" as const,
            observation: "obs 2",
            remediation: "rem 2",
          },
        ];

        expect(() => {
          assertDefectCandidatesIsolated(duplicateFindings);
        }).toThrow("Duplicate defect candidate id: FINDING-1");
      });
    });
  });
});
