import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mindRoundCloseCommand,
  mindRoundOpenCommand,
} from "../../../../../olt/scripts/src/cli/commands/mind-round.ts";
import { initRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import type { AgentRole } from "../../../../../olt/scripts/src/core/contracts/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
beforeEach(() => setupVirtualCliFS());
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function grantRole(run: string, agentId: string, role: AgentRole): void {
  transact(run, "coordinator", `grant-${agentId}`, {}, (draft) => {
    const agents = Array.isArray(draft.agents) ? [...draft.agents] : [];
    agents.push({
      id: agentId,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: new Date().toISOString(),
      status: "active",
    });
    draft.agents = agents;
  });
}

function addAdmittedCandidate(run: string, id: string, statement: string): void {
  transact(run, "coordinator", `add-cand-${id}`, {}, (draft) => {
    const candidates = Array.isArray(draft.candidates) ? [...draft.candidates] : [];
    candidates.push({ id, statement, status: "admitted" });
    draft.candidates = candidates;
  });
}

describe("mindRoundOpenCommand", () => {
  test("enforces role grants, auto-grants, and mind halted states", async () => {
    const { run } = await setupCompiledRun("mind-round-open-roles", roots);
    addAdmittedCandidate(run, "cand-1", "Statement 1");

    expect(() =>
      mindRoundOpenCommand({ run, actor: "unregistered-worker", objective: "cand-1" }),
    ).toThrow("holds no grant");

    grantRole(run, "impl-agent", "implementer");
    expect(() => mindRoundOpenCommand({ run, actor: "impl-agent", objective: "cand-1" })).toThrow(
      "role 'orchestrator' or 'mind' is required",
    );

    transact(run, "coordinator", "halt-mind", {}, (draft) => {
      draft.mind = { halted: true, halt_reason: "Manual pause" };
    });
    expect(() => mindRoundOpenCommand({ run, actor: "coordinator", objective: "cand-1" })).toThrow(
      "mind is halted (Manual pause)",
    );

    transact(run, "coordinator", "halt-mind-no-reason", {}, (draft) => {
      draft.mind = { halted: true };
    });
    expect(() => mindRoundOpenCommand({ run, actor: "coordinator", objective: "cand-1" })).toThrow(
      "mind is halted (unknown reason)",
    );

    transact(run, "coordinator", "unhalt", {}, (draft) => {
      draft.mind = { halted: false };
    });

    const resAuto = mindRoundOpenCommand({ run, actor: "coordinator-sub", objective: "cand-1" });
    expect(resAuto.round).toBe(1);
    expect(resAuto.actor).toBe("coordinator-sub");
  });

  test("validates candidates, statement drift, round budget, and chained run constraints", async () => {
    const { repo, run } = await setupCompiledRun("mind-round-open-validations", roots);

    expect(() =>
      mindRoundOpenCommand({ run, actor: "coordinator", objective: "missing-cand" }),
    ).toThrow("unknown candidate 'missing-cand'");

    transact(run, "coordinator", "add-proposed", {}, (draft) => {
      draft.candidates = [{ id: "prop-cand", statement: "Proposed", status: "proposed" }];
    });
    expect(() =>
      mindRoundOpenCommand({ run, actor: "coordinator", objective: "prop-cand" }),
    ).toThrow("candidate 'prop-cand' is not admitted");

    addAdmittedCandidate(run, "cand-valid", "Expected Statement");
    expect(() =>
      mindRoundOpenCommand({
        run,
        actor: "coordinator",
        objective: "cand-valid",
        statement: "Drifted Statement",
      }),
    ).toThrow("objective statement drifted from candidate");

    transact(run, "coordinator", "set-budget", {}, (draft) => {
      draft.budget = { max_rounds_per_objective: 1 };
    });
    expect(() =>
      mindRoundOpenCommand({ run, actor: "coordinator", objective: "cand-valid", round: 2 }),
    ).toThrow("round budget spent");

    const priorRun = initRun(
      repo,
      "prior-round-run",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    transact(priorRun, "coordinator", "add-open-branch", {}, (draft) => {
      draft.branches = { "branch-1": { status: "open" } };
    });
    expect(() =>
      mindRoundOpenCommand({
        run,
        actor: "coordinator",
        objective: "cand-valid",
        candidate: "cand-valid",
        "chain-from": priorRun,
        round: 1,
      }),
    ).toThrow("prior round");
  });

  test("successfully opens rounds with calculated index, fallback budgets, and formats markdown", async () => {
    const { run } = await setupCompiledRun("mind-round-open-success", roots);
    addAdmittedCandidate(run, "cand-success", "Implement feature X");

    transact(run, "coordinator", "set-mind-budget", {}, (draft) => {
      draft.mind = { budget: { max_rounds_per_objective: 5 } };
    });

    const open1 = mindRoundOpenCommand({
      run,
      actor: "mind-worker",
      objective: "cand-success",
      now: "2026-09-01T12:00:00.000Z",
    });
    expect(open1.round).toBe(1);
    expect(open1.candidate_id).toBe("cand-success");
    expect(open1.chain_from).toBeNull();
    expect(open1.markdown).toContain("Mind Round Opened: `cand-success` (Round 1)");
    expect(open1.markdown).toContain("1 / 5");

    mindRoundCloseCommand({
      run,
      actor: "mind-worker",
      objective: "cand-success",
      round: 1,
      result: "converged",
      successor: "run-next",
    });

    const open2 = mindRoundOpenCommand({
      run,
      actor: "test-actor",
      objective: "cand-success",
      "target-run": "run-prev",
      statement: "Implement feature X",
    });
    expect(open2.round).toBe(2);
    expect(open2.chain_from).toBe("run-prev");

    mindRoundCloseCommand({
      run,
      actor: "test-actor",
      objective: "cand-success",
      round: 2,
      result: "exhausted",
      "terminal-reason": "Retry next round",
    });

    const open3 = mindRoundOpenCommand({
      run,
      actor: "harness",
      objective: "cand-success",
      "chained-from": "run-prev2",
      statement: "Implement feature X",
    });
    expect(open3.round).toBe(3);
  });
});

describe("mindRoundCloseCommand", () => {
  test("validates required flags, results, role grants, and arming rail", async () => {
    const { run } = await setupCompiledRun("mind-round-close-flags", roots);
    addAdmittedCandidate(run, "cand-close", "Closing Statement");
    mindRoundOpenCommand({ run, actor: "coordinator", objective: "cand-close" });

    expect(() =>
      mindRoundCloseCommand({ run, actor: "coordinator", objective: "cand-close", round: 1 }),
    ).toThrow("--result is required");

    expect(() =>
      mindRoundCloseCommand({
        run,
        actor: "coordinator",
        objective: "cand-close",
        round: 1,
        result: "invalid-outcome",
      }),
    ).toThrow("invalid round result 'invalid-outcome'");

    expect(() =>
      mindRoundCloseCommand({
        run,
        actor: "unregistered-agent",
        objective: "cand-close",
        round: 1,
        result: "converged",
        successor: "run-next",
      }),
    ).toThrow("holds no grant");

    grantRole(run, "impl-agent-2", "implementer");
    expect(() =>
      mindRoundCloseCommand({
        run,
        actor: "impl-agent-2",
        objective: "cand-close",
        round: 1,
        result: "converged",
        successor: "run-next",
      }),
    ).toThrow("role 'orchestrator' or 'mind' is required");

    expect(() =>
      mindRoundCloseCommand({
        run,
        actor: "coordinator",
        objective: "cand-close",
        round: 1,
        result: "converged",
      }),
    ).toThrow("a round may not close without either an armed successor");
  });

  test("handles closing non-existent, already closed, and valid rounds with alias flags", async () => {
    const { run } = await setupCompiledRun("mind-round-close-flow", roots);
    addAdmittedCandidate(run, "cand-flow", "Flow Statement");
    mindRoundOpenCommand({ run, actor: "mind", objective: "cand-flow" });

    expect(() =>
      mindRoundCloseCommand({
        run,
        actor: "mind",
        objective: "cand-flow",
        round: 99,
        result: "exhausted",
        "terminal-reason": "No budget",
      }),
    ).toThrow("no round 99 found");

    const closed = mindRoundCloseCommand({
      run,
      actor: "system",
      objective: "cand-flow",
      round: 1,
      outcome: "exhausted",
      reason: "Budget exhausted after 1 round",
      now: "2026-09-01T13:00:00.000Z",
    });

    expect(closed.result).toBe("exhausted");
    expect(closed.terminal_reason).toBe("Budget exhausted after 1 round");
    expect(closed.closed_at).toBe("2026-09-01T13:00:00.000Z");
    expect(closed.markdown).toContain("Mind Round Closed: `cand-flow` (Round 1)");

    expect(() =>
      mindRoundCloseCommand({
        run,
        actor: "system",
        objective: "cand-flow",
        round: 1,
        result: "converged",
        "successor-run": "run-succ",
      }),
    ).toThrow("is already closed");
  });
});
