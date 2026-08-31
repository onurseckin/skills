import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatMindAdmitBrief,
  mindAdmitCommand,
  mindDeclineCommand,
} from "../../../olt/scripts/src/cli/commands/mind-admit.ts";
import {
  formatMindCandidateBrief,
  mindCandidateCommand,
} from "../../../olt/scripts/src/cli/commands/mind-candidate.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import * as witnessModule from "../../../olt/scripts/src/mind/auditing/witness/index.ts";
import * as gatesModule from "../../../olt/scripts/src/mind/proposals/gates/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

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

describe("formatMindAdmitBrief & formatMindCandidateBrief", () => {
  test("formatMindAdmitBrief formats complete admission report", () => {
    const md = formatMindAdmitBrief({
      candidateId: "cand-1",
      runRoot: ".olt/capsules/run-1",
      actor: "mind-1",
      statement: "Fix broken parser",
      admittedAt: "2026-08-31T00:00:00Z",
      falsifierExitObserved: 1,
      verdicts: [
        { gateId: "G1", gateNumber: 1, name: "Charter Alignment", passed: true },
        { gateId: "G2", gateNumber: 2, name: "Falsifiability", passed: true },
      ],
    });

    expect(md).toContain("Candidate Admitted: `cand-1`");
    expect(md).toContain("Gate 1 (Charter Alignment): PASSED");
    expect(md).toContain("- **Falsifier Exit**: 1");

    // Null falsifier exit
    const mdNull = formatMindAdmitBrief({
      candidateId: "cand-2",
      runRoot: ".olt/capsules/run-1",
      actor: "mind-1",
      statement: "Proposal statement",
      admittedAt: "2026-08-31T00:00:00Z",
      falsifierExitObserved: null,
      verdicts: [],
    });
    expect(mdNull).toContain("- **Falsifier Exit**: n/a");
  });

  test("formatMindCandidateBrief formats defect and proposal candidate briefs", () => {
    const defectMd = formatMindCandidateBrief({
      candidateId: "cand-1",
      kind: "defect",
      statement: "Parser crashes on unicode",
      witnessCommandId: "cmd-123",
      charterGoals: ["G1", "G2"],
      writeScope: ["src/parser.ts"],
    });
    expect(defectMd).toContain("Mind Candidate Recorded: cand-1");
    expect(defectMd).toContain("- **Witness**: `cmd-123`");

    const proposalMd = formatMindCandidateBrief({
      candidateId: "cand-2",
      kind: "proposal",
      statement: "Add fast path for ascii",
      witnessCommandId: null,
      charterGoals: ["G1"],
      writeScope: ["src/parser.ts"],
    });
    expect(proposalMd).toContain("- **Witness**: none (proposal)");
  });
});

describe("mindCandidateCommand", () => {
  test("throws HarnessError on unregistered agent", async () => {
    const { run } = await setupCompiledRun("mind-cand-unreg", roots);

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "unregistered-agent",
        kind: "defect",
        statement: "Something broken",
        "charter-goal": ["G1"],
        "write-scope": ["src/"],
      }),
    ).toThrow(HarnessError);
  });

  test("throws HarnessError on invalid candidate kind", async () => {
    const { run } = await setupCompiledRun("mind-cand-invalid-kind", roots);
    grantRole(run, "mind-actor", "mind");

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-actor",
        kind: "unknown_kind",
        statement: "Something broken",
        "charter-goal": ["G1"],
        "write-scope": ["src/"],
      }),
    ).toThrow(HarnessError);
  });

  test("throws HarnessError on unpinned charter goal", async () => {
    const { run } = await setupCompiledRun("mind-cand-unpinned-goal", roots);
    grantRole(run, "mind-actor", "mind");

    transact(run, "mind-actor", "setup-charter", {}, (draft) => {
      draft.mind = {
        charter: {
          goals: ["G1", "G2"],
        },
      };
    });

    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-actor",
        kind: "defect",
        statement: "Something broken",
        "charter-goal": ["G_UNKNOWN"],
        "write-scope": ["src/"],
      }),
    ).toThrow(HarnessError);
  });

  test("records defect candidate with verified witness and explicit/derived falsifier argv", async () => {
    const { run } = await setupCompiledRun("mind-cand-defect", roots);
    grantRole(run, "mind-actor", "mind");

    transact(run, "mind-actor", "setup-charter", {}, (draft) => {
      draft.mind = {
        charter: {
          goals: ["G1"],
        },
      };
    });

    const witnessSpy = spyOn(witnessModule, "verifyDefectWitness").mockReturnValue({
      exitCode: 1,
      commandRecord: {
        id: "cmd-wit-1",
        argv: ["bun", "test", "fail.test.ts"],
      } as unknown as witnessModule.WitnessCommandRecord,
    });

    // Defect without witness throws
    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-actor",
        kind: "defect",
        statement: "Missing witness",
        "charter-goal": ["G1"],
        "write-scope": ["src/"],
      }),
    ).toThrow(HarnessError);

    // Defect with witness and explicit falsifier
    const res = mindCandidateCommand({
      run,
      actor: "mind-actor",
      kind: "defect",
      statement: "Defect with explicit falsifier",
      witness: "cmd-wit-1",
      falsifier: "bun test specific.test.ts",
      rationale: "Needs fix",
      "charter-goal": ["G1"],
      "write-scope": ["src/"],
    });

    expect(res.candidate_id).toBe("cand-1");
    expect((res.candidate as Record<string, unknown>).falsifier_argv).toEqual([
      "bun",
      "test",
      "specific.test.ts",
    ]);
    expect((res.candidate as Record<string, unknown>).falsifier_exit).toBe(1);

    // Defect with witness and execution_argv derived
    witnessSpy.mockReturnValueOnce({
      exitCode: 2,
      commandRecord: {
        id: "cmd-wit-2",
        execution_argv: ["node", "run.js"],
      } as unknown as witnessModule.WitnessCommandRecord,
    });

    const res2 = mindCandidateCommand({
      run,
      actor: "mind-actor",
      kind: "defect",
      statement: "Defect with execution_argv",
      witness: "cmd-wit-2",
      "charter-goal": ["G1"],
      "write-scope": ["src/"],
    });
    expect((res2.candidate as Record<string, unknown>).falsifier_argv).toEqual(["node", "run.js"]);

    // Defect with fallback to [witness]
    witnessSpy.mockReturnValueOnce({
      exitCode: 1,
      commandRecord: {
        id: "cmd-wit-3",
      } as unknown as witnessModule.WitnessCommandRecord,
    });
    const res3 = mindCandidateCommand({
      run,
      actor: "mind-actor",
      kind: "defect",
      statement: "Defect fallback",
      witness: "cmd-wit-3",
      "charter-goal": ["G1"],
      "write-scope": ["src/"],
    });
    expect((res3.candidate as Record<string, unknown>).falsifier_argv).toEqual(["cmd-wit-3"]);

    witnessSpy.mockRestore();
  });

  test("records proposal candidate and enforces max open proposals cap", async () => {
    const { run } = await setupCompiledRun("mind-cand-proposal", roots);
    grantRole(run, "mind-actor", "mind");

    transact(run, "mind-actor", "setup-charter", {}, (draft) => {
      draft.mind = {
        charter: {
          goals: ["G1"],
        },
      };
      draft.budget = {
        max_open_proposals: 2,
      };
    });

    // Proposal cannot have witness
    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-actor",
        kind: "proposal",
        statement: "Invalid proposal with witness",
        witness: "cmd-1",
        "charter-goal": ["G1"],
        "write-scope": ["src/"],
      }),
    ).toThrow(HarnessError);

    // Open proposal 1
    const p1 = mindCandidateCommand({
      run,
      actor: "mind-actor",
      kind: "proposal",
      statement: "Proposal 1",
      "charter-goal": ["G1"],
      "write-scope": ["src/"],
    });
    expect(p1.candidate_id).toBe("cand-1");

    // Open proposal 2
    const p2 = mindCandidateCommand({
      run,
      actor: "mind-actor",
      kind: "proposal",
      statement: "Proposal 2",
      "charter-goal": ["G1"],
      "write-scope": ["src/"],
    });
    expect(p2.candidate_id).toBe("cand-2");

    // Open proposal 3 exceeds cap of 2
    expect(() =>
      mindCandidateCommand({
        run,
        actor: "mind-actor",
        kind: "proposal",
        statement: "Proposal 3 exceeds cap",
        "charter-goal": ["G1"],
        "write-scope": ["src/"],
      }),
    ).toThrow(HarnessError);
  });
});

describe("mindAdmitCommand & mindDeclineCommand", () => {
  test("mindAdmitCommand enforces role, halt status, open pulse, candidate status, and gate checks", async () => {
    const { run, repo } = await setupCompiledRun("mind-admit-flow", roots);

    // 1. Missing grant
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "unregistered",
        candidate: "cand-1",
      }),
    ).toThrow("holds no grant");

    // 2. Role violation
    grantRole(run, "impl-agent", "implementer");
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "impl-agent",
        candidate: "cand-1",
      }),
    ).toThrow("role 'mind' is required");

    grantRole(run, "mind-actor", "mind");

    // 3. Mind halted
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

    // Un-halt
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

    // 4. No active pulse open
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-1",
      }),
    ).toThrow("no active pulse is open");

    // Open a pulse
    transact(run, "mind-actor", "open-pulse", {}, (draft) => {
      draft.pulse = {
        open: {
          pulse_id: "pulse-1",
          opened_at: new Date().toISOString(),
        },
      };
    });

    // 5. Unknown candidate
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-missing",
      }),
    ).toThrow("unknown candidate");

    // Add candidate in state
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

    // 6. Already admitted
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-already-admitted",
      }),
    ).toThrow("already admitted");

    // 7. Permanently declined
    expect(() =>
      mindAdmitCommand({
        run,
        actor: "mind-actor",
        candidate: "cand-declined",
      }),
    ).toThrow("permanently declined");

    // 8. Failing admission gate
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

    // 9. Successful admission
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

    // Write charter file on disk to exercise disk read branch
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

      // Missing candidate in state
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

      // Completed candidate cannot be declined
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

      // Successful decline
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
