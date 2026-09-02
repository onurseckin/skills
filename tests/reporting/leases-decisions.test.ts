import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initRun, transact } from "../../olt/scripts/src/engine/store/index.ts";
import {
  formatLeaseDecisions,
  generateDecisionsReport,
  generateLeasesReport,
} from "../../olt/scripts/src/reporting/unified/leases-decisions.ts";
import type { TaskRecord, WorkflowState } from "../../olt/scripts/src/workflow/types.ts";
import {
  cleanupVirtualBrowserFS,
  setupVirtualBrowserFS,
  tempDir,
} from "./browser/browser-virtual-fs.ts";

function stubTask(id: string, lease?: unknown, status = "open"): TaskRecord {
  return {
    id,
    status: status as TaskRecord["status"],
    requirement_ids: [],
    dependencies: [],
    write_scope: [],
    attempts: [],
    history: [],
    repair_round: 0,
    lease: lease as TaskRecord["lease"],
  };
}

function stubSub(id: string, lease?: unknown) {
  return {
    id,
    label: id,
    write_scope: ["src/**"],
    status: "open" as const,
    lease: lease as WorkflowState["branches"][0]["sub_tasks"][0]["lease"],
  };
}

describe("leases-decisions coverage", () => {
  beforeEach(() => setupVirtualBrowserFS());
  afterEach(() => cleanupVirtualBrowserFS());

  describe("formatLeaseDecisions", () => {
    it("formats verdicts, push/probe counters, and fallback dashes", () => {
      expect(formatLeaseDecisions([])).toBe("*No active leases found.*");
      const out = formatLeaseDecisions([
        {
          taskId: "t-1",
          agentId: "a-1",
          role: "auditor",
          attempt: 1,
          status: "completed",
          verdict: "APPROVED",
          expiresAt: "2026-09-01T21:00:00Z",
        },
        {
          taskId: "t-2",
          agentId: "a-2",
          role: "implementer",
          attempt: 2,
          status: "in_progress",
          pushes: 3,
          probes: 4,
        },
        {
          taskId: "t-3",
          agentId: "a-3",
          role: "implementer",
          attempt: 1,
          status: "in_progress",
          pushes: 2,
        },
        {
          taskId: "t-4",
          agentId: "a-4",
          role: "implementer",
          attempt: 1,
          status: "in_progress",
          probes: 1,
        },
        { taskId: "t-5", agentId: "a-5", role: "critic", attempt: 1, status: "open" },
      ]);
      expect(out).toContain("Verdict: APPROVED");
      expect(out).toContain("Pushes: 3/5, Probes: 4/5");
      expect(out).toContain("Pushes: 2/5, Probes: 0/5");
      expect(out).toContain("Pushes: 0/5, Probes: 1/5");
      expect(out).toContain("—");
    });
  });

  describe("generateLeasesReport", () => {
    it("handles empty runs and extracts sorted matrix with fallbacks", () => {
      const emptyRun = initRun(
        tempDir("empty-l"),
        "r-emp",
        new TextEncoder().encode("E"),
        "file",
        true,
      );
      expect(generateLeasesReport(emptyRun).markdown).toContain("*No active leases found.*");

      const run = initRun(
        tempDir("l-repo"),
        "r-leases",
        new TextEncoder().encode("L"),
        "file",
        true,
      );
      transact(run, "planner", "plan-applied", {}, (state) => {
        state.tasks = {
          "t-z": stubTask(
            "t-z",
            {
              agent_id: "agent-z",
              role: "implementer",
              attempt: 2,
              issued_at: "2026-09-01T10:00:00Z",
              expires_at: "2026-09-01T11:00:00Z",
              heartbeat_at: "2026-09-01T10:30:00Z",
            },
            "in_progress",
          ),
          "t-a": stubTask("t-a", { agent: "agent-legacy-a", role: "" }, "ready"),
          "t-no-agent": stubTask("t-no-agent", { role: 123, attempt: "bad" }),
          "t-no-lease": stubTask("t-no-lease"),
        };
        state.branches = [
          {
            id: "b-1",
            parent_task_id: "t-z",
            parent_agent_id: "agent-z",
            reason: "subtask",
            depth: 1,
            status: "open",
            opened_at: "2026-09-01T10:00:00Z",
            sub_tasks: [
              stubSub("sub-b", {
                agent_id: "agent-sub-b",
                role: "sub_implementer",
                attempt: 1,
                issued_at: "2026-09-01T10:05:00Z",
                expires_at: "2026-09-01T10:35:00Z",
                heartbeat_at: "2026-09-01T10:15:00Z",
                token_digest: "tok-sb",
                duration_seconds: 1800,
              }),
              stubSub("sub-c", { agent: "agent-sub-legacy", role: "" }),
              stubSub("sub-no-agent", {}),
              stubSub("sub-unleased"),
            ],
          },
        ];
      });

      const rep = generateLeasesReport(run);
      expect(rep.matrix.map((r) => r.taskId)).toEqual([
        "sub-b",
        "sub-c",
        "sub-no-agent",
        "t-a",
        "t-no-agent",
        "t-z",
      ]);
      expect(rep.matrix[3]).toMatchObject({
        agentId: "agent-legacy-a",
        role: "implementer",
        attempt: 1,
      });
      expect(rep.matrix[4]).toMatchObject({ agentId: "unknown", role: "implementer" });
      expect(rep.matrix[1]?.role).toBe("sub_implementer");
      expect(rep.matrix[2]).toMatchObject({ agentId: "unknown", role: "sub_implementer" });
      expect(rep.markdown).toContain("- **Total Active Leases**: 6");
    });
  });

  describe("generateDecisionsReport", () => {
    it("handles array, object, and empty requirements formats", () => {
      const runArr = initRun(
        tempDir("d-arr"),
        "r-arr",
        new TextEncoder().encode("A"),
        "file",
        true,
      );
      transact(runArr, "planner", "plan-applied", {}, (state) => {
        state.requirements = [
          {
            id: "REQ-101",
            authority_history: [
              {
                decision: "approved",
                rationale: "Meets threshold",
                actor: "lead-architect",
                at: "2026-09-01T12:00:00Z",
              },
              { decision: "rejected", rationale: 12345, actor: null, at: false },
              "invalid-entry",
              { noDecision: true },
            ],
          },
          { id: "REQ-102", authority_history: "not-array" },
          { id: "REQ-103" },
        ] as unknown as typeof state.requirements;
      });
      const repArr = generateDecisionsReport(runArr);
      expect(repArr.decisions.length).toBe(2);
      expect(repArr.decisions[0]).toEqual({
        requirementId: "REQ-101",
        decision: "approved",
        rationale: "Meets threshold",
        actor: "lead-architect",
        timestamp: "2026-09-01T12:00:00Z",
      });
      expect(repArr.decisions[1]).toEqual({
        requirementId: "REQ-101",
        decision: "rejected",
        rationale: "",
        actor: "",
        timestamp: undefined,
      });
      expect(repArr.markdown).toContain("APPROVED");
      expect(repArr.markdown).toContain("REJECTED");

      const runObj = initRun(
        tempDir("d-obj"),
        "r-obj",
        new TextEncoder().encode("O"),
        "file",
        true,
      );
      transact(runObj, "planner", "plan-applied", {}, (state) => {
        state.requirements = {
          requirements: [
            {
              id: "REQ-201",
              authority_history: [{ decision: "deferred", rationale: "UX", actor: "pm" }],
            },
          ],
        };
      });
      const repObj = generateDecisionsReport(runObj);
      expect(repObj.decisions[0]?.decision).toBe("deferred");
      expect(repObj.markdown).toContain("DEFERRED");

      const runEmp = initRun(
        tempDir("d-emp"),
        "r-emp",
        new TextEncoder().encode("E"),
        "file",
        true,
      );
      transact(runEmp, "planner", "plan-applied", {}, (state) => {
        state.requirements = null as unknown as typeof state.requirements;
      });
      expect(generateDecisionsReport(runEmp).decisions).toEqual([]);
    });
  });
});
