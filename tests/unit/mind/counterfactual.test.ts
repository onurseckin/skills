import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditCandidateIsolation,
  createIsolatedCandidate,
  evaluateCandidateCounterfactual,
  formatCounterfactualReportMarkdown,
  runCounterfactualReAdmissionSuite,
  selectPreviouslyAdmittedCandidates,
} from "../../../olt/scripts/src/mind/counterfactual.ts";
import type {
  CandidateRecord,
  GateEvaluationContext,
} from "../../../olt/scripts/src/mind/gates.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  roots.length = 0;
});

interface CounterfactualTestContext {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
  readonly gateContext: GateEvaluationContext;
}

function setupTestEnvironment(name: string): CounterfactualTestContext {
  const repo = mkdtempSync(join(tmpdir(), `mind-counterfactual-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent = `# CHARTER\n\n## identity\nCounterfactual Test System\n\n## goals\n- G1: Ensure stability\n- G2: Verification excellence\n\n## non-goals\n- Unattended deletion\n- Out of scope\n\n## repo_roots\n- \`src/\`\n- \`olt/\`\n- \`tests/\`\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-counterfactual-${name}`, charterBytes, "file", true);

  // Set up dummy files in repo
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "index.ts"), "export const value = 42;\n", "utf-8");

  const gateContext: GateEvaluationContext = {
    runRoot: run,
    repoRoot: repo,
    actor: "auditor-1",
    state: {},
    charterGoals: new Set(["G1", "G2"]),
    charterNonGoals: ["Unattended deletion", "Out of scope"],
    repoRoots: ["src/", "olt/", "tests/"],
  };

  return {
    repo,
    run,
    charterPath,
    charterSha,
    gateContext,
  };
}

function recordCommandInRun(
  runRoot: string,
  commandId: string,
  options: {
    readonly exitCode: number;
    readonly stdout?: string;
    readonly stderr?: string;
  },
): void {
  const cmdDir = join(runRoot, "commands", commandId);
  mkdirSync(cmdDir, { recursive: true });

  const record = {
    id: commandId,
    exit_code: options.exitCode,
    status: options.exitCode === 0 ? "succeeded" : "failed",
    logs: {
      stdout: { path: `commands/${commandId}/stdout.log` },
      stderr: { path: `commands/${commandId}/stderr.log` },
    },
  };

  writeFileSync(join(cmdDir, "record.json"), JSON.stringify(record, null, 2), "utf-8");
  writeFileSync(join(cmdDir, "stdout.log"), options.stdout ?? "", "utf-8");
  writeFileSync(join(cmdDir, "stderr.log"), options.stderr ?? "", "utf-8");
}

describe("Counterfactual Re-Admission Tester", () => {
  describe("Context Isolation", () => {
    test("strips all historical narrative, prior rationale, decision history, and adoption metadata", () => {
      const contaminatedCandidate: Record<string, unknown> = {
        id: "cand-defect-001",
        kind: "defect",
        statement: "Null pointer dereference in auth handler",
        witness_command_id: "cmd-auth-fail",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["bun", "test", "tests/auth.test.ts"],
        falsifier_exit: 1,
        write_scope: ["src/auth/"],
        status: "admitted",
        rationale: "We should fix this immediately because users are complaining in ticket #1234",
        decided_at: "2026-08-20T10:00:00.000Z",
        decided_by: "lead-dev",
        decline_reason: null,
        gate_failed: null,
        objective_run_id: "run-objective-99",
        adoption_notes: "Accepted during pulse 12 by unanimous agreement",
        history: [{ step: "prior_admission", approved: true }],
        comments: "Looks like an easy win",
      };

      const isolated = createIsolatedCandidate(contaminatedCandidate);

      expect(isolated.id).toBe("cand-defect-001");
      expect(isolated.kind).toBe("defect");
      expect(isolated.statement).toBe("Null pointer dereference in auth handler");
      expect(isolated.witness_command_id).toBe("cmd-auth-fail");
      expect(isolated.charter_goal_ids).toEqual(["G1"]);
      expect(isolated.falsifier_argv).toEqual(["bun", "test", "tests/auth.test.ts"]);
      expect(isolated.falsifier_exit).toBe(1);
      expect(isolated.write_scope).toEqual(["src/auth/"]);
      expect(isolated.status).toBe("opened"); // Presented as fresh opened candidate

      // Verify strict absence of narrative keys
      const rawObj = isolated as Record<string, unknown>;
      expect(rawObj.rationale).toBeUndefined();
      expect(rawObj.decided_at).toBeUndefined();
      expect(rawObj.decided_by).toBeUndefined();
      expect(rawObj.decline_reason).toBeUndefined();
      expect(rawObj.gate_failed).toBeUndefined();
      expect(rawObj.objective_run_id).toBeUndefined();
      expect(rawObj.adoption_notes).toBeUndefined();
      expect(rawObj.history).toBeUndefined();
      expect(rawObj.comments).toBeUndefined();

      const audit = auditCandidateIsolation(isolated);
      expect(audit.isolated).toBe(true);
      expect(audit.narrativeKeysFound).toEqual([]);
    });

    test("auditCandidateIsolation identifies leaked narrative keys", () => {
      const leaky = {
        id: "cand-1",
        kind: "defect",
        statement: "test",
        write_scope: ["src/"],
        status: "opened",
        rationale: "some narrative text",
        adoption_notes: "leaked notes",
      };

      const audit = auditCandidateIsolation(leaky);
      expect(audit.isolated).toBe(false);
      expect(audit.narrativeKeysFound).toContain("rationale");
      expect(audit.narrativeKeysFound).toContain("adoption_notes");
    });
  });

  describe("Fixed Defect Detection", () => {
    test("produces finding when witness command now exits 0 (clean, defect cleared)", () => {
      const ctx = setupTestEnvironment("fixed-witness-exit-0");

      recordCommandInRun(ctx.run, "cmd-witness-fixed", {
        exitCode: 0,
        stdout: "All 15 tests passed cleanly",
        stderr: "",
      });

      const candidate: CandidateRecord = {
        id: "cand-fixed-1",
        kind: "defect",
        statement: "All 15 tests passed cleanly",
        witness_command_id: "cmd-witness-fixed",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["false"],
        write_scope: ["src/"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(candidate, ctx.gateContext);

      expect(result.admissible).toBe(false);
      expect(result.defectPersists).toBe(false);
      expect(result.finding).toBeDefined();
      expect(result.finding?.findingKind).toBe("witness_exited_zero");
      expect(result.finding?.message).toContain("exited with code 0 (clean)");
      expect(result.finding?.details?.exitCode).toBe(0);
    });

    test("produces finding when witness command output does not contain defect statement", () => {
      const ctx = setupTestEnvironment("witness-output-missing");

      recordCommandInRun(ctx.run, "cmd-witness-no-defect", {
        exitCode: 1,
        stdout: "Unknown syntax error in unrelated module",
        stderr: "",
      });

      const candidate: CandidateRecord = {
        id: "cand-fixed-2",
        kind: "defect",
        statement: "Database connection pool timeout",
        witness_command_id: "cmd-witness-no-defect",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["false"],
        write_scope: ["src/"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(candidate, ctx.gateContext);

      expect(result.admissible).toBe(false);
      expect(result.defectPersists).toBe(false);
      expect(result.finding).toBeDefined();
      expect(result.finding?.findingKind).toBe("witness_output_missing");
      expect(result.finding?.message).toContain("does not contain cited defect");
    });

    test("produces finding when falsifier command now exits 0 against repo (defect resolved)", () => {
      const ctx = setupTestEnvironment("falsifier-now-passes");

      recordCommandInRun(ctx.run, "cmd-witness-real", {
        exitCode: 1,
        stdout: "Memory leak detected in stream consumer",
        stderr: "",
      });

      // Falsifier is `true`, meaning the test now passes!
      const candidate: CandidateRecord = {
        id: "cand-fixed-3",
        kind: "defect",
        statement: "Memory leak detected in stream consumer",
        witness_command_id: "cmd-witness-real",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["true"], // Exits 0!
        write_scope: ["src/"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(candidate, ctx.gateContext);

      expect(result.admissible).toBe(false);
      expect(result.defectPersists).toBe(false);
      expect(result.finding).toBeDefined();
      expect(result.finding?.findingKind).toBe("falsifier_passed");
      expect(result.finding?.message).toContain("exited with 0");
    });

    test("produces finding when witness command does not exist in any capsule", () => {
      const ctx = setupTestEnvironment("missing-witness");

      const candidate: CandidateRecord = {
        id: "cand-unwitnessed",
        kind: "defect",
        statement: "Phantom defect",
        witness_command_id: "non-existent-cmd-999",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["false"],
        write_scope: ["src/"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(candidate, ctx.gateContext);

      expect(result.admissible).toBe(false);
      expect(result.defectPersists).toBe(false);
      expect(result.finding).toBeDefined();
      expect(result.finding?.findingKind).toBe("defect_never_real");
      expect(result.finding?.message).toContain("not found in any capsule command records");
    });
  });

  describe("Persistent Defect Re-Admission Confirmation", () => {
    test("confirms re-admission validity when defect persists with failing witness and failing falsifier", () => {
      const ctx = setupTestEnvironment("persistent-defect");

      recordCommandInRun(ctx.run, "cmd-real-failure", {
        exitCode: 1,
        stdout: "AssertionError: expected status 200 but received 500",
        stderr: "Stack trace: at verifyAuth (src/auth.ts:42)",
      });

      const candidate: CandidateRecord = {
        id: "cand-real-defect",
        kind: "defect",
        statement: "AssertionError: expected status 200 but received 500",
        witness_command_id: "cmd-real-failure",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["false"], // Still fails with non-zero
        write_scope: ["src/"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(candidate, ctx.gateContext);

      expect(result.admissible).toBe(true);
      expect(result.defectPersists).toBe(true);
      expect(result.finding).toBeUndefined();
      expect(result.failingGate).toBeUndefined();
      expect(result.admissionVerdicts.length).toBe(6);
      expect(result.admissionVerdicts.every((v) => v.passed)).toBe(true);
    });

    test("validates admitted proposal candidate with owner-decision witness", () => {
      const ctx = setupTestEnvironment("proposal-readmission");

      const proposalCandidate: CandidateRecord = {
        id: "cand-prop-1",
        kind: "proposal",
        statement: "Add telemetry exporter for metrics",
        witness_command_id: "owner-decision",
        charter_goal_ids: ["G2"],
        falsifier_argv: ["false"],
        write_scope: ["src/"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(proposalCandidate, ctx.gateContext);

      expect(result.admissible).toBe(true);
      expect(result.defectPersists).toBe(true);
      expect(result.finding).toBeUndefined();
    });
  });

  describe("Candidate Selection & Suite Runner", () => {
    test("selectPreviouslyAdmittedCandidates filters only admitted candidates with selection strategies", () => {
      const state = {
        candidates: [
          {
            id: "c1",
            status: "admitted",
            kind: "defect",
            statement: "Defect 1",
            charter_goal_ids: ["G1"],
          },
          {
            id: "c2",
            status: "opened",
            kind: "defect",
            statement: "Defect 2",
            charter_goal_ids: ["G1"],
          },
          {
            id: "c3",
            status: "declined",
            kind: "defect",
            statement: "Defect 3",
            charter_goal_ids: ["G1"],
          },
          {
            id: "c4",
            status: "admitted",
            kind: "proposal",
            statement: "Proposal 1",
            charter_goal_ids: ["G2"],
          },
          {
            id: "c5",
            status: "admitted",
            kind: "defect",
            statement: "Defect 4",
            charter_goal_ids: ["G1"],
          },
        ],
      };

      const allAdmitted = selectPreviouslyAdmittedCandidates(state, { strategy: "all" });
      expect(allAdmitted.length).toBe(3);
      expect(allAdmitted.map((c) => c.id)).toEqual(["c1", "c4", "c5"]);

      const defectsOnly = selectPreviouslyAdmittedCandidates(state, { filterKind: "defect" });
      expect(defectsOnly.length).toBe(2);
      expect(defectsOnly.map((c) => c.id)).toEqual(["c1", "c5"]);

      const proposalsOnly = selectPreviouslyAdmittedCandidates(state, { filterKind: "proposal" });
      expect(proposalsOnly.length).toBe(1);
      expect(proposalsOnly[0]?.id).toBe("c4");

      const sampled = selectPreviouslyAdmittedCandidates(state, { count: 2, strategy: "all" });
      expect(sampled.length).toBe(2);

      const newest = selectPreviouslyAdmittedCandidates(state, { strategy: "newest" });
      expect(newest[0]?.id).toBe("c5");
    });

    test("runCounterfactualReAdmissionSuite executes batch evaluation and aggregates findings", () => {
      const ctx = setupTestEnvironment("batch-suite");

      // Set up witness commands
      recordCommandInRun(ctx.run, "cmd-witness-persisting", {
        exitCode: 1,
        stdout: "Failure in parser: unexpected token EOF",
        stderr: "",
      });
      recordCommandInRun(ctx.run, "cmd-witness-fixed", {
        exitCode: 0,
        stdout: "Clean exit",
        stderr: "",
      });

      const state = {
        candidates: [
          {
            id: "cand-persist",
            status: "admitted",
            kind: "defect",
            statement: "Failure in parser: unexpected token EOF",
            witness_command_id: "cmd-witness-persisting",
            charter_goal_ids: ["G1"],
            falsifier_argv: ["false"],
            write_scope: ["src/"],
          },
          {
            id: "cand-cleared",
            status: "admitted",
            kind: "defect",
            statement: "Failure in parser: unexpected token EOF",
            witness_command_id: "cmd-witness-fixed",
            charter_goal_ids: ["G1"],
            falsifier_argv: ["false"],
            write_scope: ["src/"],
          },
        ],
      };

      const suiteResult = runCounterfactualReAdmissionSuite(state, ctx.gateContext);

      expect(suiteResult.totalEvaluated).toBe(2);
      expect(suiteResult.persistentCount).toBe(1);
      expect(suiteResult.clearedCount).toBe(1);
      expect(suiteResult.findingsCount).toBe(1);
      expect(suiteResult.findings[0]?.candidateId).toBe("cand-cleared");
      expect(suiteResult.findings[0]?.findingKind).toBe("witness_exited_zero");

      const markdown = formatCounterfactualReportMarkdown(suiteResult);
      expect(markdown).toContain("Counterfactual Re-Admission Test Report");
      expect(markdown).toContain("**Persistent Defects (Confirmed)**: 1");
      expect(markdown).toContain("**Cleared / Non-Persisting Findings**: 1");
      expect(markdown).toContain("`cand-cleared`");
    });
  });

  describe("Admission Gate Failures Under Fresh Context", () => {
    test("produces finding if charter goal was removed or invalid", () => {
      const ctx = setupTestEnvironment("invalid-goal-readmit");

      recordCommandInRun(ctx.run, "cmd-witness-valid", {
        exitCode: 1,
        stdout: "Defect present",
        stderr: "",
      });

      const candidate: CandidateRecord = {
        id: "cand-bad-goal",
        kind: "defect",
        statement: "Defect present",
        witness_command_id: "cmd-witness-valid",
        charter_goal_ids: ["G999_NON_EXISTENT"],
        falsifier_argv: ["false"],
        write_scope: ["src/"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(candidate, ctx.gateContext);

      expect(result.admissible).toBe(false);
      expect(result.finding).toBeDefined();
      expect(result.finding?.gateId).toBe("gate-2-in-charter");
      expect(result.finding?.message).toContain("charter goal 'G999_NON_EXISTENT' does not exist");
    });

    test("produces finding if write scope is outside repo roots", () => {
      const ctx = setupTestEnvironment("bad-scope-readmit");

      recordCommandInRun(ctx.run, "cmd-witness-valid", {
        exitCode: 1,
        stdout: "Defect present",
        stderr: "",
      });

      const candidate: CandidateRecord = {
        id: "cand-bad-scope",
        kind: "defect",
        statement: "Defect present",
        witness_command_id: "cmd-witness-valid",
        charter_goal_ids: ["G1"],
        falsifier_argv: ["false"],
        write_scope: ["/external/forbidden/path"],
        status: "admitted",
      };

      const result = evaluateCandidateCounterfactual(candidate, ctx.gateContext);

      expect(result.admissible).toBe(false);
      expect(result.finding).toBeDefined();
      expect(result.finding?.gateId).toBe("gate-4-scoped");
      expect(result.finding?.message).toContain("outside charter repo_roots");
    });
  });
});
