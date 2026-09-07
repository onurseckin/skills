import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { routeCriticFeedback } from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { TestPort, workflowState } from "../../fixtures.ts";

describe("Critic Feedback: Routing & Autonomous Remediation", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs.reset();
  });

  describe("routeCriticFeedback with requirement proofs and matching heuristics", () => {
    test("routes unproven requirement proofs as repair findings", () => {
      const state = workflowState();
      state.tasks["T-1"] = {
        id: "T-1",
        status: "done",
        requirement_ids: ["REQ-UNPROVEN"],
        write_scope: ["src/unproven.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      } as unknown as TaskRecord;

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "critic-lead", role: "completeness-critic" },
        {
          status: "findings",
          findings: [],
          requirement_proofs: [
            {
              requirement_id: "REQ-UNPROVEN",
              status: "unproven",
              observation: "Proof missing for invariant",
              remediation: "Add property test proof",
            },
          ],
        },
      );

      expect(result.isConverged).toBeFalse();
      expect(result.totalFindingsRouted).toBe(1);
      expect(result.changesRequestedTaskIds).toContain("T-1");
    });
  });

  describe("routeCriticFeedback", () => {
    test("enforces hierarchical compliance and rejects unauthorized reviewer roles", () => {
      const state = workflowState();
      const port = new TestPort(state);

      expect(() =>
        routeCriticFeedback(
          port,
          { actor: "worker-1", role: "implementer" as unknown as "validator" },
          [{ id: "F-1", requirement_id: "R-1", observation: "Err" }],
        ),
      ).toThrow("Hierarchical decision tree violation");
    });

    test("routeCriticFeedback matches tasks by affectedFilePaths and write scope in observation", () => {
      const state = workflowState();
      state.tasks["T-PATH"] = {
        ...state.tasks["T-1"]!,
        id: "T-PATH",
        status: "ready",
        requirement_ids: ["R-OTHER"],
        write_scope: ["src/special/file.ts"],
        findings: [],
      };

      const findingsByPath = [
        {
          id: "F-PATH",
          requirement_id: "R-UNKNOWN",
          role: "critic",
          category: "soundness",
          observation: "Issue in src/special/file.ts",
          affected_files: ["src/special/file.ts"],
          remediation: "Fix",
          revalidation_command: "bun test",
          status: "open",
        },
      ];

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "val-1", role: "validator" },
        findingsByPath,
      );
      expect(result.payloads[0]?.taskId).toBe("T-PATH");
    });

    test("routeCriticFeedback falls back to done/validated/changes_requested tasks when no requirement or path matches", () => {
      const state = workflowState();
      state.tasks["T-FALLBACK"] = {
        ...state.tasks["T-1"]!,
        id: "T-FALLBACK",
        status: "done",
        requirement_ids: ["R-100"],
        write_scope: ["src/done.ts"],
        findings: [],
      };

      const unmappedFindings = [
        {
          id: "F-UNMAPPED",
          requirement_id: "R-TOTALLY-UNMAPPED",
          role: "critic",
          category: "soundness",
          observation: "General issue without file markers",
          affected_files: [],
          remediation: "Fix",
          revalidation_command: "bun test",
          status: "open",
        },
      ];

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "val-1", role: "validator" },
        unmappedFindings,
      );
      expect(result.payloads[0]?.taskId).toBe("T-FALLBACK");
    });

    test("fans out shared critic finding across multiple tasks whose write scopes match affected files", () => {
      const state = workflowState();
      state.tasks["T-A"] = {
        ...state.tasks["T-1"]!,
        id: "T-A",
        status: "done",
        requirement_ids: [],
        write_scope: ["src/a.ts"],
        findings: [],
        repair_round: 0,
      };
      state.tasks["T-B"] = {
        ...state.tasks["T-1"]!,
        id: "T-B",
        status: "done",
        requirement_ids: [],
        write_scope: ["src/b.ts"],
        findings: [],
        repair_round: 0,
      };

      const sharedFinding = [
        {
          id: "F-SHARED",
          requirement_id: "R-SHARED",
          role: "critic",
          category: "soundness",
          observation: "Cross-cutting interface mismatch",
          affected_files: ["src/a.ts", "src/b.ts"],
          remediation: "Synchronize types",
          revalidation_command: "bun test",
          status: "open",
        },
      ];

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "val-1", role: "validator" },
        sharedFinding,
      );

      expect(result.isConverged).toBeFalse();
      expect(result.changesRequestedTaskIds).toContain("T-A");
      expect(result.changesRequestedTaskIds).toContain("T-B");
      expect(result.totalTasksInRepair).toBe(2);

      const updated = port.read();
      expect(updated.tasks["T-A"]?.status).toBe("changes_requested");
      expect(updated.tasks["T-B"]?.status).toBe("changes_requested");
    });
  });
});
