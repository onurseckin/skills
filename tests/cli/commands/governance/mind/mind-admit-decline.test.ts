import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  mindAdmitCommand,
  mindDeclineCommand,
} from "../../../../../olt/scripts/src/cli/commands/index.ts";
import * as gatesModule from "../../../../../olt/scripts/src/mind/proposals/gates/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function grantRole(run: string, agentId: string, role: string): void {
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

describe("mindAdmitCommand & mindDeclineCommand", () => {
  test("mindAdmitCommand enforces role, halt status, open pulse, candidate status, and gate checks", async () => {
    const { run, repo } = await setupCompiledRun("mind-admit-flow", roots);

    expect(() =>
      mindAdmitCommand({
        run,
        actor: "unregistered",
        candidate: "cand-1",
      }),
    ).toThrow("holds no grant");

    grantRole(run, "impl-agent", "implementer");
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "impl-agent",
        candidate: "cand-1",
      }),
    ).toThrow("role 'mind' is required");

    grantRole(run, "mind-actor", "mind");

    transact(run, "mind-actor", "halt-mind", {}, (draft) => {
      draft.mind = {
        halted: true,
        halt_reason: "Manual halt",
      };
    });
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-1",
      }),
    ).toThrow("mind is halted");

    transact(run, "mind-actor", "unhalt", {}, (draft) => {
      draft.mind = {
        halted: false,
        charter: {
          goals: ["G1"],
          non_goals: ["NG1"],
          repo_roots: ["."],
        },
      };
    });

    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-1",
      }),
    ).toThrow("no active pulse is open");

    transact(run, "mind-actor", "open-pulse", {}, (draft) => {
      draft.pulse = {
        open: {
          pulse_id: "pulse-1",
          opened_at: new Date().toISOString(),
        },
      };
    });

    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-missing",
      }),
    ).toThrow("unknown candidate");

    transact(run, "mind-actor", "add-candidate", {}, (draft) => {
      draft.candidates = [
        {
          id: "cand-1",
          kind: "proposal",
          statement: "Refactor storage",
          charter_goal_ids: ["G1"],
          write_scope: ["src/"],
          status: "open",
        },
        {
          id: "cand-already-admitted",
          kind: "proposal",
          statement: "Already in",
          charter_goal_ids: ["G1"],
          write_scope: ["src/"],
          status: "admitted",
        },
        {
          id: "cand-declined",
          kind: "proposal",
          statement: "Declined one",
          charter_goal_ids: ["G1"],
          write_scope: ["src/"],
          status: "declined",
          decline_reason: "Not viable",
        },
      ];
    });

    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-already-admitted",
      }),
    ).toThrow("already admitted");

    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-declined",
      }),
    ).toThrow("permanently declined");

    const gateSpy = spyOn(gatesModule, "evaluateAdmissionGates").mockReturnValue({
      admitted: false,
      failingGate: {
        gateId: "G1",
        gateNumber: 1,
        name: "Charter Alignment",
        passed: false,
        reason: "Misaligned with core goals",
        repairArgv: ["mind:candidate"],
      },
      verdicts: [],
      falsifierExitObserved: null,
    });

    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-1",
      }),
    ).toThrow("admission gate G1 (Charter Alignment) refused: Misaligned with core goals");

    gateSpy.mockReturnValue({
      admitted: true,
      failingGate: null,
      verdicts: [
        { gateId: "G1", gateNumber: 1, name: "Charter Alignment", passed: true },
        { gateId: "G2", gateNumber: 2, name: "Falsifiability", passed: true },
        { gateId: "G3", gateNumber: 3, name: "Scope Bound", passed: true },
        { gateId: "G4", gateNumber: 4, name: "Non-Goal Separation", passed: true },
        { gateId: "G5", gateNumber: 5, name: "Dependency Feasibility", passed: true },
        { gateId: "G6", gateNumber: 6, name: "Authority Verification", passed: true },
      ],
      falsifierExitObserved: 0,
    });

    mkdirSync(join(repo, "olt", "agents"), { recursive: true });
    writeFileSync(
      join(repo, "olt", "agents", "mind.yaml"),
      `name: mind\ngoals:\n  - id: G1\n    description: Primary goal\nnon_goals:\n  - NG1\nrepo_roots:\n  - .\n`,
    );

    const admitRes = mindAdmitCommand({
      run,
      actor: "mind-actor",
      candidate: "cand-1",
    });

    expect(admitRes.candidate_id).toBe("cand-1");
    expect(admitRes.falsifier_exit_observed).toBe(0);
    expect(String(admitRes.markdown)).toContain("Candidate Admitted: `cand-1`");

    gateSpy.mockRestore();
  });

  describe("mindDeclineCommand", () => {
    test("validates required flags", async () => {
      await expect(mindDeclineCommand({})).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(mindDeclineCommand({ run: "r" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      await expect(mindDeclineCommand({ run: "r", actor: "a" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      await expect(
        mindDeclineCommand({ run: "r", actor: "a", candidate: "c" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    test("declines candidate and persists decline reason in state", async () => {
      const { run } = await setupCompiledRun("mind-decline-flow", roots);
      grantRole(run, "mind-actor", "mind");

      transact(run, "mind-actor", "setup-candidate", {}, (draft) => {
        draft.candidates = [
          {
            id: "cand-open",
            kind: "proposal",
            statement: "Open proposal",
            status: "open",
          },
          {
            id: "cand-completed",
            kind: "proposal",
            statement: "Done",
            status: "completed",
          },
        ];
      });

      await expect(
        mindDeclineCommand({
          run,
          actor: "mind-actor",
          candidate: "cand-missing",
          reason: "Not needed",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_STATE",
      });

      await expect(
        mindDeclineCommand({
          run,
          actor: "mind-actor",
          candidate: "cand-completed",
          reason: "Too late",
        }),
      ).rejects.toMatchObject({
        code: "INVALID_STATE",
      });

      const res = await mindDeclineCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-open",
        reason: "Duplicate idea",
      });

      expect(res.candidate_id).toBe("cand-open");
      expect(res.reason).toBe("Duplicate idea");
      expect(String(res.markdown)).toContain("Candidate Declined: `cand-open`");
    });
  });
});
