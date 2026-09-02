import { describe, expect, it, spyOn, afterEach } from "bun:test";
import * as storeModule from "../../../../olt/scripts/src/engine/store/index.ts";
import * as portsModule from "../../../../olt/scripts/src/integration/store-ports.ts";
import * as ledgerModule from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import * as leaseModule from "../../../../olt/scripts/src/workflow/lease/abandon.ts";
import * as wtLedgerModule from "../../../../olt/scripts/src/workflow/worktree/ledger.ts";
import * as consolidateModule from "../../../../olt/scripts/src/workflow/worktree/consolidate.ts";
import * as configModule from "../../../../olt/scripts/src/core/config/index.ts";
import { executeRung2 } from "../../../../olt/scripts/src/mind/lanes/rescue/rungs/rung2.ts";
import type { Clock, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import type {
  AgentGrantRecord,
  WorktreeLedgerState,
} from "../../../../olt/scripts/src/core/contracts/index.ts";

describe("Rung 2 Rescue Lane Coverage Suite", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
  });

  const clock: Clock = { now: () => new Date("2026-09-01T12:00:00.000Z") };
  const mockPort = { read: () => ({}) as WorkflowState, transact: () => ({}) as WorkflowState };
  const runRung2 = (roots: string[], acts: string[] = [], escs: string[] = []) =>
    executeRung2({
      liveRunRoots: roots,
      actor: "rescuer",
      nowMs: 1788264000000,
      nowIso: "2026-09-01T12:00:00.000Z",
      clock,
      actionsTaken: acts,
      escalations: escs,
    });
  const mkGrant = (id: string, status: AgentGrantRecord["status"]): AgentGrantRecord => ({
    id,
    role: "worker",
    status,
    scope: { allowed_directories: ["."] },
    capabilities: [],
    granted_at: "2026-09-01T12:00:00.000Z",
    last_heartbeat: "2026-09-01T12:00:00.000Z",
  });
  const mockRun = (state: Record<string, unknown>) =>
    ({ state }) as unknown as ReturnType<typeof storeModule.loadRun>;
  const mkTask = (id: string, agent_id?: string, submitted?: string, lease = false) => ({
    id,
    attempts: [
      {
        number: 1,
        ...(agent_id ? { agent_id } : {}),
        ...(submitted ? { submitted_at: submitted } : { status: "started" }),
      },
    ],
    ...(lease && agent_id ? { lease: { agent_id, expires_at: "2026-09-01T12:00:00.000Z" } } : {}),
  });

  it("returns empty arrays when liveRunRoots is empty", () => {
    const actionsTaken: string[] = [];
    const escalations: string[] = [];
    const result = runRung2([], actionsTaken, escalations);
    expect(result.abandonedAttempts).toEqual([]);
    expect(result.orphanEvidenceEscalated).toEqual([]);
    expect(result.worktreesReclaimed).toEqual([]);
    expect(actionsTaken).toEqual([]);
    expect(escalations).toEqual([]);
  });

  it("abandons task attempts when agent is missing, released, or lease is absent", () => {
    spies.push(spyOn(portsModule, "workflowPort").mockReturnValue(mockPort));
    let abandonCount = 0;
    spies.push(
      spyOn(leaseModule, "abandonAttempt").mockImplementation(() => {
        abandonCount++;
        return {} as WorkflowState;
      }),
    );

    const mockState = {
      tasks: {
        t1: mkTask("t1", "agent-released", undefined, true),
        t2: mkTask("t2", "agent-missing"),
        t3: mkTask("t3", "agent-active", undefined, true),
        t4: mkTask("t4", "agent-active", "2026-09-01T12:00:00.000Z"),
        t5: mkTask("t5"),
      },
    };

    spies.push(spyOn(storeModule, "loadRun").mockReturnValue(mockRun(mockState)));
    spies.push(
      spyOn(ledgerModule, "readAgentLedger").mockReturnValue([
        mkGrant("agent-active", "active"),
        mkGrant("agent-released", "released"),
      ]),
    );

    const actionsTaken: string[] = [];
    const escalations: string[] = [];
    const result = runRung2(["/capsules/run-alpha"], actionsTaken, escalations);

    expect(abandonCount).toBe(3);
    expect(result.abandonedAttempts).toEqual([
      { runId: "run-alpha", taskId: "t1", agentId: "agent-released" },
      { runId: "run-alpha", taskId: "t2", agentId: "agent-missing" },
      { runId: "run-alpha", taskId: "t5" },
    ]);
    expect(actionsTaken.length).toBe(3);
  });

  it("escalates orphan evidence and executes draft state update", () => {
    let transactedDraft: Record<string, unknown> | null = null;
    spies.push(
      spyOn(storeModule, "transact").mockImplementation((_p, _a, _k, _pl, mutate) => {
        const draft: Record<string, unknown> = { escalations: [{ id: "existing-esc" }] };
        if (typeof mutate === "function") mutate(draft as never);
        transactedDraft = draft;
        return draft as never;
      }),
    );

    spies.push(
      spyOn(storeModule, "loadRun").mockReturnValue(
        mockRun({ tasks: {}, orphan_evidence: [{ id: "ev-1" }, { id: "ev-2" }] }),
      ),
    );
    spies.push(spyOn(ledgerModule, "readAgentLedger").mockReturnValue([]));

    const actionsTaken: string[] = [];
    const escalations: string[] = [];
    const result = runRung2(["/capsules/run-beta"], actionsTaken, escalations);

    expect(result.orphanEvidenceEscalated).toEqual([{ runId: "run-beta", evidenceCount: 2 }]);
    expect(escalations).toContain(
      "orphan evidence (2 items) in run run-beta needs coordinator disposal",
    );
    expect(actionsTaken).toContain("Rung 2: escalated orphan evidence in run-beta");
    expect(transactedDraft).not.toBeNull();
    const escList = (transactedDraft as { escalations?: unknown[] })?.escalations;
    expect(escList).toHaveLength(2);
  });

  it("reclaims orphaned worktrees when worktree isolation is active", () => {
    let recordedReclaims = 0;
    spies.push(
      spyOn(consolidateModule, "recordReclaim").mockImplementation(() => {
        recordedReclaims++;
      }),
    );
    spies.push(
      spyOn(consolidateModule, "reclaimOrphanedWorktrees").mockReturnValue({
        reclaimed_worktree_ids: ["wt-1", "wt-2"],
      }),
    );
    spies.push(
      spyOn(configModule, "getHarnessConfig").mockReturnValue({
        worktree_isolation: true,
      } as ReturnType<typeof configModule.getHarnessConfig>),
    );
    spies.push(
      spyOn(wtLedgerModule, "readWorktreeLedger").mockReturnValue({
        root: "/wt-root",
        harness_branch: "harness",
        base_sha: "abc",
        worktrees: [],
        commits: [],
      } as unknown as WorktreeLedgerState),
    );

    spies.push(
      spyOn(storeModule, "loadRun").mockReturnValue(
        mockRun({ tasks: {}, completion_result: { status: "running" } }),
      ),
    );
    spies.push(spyOn(ledgerModule, "readAgentLedger").mockReturnValue([]));

    const actionsTaken: string[] = [];
    const resultUnsealed = runRung2(["/capsules/run-gamma"], actionsTaken);

    expect(recordedReclaims).toBe(1);
    expect(resultUnsealed.worktreesReclaimed).toEqual([
      { runId: "run-gamma", worktreeIds: ["wt-1", "wt-2"] },
    ]);
    expect(actionsTaken).toContain("Rung 2: reclaimed 2 abandoned worktree(s) in run-gamma");

    spies.push(
      spyOn(storeModule, "loadRun").mockReturnValue(
        mockRun({ tasks: {}, completion_result: { status: "complete" } }),
      ),
    );
    const resultSealed = runRung2(["/capsules/run-delta"]);
    expect(recordedReclaims).toBe(1);
    expect(resultSealed.worktreesReclaimed).toHaveLength(1);
  });

  it("handles corrupted runs and non-isolated worktree configs gracefully", () => {
    spies.push(
      spyOn(storeModule, "loadRun").mockImplementation((path) => {
        if (path.includes("corrupted")) throw new Error("Disk read error");
        return mockRun({ tasks: {} });
      }),
    );
    spies.push(spyOn(ledgerModule, "readAgentLedger").mockReturnValue([]));
    spies.push(
      spyOn(wtLedgerModule, "readWorktreeLedger").mockReturnValue({
        root: "/wt-root",
        harness_branch: "harness",
        base_sha: "abc",
        worktrees: [],
        commits: [],
      } as unknown as WorktreeLedgerState),
    );
    spies.push(
      spyOn(configModule, "getHarnessConfig").mockReturnValue({
        worktree_isolation: false,
      } as ReturnType<typeof configModule.getHarnessConfig>),
    );

    const result = runRung2(["/capsules/corrupted-run", "/capsules/no-iso-run"]);
    expect(result.abandonedAttempts).toEqual([]);
    expect(result.orphanEvidenceEscalated).toEqual([]);
    expect(result.worktreesReclaimed).toEqual([]);
  });
});
