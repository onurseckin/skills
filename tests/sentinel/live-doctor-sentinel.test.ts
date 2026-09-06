import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearInMemoryMailboxStore,
  readUnreadMessages,
  setInMemoryStreamMode,
} from "../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import {
  clearInMemoryMailboxDirs,
  resolveMailboxPaths,
} from "../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { executePreActionHook } from "../../olt/scripts/src/sentinel/hooks.ts";
import {
  clearRecentSentinelIntercepts,
  getRecentSentinelIntercepts,
  runFastDoctorChecks,
} from "../../olt/scripts/src/sentinel/interceptor.ts";

describe("Live Sentinel Doctor Interlock & Forced Mailbox IPC", () => {
  beforeEach(() => {
    clearInMemoryMailboxStore();
    clearInMemoryMailboxDirs();
    clearRecentSentinelIntercepts();
    setInMemoryStreamMode(true);
  });

  afterEach(() => {
    clearInMemoryMailboxStore();
    clearInMemoryMailboxDirs();
    clearRecentSentinelIntercepts();
    setInMemoryStreamMode(false);
  });

  describe("executePreActionHook Doctor Interlock", () => {
    it("blocks action and dispatches SENTINEL_INTERCEPT on EMPTY_GRAPH_DURING_ACTIVE_EXECUTION", () => {
      const result = executePreActionHook({
        agent_id: "impl_01",
        role: "implementer",
        action_type: "file_write",
        target: "src/engine/worker.ts",
        write_scope: ["src/engine/worker.ts"],
        tasks: {},
        activeWorktreeCount: 2,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(result.reason).toContain(
        "Planning DAG is empty (0 tasks) during active worktree/pulse execution",
      );

      const intercepts = getRecentSentinelIntercepts();
      expect(intercepts.length).toBeGreaterThanOrEqual(2);
      const callerReceipt = intercepts.find((r) => r.recipient === "impl_01");
      expect(callerReceipt).toBeDefined();
      expect(callerReceipt?.blockerCode).toBe("EMPTY_GRAPH_DURING_ACTIVE_EXECUTION");
      expect(callerReceipt?.payload.type).toBe("SENTINEL_INTERCEPT");

      const supervisorReceipt = intercepts.find((r) => r.recipient === "coordinator");
      expect(supervisorReceipt).toBeDefined();
    });

    it("blocks action on PLANNING_DAG_TIER_SKIP_VIOLATION and dispatches receipt", () => {
      const result = executePreActionHook({
        agent_id: "impl_02",
        role: "implementer",
        action_type: "file_write",
        target: "src/feature.ts",
        write_scope: ["src/feature.ts"],
        graph: {
          nodes: [
            { id: "mind_01", tier: 0 },
            { id: "impl_02", tier: 3 },
          ],
          edges: [{ from: "mind_01", to: "impl_02" }],
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(result.reason).toContain("Tier-skip violation detected in planning DAG edge");

      const intercepts = getRecentSentinelIntercepts();
      const callerReceipt = intercepts.find((r) => r.recipient === "impl_02");
      expect(callerReceipt?.blockerCode).toBe("PLANNING_DAG_TIER_SKIP_VIOLATION");
    });

    it("blocks action when UNTRACKED_WORKTREE_DETECTED is present in doctor findings", () => {
      const result = executePreActionHook({
        agent_id: "impl_03",
        role: "implementer",
        action_type: "file_write",
        target: "src/lib.ts",
        write_scope: ["src/lib.ts"],
        findings: [
          {
            code: "UNTRACKED_WORKTREE_DETECTED",
            severity: "ERROR",
            engine: "sentinelFastDoctor",
            message: "Worktree 'untracked-lane' exists without corresponding task registration",
          },
        ],
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(result.reason).toContain(
        "Worktree 'untracked-lane' exists without corresponding task registration",
      );
    });

    it("blocks action when CROSS_TIER_SPAWNING_VIOLATION is present", () => {
      const result = executePreActionHook({
        agent_id: "mind_root",
        role: "mind",
        action_type: "task_submit",
        target: "register:implementer",
        state: {
          spawned_agent_roles: ["implementer"],
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe("ROLE_CONFINEMENT_VIOLATION");
      expect(result.reason).toContain("Tier 0 Mind must not directly dispatch Tier 2/3 workers");
    });

    it("throws HarnessError when throw_on_block is requested", () => {
      expect(() => {
        executePreActionHook({
          agent_id: "val_01",
          role: "validator",
          action_type: "task_review",
          target: "task_review_1",
          activeWorktreeCount: 1,
          tasks: {},
          throw_on_block: true,
        });
      }).toThrow(HarnessError);
    });

    it("allows valid action when no critical doctor errors exist", () => {
      const result = executePreActionHook({
        agent_id: "impl_valid",
        role: "implementer",
        action_type: "file_write",
        target: "src/valid.ts",
        write_scope: ["src/valid.ts"],
        tasks: {
          taskA: { id: "taskA", role: "implementer" },
        },
      });

      expect(result.allowed).toBe(true);
      expect(getRecentSentinelIntercepts()).toHaveLength(0);
    });
  });

  describe("Structured Mailbox IPC Delivery", () => {
    it("delivers signed SENTINEL_INTERCEPT envelope to caller and supervisor inboxes", () => {
      const callerPaths = resolveMailboxPaths("worker_alpha");
      const supervisorPaths = resolveMailboxPaths("coordinator");

      executePreActionHook({
        agent_id: "worker_alpha",
        role: "implementer",
        action_type: "file_write",
        target: "src/app.ts",
        write_scope: ["src/app.ts"],
        parent_supervisor: "coordinator",
        tasks: {},
        activeWorktreeCount: 1,
      });

      const callerInbox = readUnreadMessages(callerPaths.inboxPath);
      expect(callerInbox.messages.length).toBeGreaterThanOrEqual(1);
      const callerMsg = callerInbox.messages[0]!;
      expect(callerMsg.sender_id).toBe("sentinel:worker_alpha");
      expect(callerMsg.recipient_id).toBe("worker_alpha");
      expect((callerMsg.payload as any).type).toBe("SENTINEL_INTERCEPT");
      expect((callerMsg.payload as any).blocker_code).toBe("EMPTY_GRAPH_DURING_ACTIVE_EXECUTION");

      const supervisorInbox = readUnreadMessages(supervisorPaths.inboxPath);
      expect(supervisorInbox.messages.length).toBeGreaterThanOrEqual(1);
      const supervisorMsg = supervisorInbox.messages[0]!;
      expect(supervisorMsg.recipient_id).toBe("coordinator");
      expect((supervisorMsg.payload as any).type).toBe("SENTINEL_INTERCEPT");
    });
  });

  describe("runFastDoctorChecks Helper", () => {
    it("aggregates findings across DAG, worktrees, and cross-tier spawning", () => {
      const findings = runFastDoctorChecks({
        role: "mind",
        spawnedRoles: ["implementer"],
        activeWorktreeCount: 1,
        tasks: {},
      });

      expect(findings.some((f) => f.code === "CROSS_TIER_SPAWNING_VIOLATION")).toBe(true);
      expect(findings.some((f) => f.code === "EMPTY_GRAPH_DURING_ACTIVE_EXECUTION")).toBe(true);
    });
  });
});
