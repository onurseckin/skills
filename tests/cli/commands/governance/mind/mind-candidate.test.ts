import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  formatMindAdmitBrief,
  formatMindCandidateBrief,
  mindCandidateCommand,
} from "../../../../../olt/scripts/src/cli/commands/index.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import * as witnessModule from "../../../../../olt/scripts/src/mind/auditing/witness/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";

const roots: string[] = [];

beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});

afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
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

    const p1 = mindCandidateCommand({
      run,
      actor: "mind-actor",
      kind: "proposal",
      statement: "Proposal 1",
      "charter-goal": ["G1"],
      "write-scope": ["src/"],
    });
    expect(p1.candidate_id).toBe("cand-1");

    const p2 = mindCandidateCommand({
      run,
      actor: "mind-actor",
      kind: "proposal",
      statement: "Proposal 2",
      "charter-goal": ["G1"],
      "write-scope": ["src/"],
    });
    expect(p2.candidate_id).toBe("cand-2");

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
