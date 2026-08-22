import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/agent-ops.ts";
import { mindAdmitCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-admit.ts";
import type {
  JsonObject,
  JsonValue,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  evaluateAdmissionGates,
  evaluateGate1Witnessed,
  evaluateGate2InCharter,
  evaluateGate3Falsifiable,
  evaluateGate4Scoped,
  evaluateGate5Affordable,
  evaluateGate6NotADuplicate,
  type AdmissionGateVerdict,
  type CandidateRecord,
  type GateEvaluationContext,
} from "../../../orchestrating-long-tasks/scripts/src/mind/gates.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempRoots.length = 0;
});

interface MindTestContext {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
}

function setupNegativeAdmissionTest(
  name: string,
  options: {
    readonly charterContent?: string;
    readonly pulseOpen?: boolean;
    readonly budget?: Record<string, unknown>;
    readonly candidates?: readonly CandidateRecord[];
    readonly tasks?: Record<string, unknown>;
    readonly agents?: readonly Record<string, unknown>[];
    readonly commands?: Record<string, unknown>;
  } = {},
): MindTestContext {
  const repo = mkdtempSync(join(tmpdir(), `mind-admission-neg-${name}-`));
  tempRoots.push(repo);

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent =
    options.charterContent ??
    `# CHARTER\n\n## identity\nNegative admission test suite\n\n## goals\n- G1: Ensure stability\n- G2: Comprehensive verification\n\n## non-goals\n- UI redesign\n- Out of scope\n\n## repo_roots\n- \`src/\`\n- \`orchestrating-long-tasks/\`\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-neg-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "docs/mind/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/mind/CHARTER.md",
          pinned_sha256: charterSha,
          goals: ["G1", "G2"],
          non_goals: ["UI redesign", "Out of scope"],
          repo_roots: ["src/", "orchestrating-long-tasks/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };

      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21600000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900000,
        max_interval_ms: 14400000,
        max_pause_interval_ms: 1800000,
        pulse_deadline_ms: 1200000,
        max_open_proposals: 5,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 1,
        wall_clock_ms_today: 60000,
        ...(options.budget ?? {}),
      };

      if (options.pulseOpen !== false) {
        working.pulse = {
          open: {
            pulse_id: "pulse-1",
            opened_at: new Date().toISOString(),
            deadline_at: new Date(Date.now() + 1200000).toISOString(),
            actor: "mind-1",
            host: "antigravity",
            driver: "unit-test",
          },
          counter: 1,
        };
      }

      if (options.candidates) {
        working.candidates = [...options.candidates] as unknown as JsonValue;
      }

      if (options.tasks) {
        working.tasks = { ...options.tasks } as unknown as JsonObject;
      }

      if (options.agents) {
        working.agents = [...options.agents] as unknown as JsonValue;
      }

      if (options.commands) {
        working.commands = { ...options.commands } as unknown as JsonObject;
      }
    },
  );

  return { repo, run, charterPath };
}

function writeRecordedCommand(
  runRoot: string,
  commandId: string,
  record: {
    readonly exit_code: number;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly status?: string;
  },
): void {
  const cmdDir = join(runRoot, "commands", commandId);
  const attemptDir = join(cmdDir, "attempt-1");
  mkdirSync(attemptDir, { recursive: true });

  const stdoutPath = join(attemptDir, "stdout.log");
  const stderrPath = join(attemptDir, "stderr.log");
  writeFileSync(stdoutPath, record.stdout ?? "", "utf-8");
  writeFileSync(stderrPath, record.stderr ?? "", "utf-8");

  const fullRecord = {
    id: commandId,
    actor: "mind-1",
    exit_code: record.exit_code,
    status: record.status ?? (record.exit_code === 0 ? "succeeded" : "failed"),
    logs: {
      stdout: {
        path: `commands/${commandId}/attempt-1/stdout.log`,
        bytes: (record.stdout ?? "").length,
      },
      stderr: {
        path: `commands/${commandId}/attempt-1/stderr.log`,
        bytes: (record.stderr ?? "").length,
      },
    },
    attempts: [
      {
        attempt: 1,
        exit_code: record.exit_code,
        logs: {
          stdout: {
            path: `commands/${commandId}/attempt-1/stdout.log`,
            bytes: (record.stdout ?? "").length,
          },
          stderr: {
            path: `commands/${commandId}/attempt-1/stderr.log`,
            bytes: (record.stderr ?? "").length,
          },
        },
      },
    ],
  };

  writeFileSync(join(cmdDir, "record.json"), JSON.stringify(fullRecord, null, 2), "utf-8");
}

describe("PHASE-3 §4.1: Twenty Negative Admission Gate Refusals", () => {
  // -------------------------------------------------------------------------
  // Gate 1 Refusals (1 to 5)
  // -------------------------------------------------------------------------

  test("1. refusal-g1-no-witness: Refuses defect candidate without --witness", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-1");
    const candidate: CandidateRecord = {
      id: "cand-refusal-1",
      kind: "defect",
      statement: "syntax error in tokenizer",
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/tokenizer.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate1Witnessed(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.gateNumber).toBe(1);
    expect(verdict.reason).toContain("no witness command record");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--witness");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-1-witnessed");
    expect(evalResult.failingGate?.gateNumber).toBe(1);
    expect(evalResult.failingGate?.repairArgv).toContain("--witness");
  });

  test("2. refusal-g1-404-cmd: Refuses candidate citing non-existent command record ID", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-2");
    const candidate: CandidateRecord = {
      id: "cand-refusal-2",
      kind: "defect",
      statement: "parser compilation failure",
      witness_command_id: "C-nonexistent-command-404",
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/parser.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate1Witnessed(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.gateNumber).toBe(1);
    expect(verdict.reason).toContain("not found in any capsule command records");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("run:exec");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-1-witnessed");
    expect(evalResult.failingGate?.gateNumber).toBe(1);
  });

  test("3. refusal-g1-exit-0: Refuses candidate citing command record whose exit code was 0", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-3");
    const cmdId = "C-witness-exit-0";
    writeRecordedCommand(run, cmdId, {
      exit_code: 0,
      stdout: "all 48 test suites passed cleanly",
      status: "succeeded",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-3",
      kind: "defect",
      statement: "test suite failure",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/tests.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate1Witnessed(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.gateNumber).toBe(1);
    expect(verdict.reason).toContain("recorded exit was 0; a defect witness must exit non-zero");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("run:exec");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-1-witnessed");
    expect(evalResult.failingGate?.gateNumber).toBe(1);
  });

  test("4. refusal-g1-no-defect-text: Refuses candidate whose witness output does not contain defect text", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-4");
    const cmdId = "C-witness-unrelated-error";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "DatabaseConnectionRefused on port 5432",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-4",
      kind: "defect",
      statement: "tokenizer parser syntax token error",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/ast.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate1Witnessed(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.gateNumber).toBe(1);
    expect(verdict.reason).toContain("output does not contain the cited defect");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("mind:candidate");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-1-witnessed");
    expect(evalResult.failingGate?.gateNumber).toBe(1);
  });

  test("5. refusal-g1-proposal-no-authority: Refuses proposal candidate without owner-decision witness", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-5");
    const candidate: CandidateRecord = {
      id: "cand-refusal-5",
      kind: "proposal",
      statement: "Add automated cache warming daemon",
      witness_command_id: null,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/cache.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate1Witnessed(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.gateNumber).toBe(1);
    expect(verdict.reason).toContain(
      "proposals require an owner authority decision ('owner-decision') before admission",
    );
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("authority:decide");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-1-witnessed");
    expect(evalResult.failingGate?.gateNumber).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Gate 2 Refusals (6 to 8)
  // -------------------------------------------------------------------------

  test("6. refusal-g2-no-goal: Refuses candidate citing empty or missing charter goal IDs", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-6");
    const cmdId = "C-witness-pass-g1";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "TypeError: candidate missing goal in pipeline.ts",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-6",
      kind: "defect",
      statement: "pipeline.ts TypeError missing goal",
      witness_command_id: cmdId,
      charter_goal_ids: [],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/pipeline.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate2InCharter(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-2-in-charter");
    expect(verdict.gateNumber).toBe(2);
    expect(verdict.reason).toContain("candidate cites no charter goals");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--charter-goal");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-2-in-charter");
    expect(evalResult.failingGate?.gateNumber).toBe(2);
  });

  test("7. refusal-g2-wrong-goal: Refuses candidate citing goal ID not in pinned charter", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-7");
    const cmdId = "C-witness-pass-g1-wrong-goal";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "TypeError in server.ts: unhandled exception",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-7",
      kind: "defect",
      statement: "server.ts unhandled exception",
      witness_command_id: cmdId,
      charter_goal_ids: ["G999-deprecated-generation"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/server.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate2InCharter(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-2-in-charter");
    expect(verdict.gateNumber).toBe(2);
    expect(verdict.reason).toContain(
      "charter goal 'G999-deprecated-generation' does not exist in pinned charter",
    );
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--charter-goal");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-2-in-charter");
    expect(evalResult.failingGate?.gateNumber).toBe(2);
  });

  test("8. refusal-g2-non-goal: Refuses candidate matching charter non-goal", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-8");
    const cmdId = "C-witness-pass-g1-nongoal";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Layout defect: UI redesign of dashboard headers failed",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-8",
      kind: "defect",
      statement: "UI redesign of dashboard headers",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/ui/dashboard.tsx"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate2InCharter(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-2-in-charter");
    expect(verdict.gateNumber).toBe(2);
    expect(verdict.reason).toContain("matches charter non-goal 'UI redesign'");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("mind:candidate");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-2-in-charter");
    expect(evalResult.failingGate?.gateNumber).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Gate 3 Refusals (9 to 10)
  // -------------------------------------------------------------------------

  test("9. refusal-g3-falsifier-zero: Refuses candidate whose falsifier command exits 0", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-9");
    const cmdId = "C-witness-falsifier-zero";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "AssertionError: falsifier zero defect in runner.ts",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-9",
      kind: "defect",
      statement: "falsifier zero defect in runner.ts",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(0)"],
      write_scope: ["src/runner.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate3Falsifiable(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-3-falsifiable");
    expect(verdict.gateNumber).toBe(3);
    expect(verdict.reason).toContain("exited with 0; a falsifier must fail (exit non-zero)");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--falsifier");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-3-falsifiable");
    expect(evalResult.failingGate?.gateNumber).toBe(3);
  });

  test("10. refusal-g3-falsifier-missing: Refuses candidate with missing/empty falsifier command declaration", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-10");
    const cmdId = "C-witness-falsifier-missing";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Error: missing falsifier declaration in compiler.ts",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-10",
      kind: "defect",
      statement: "compiler.ts missing falsifier declaration",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: [],
      write_scope: ["src/compiler.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate3Falsifiable(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-3-falsifiable");
    expect(verdict.gateNumber).toBe(3);
    expect(verdict.reason).toContain("has no falsifier argv declared");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--falsifier");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-3-falsifiable");
    expect(evalResult.failingGate?.gateNumber).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Gate 4 Refusals (11 to 14)
  // -------------------------------------------------------------------------

  test("11. refusal-g4-empty-scope: Refuses candidate with empty write scope", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-11");
    const cmdId = "C-witness-empty-scope";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Error: empty write scope in handler.ts",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-11",
      kind: "defect",
      statement: "handler.ts empty write scope defect",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: [],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate4Scoped(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-4-scoped");
    expect(verdict.gateNumber).toBe(4);
    expect(verdict.reason).toContain("write scope is empty");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--write-scope");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-4-scoped");
    expect(evalResult.failingGate?.gateNumber).toBe(4);
  });

  test("12. refusal-g4-outside-roots: Refuses candidate whose write scope is outside charter repo_roots", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-12");
    const cmdId = "C-witness-outside-roots";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Error in docs/planning/mind/PLAN.md: invalid markdown structure",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-12",
      kind: "defect",
      statement: "docs/planning/mind/PLAN.md markdown defect",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["docs/planning/mind/PLAN.md"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate4Scoped(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-4-scoped");
    expect(verdict.gateNumber).toBe(4);
    expect(verdict.reason).toContain("is outside charter repo_roots");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--write-scope");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-4-scoped");
    expect(evalResult.failingGate?.gateNumber).toBe(4);
  });

  test("13. refusal-g4-lease-collision: Refuses candidate whose write scope collides with active task lease", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-13");
    const cmdId = "C-witness-lease-collision";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "SyntaxError in src/services/worker.ts: unexpected token",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-13",
      kind: "defect",
      statement: "src/services/worker.ts unexpected token",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/services/worker.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        tasks: {
          "task-live-lease-42": {
            id: "task-live-lease-42",
            status: "leased",
            lease: {
              agent: "impl-other",
              write_scope: ["src/services/worker.ts"],
              expires_at: new Date(Date.now() + 600000).toISOString(),
            },
          },
        },
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate4Scoped(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-4-scoped");
    expect(verdict.gateNumber).toBe(4);
    expect(verdict.reason).toContain(
      "write scope conflicts with live task lease 'task-live-lease-42'",
    );
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--write-scope");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-4-scoped");
    expect(evalResult.failingGate?.gateNumber).toBe(4);
  });

  test("14. refusal-g4-candidate-collision: Refuses candidate whose write scope collides with open candidate", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-14");
    const cmdId = "C-witness-candidate-collision";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "TypeError in src/router.ts: route undefined",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-14-incoming",
      kind: "defect",
      statement: "src/router.ts route undefined",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/router.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        candidates: [
          {
            id: "cand-other-active-open",
            kind: "defect",
            statement: "other router fix",
            write_scope: ["src/router.ts"],
            status: "opened",
          },
        ],
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate4Scoped(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-4-scoped");
    expect(verdict.gateNumber).toBe(4);
    expect(verdict.reason).toContain(
      "write scope conflicts with active candidate 'cand-other-active-open'",
    );
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("--write-scope");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-4-scoped");
    expect(evalResult.failingGate?.gateNumber).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Gate 5 Refusals (15 to 17)
  // -------------------------------------------------------------------------

  test("15. refusal-g5-pulse-budget: Refuses candidate when daily pulse budget is exhausted", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-15");
    const cmdId = "C-witness-pulse-budget";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Error in src/metrics.ts: counter overflow",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-15",
      kind: "defect",
      statement: "src/metrics.ts counter overflow",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/metrics.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        budget: {
          pulses_per_day: 96,
          pulses_today: 96,
          wall_clock_ms_per_day: 21600000,
          wall_clock_ms_today: 1000,
          max_agents_in_flight: 8,
        },
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate5Affordable(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-5-affordable");
    expect(verdict.gateNumber).toBe(5);
    expect(verdict.reason).toContain("daily pulse budget exhausted (96/96 pulses today)");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("mind:wake");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-5-affordable");
    expect(evalResult.failingGate?.gateNumber).toBe(5);
  });

  test("16. refusal-g5-clock-budget: Refuses candidate when daily wall-clock budget is exhausted", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-16");
    const cmdId = "C-witness-clock-budget";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Error in src/timer.ts: timeout threshold exceeded",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-16",
      kind: "defect",
      statement: "src/timer.ts timeout threshold exceeded",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/timer.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        budget: {
          pulses_per_day: 96,
          pulses_today: 10,
          wall_clock_ms_per_day: 21600000,
          wall_clock_ms_today: 22000000,
          max_agents_in_flight: 8,
        },
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate5Affordable(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-5-affordable");
    expect(verdict.gateNumber).toBe(5);
    expect(verdict.reason).toContain("daily wall-clock budget exhausted");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("mind:wake");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-5-affordable");
    expect(evalResult.failingGate?.gateNumber).toBe(5);
  });

  test("17. refusal-g5-max-agents: Refuses candidate when max agents in flight is reached", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-17");
    const cmdId = "C-witness-max-agents";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Error in src/pool.ts: max workers active",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-17",
      kind: "defect",
      statement: "src/pool.ts max workers active defect",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/pool.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        budget: {
          pulses_per_day: 96,
          pulses_today: 5,
          wall_clock_ms_per_day: 21600000,
          wall_clock_ms_today: 1000,
          max_agents_in_flight: 2,
        },
        agents: [
          { id: "agent-impl-1", role: "implementer", status: "active" },
          { id: "agent-val-1", role: "validator", status: "active" },
        ],
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate5Affordable(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-5-affordable");
    expect(verdict.gateNumber).toBe(5);
    expect(verdict.reason).toContain("max agents in flight reached (2/2)");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("agent:release");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-5-affordable");
    expect(evalResult.failingGate?.gateNumber).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Gate 6 Refusals (18 to 20)
  // -------------------------------------------------------------------------

  test("18. refusal-g6-dup-open: Refuses duplicate of open candidate", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-18");
    const cmdId = "C-witness-dup-open";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "TypeError TS2345 in src/utils/format.ts: invalid arg format",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-18-new",
      kind: "defect",
      statement: "format.ts invalid arg format",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/utils/format.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        candidates: [
          {
            id: "cand-existing-open",
            kind: "defect",
            statement: "format.ts invalid arg format",
            witness_command_id: cmdId,
            charter_goal_ids: ["G1"],
            write_scope: ["src/utils/other-format.ts"],
            status: "opened",
          },
        ],
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate6NotADuplicate(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-6-not-a-duplicate");
    expect(verdict.gateNumber).toBe(6);
    expect(verdict.reason).toContain(
      "candidate is a duplicate of active candidate 'cand-existing-open'",
    );
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("mind:candidate");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-6-not-a-duplicate");
    expect(evalResult.failingGate?.gateNumber).toBe(6);
  });

  test("19. refusal-g6-dup-task: Refuses duplicate of active live task", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-19");
    const cmdId = "C-witness-dup-task";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Error in src/auth/jwt.ts: token signature expired",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-19-new",
      kind: "defect",
      statement: "jwt.ts token signature expired",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/auth/jwt.ts"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        tasks: {
          "task-jwt-fix": {
            id: "task-jwt-fix",
            label: "jwt.ts token signature expired",
            status: "ready",
            write_scope: ["src/auth/jwt.ts"],
          },
        },
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate6NotADuplicate(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-6-not-a-duplicate");
    expect(verdict.gateNumber).toBe(6);
    expect(verdict.reason).toContain("candidate is a duplicate of live task 'task-jwt-fix'");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("mind:candidate");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-6-not-a-duplicate");
    expect(evalResult.failingGate?.gateNumber).toBe(6);
  });

  test("20. refusal-g6-declined-forever: Refuses duplicate of permanently declined candidate", () => {
    const { repo, run } = setupNegativeAdmissionTest("refusal-20");
    const cmdId = "C-witness-declined-forever";
    writeRecordedCommand(run, cmdId, {
      exit_code: 1,
      stderr: "Lint notice: style cleanup in src/views/item.tsx",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-refusal-20-new",
      kind: "defect",
      statement: "style cleanup in item.tsx",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/views/item.tsx"],
      status: "opened",
    };

    const context: GateEvaluationContext = {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        candidates: [
          {
            id: "cand-declined-yesterday",
            kind: "defect",
            statement: "style cleanup in item.tsx",
            witness_command_id: cmdId,
            charter_goal_ids: ["G1"],
            write_scope: ["src/views/item.tsx"],
            status: "declined",
            decline_reason: "frivolous busywork styling refactor",
            decided_at: "2026-08-20T08:00:00.000Z",
          },
        ],
      },
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
      repoRoots: ["src/"],
    };

    const verdict: AdmissionGateVerdict = evaluateGate6NotADuplicate(candidate, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-6-not-a-duplicate");
    expect(verdict.gateNumber).toBe(6);
    expect(verdict.reason).toContain(
      "candidate is a duplicate of permanently declined candidate 'cand-declined-yesterday'",
    );
    expect(verdict.reason).toContain("frivolous busywork styling refactor");
    expect(verdict.repairArgv).toBeDefined();
    expect(verdict.repairArgv).toContain("mind:candidate");

    const evalResult = evaluateAdmissionGates(candidate, context);
    expect(evalResult.admitted).toBe(false);
    expect(evalResult.failingGate?.gateId).toBe("gate-6-not-a-duplicate");
    expect(evalResult.failingGate?.gateNumber).toBe(6);
  });

  // -------------------------------------------------------------------------
  // Comprehensive Matrix Summary Test (All 20 Refusals in Table)
  // -------------------------------------------------------------------------

  test("Matrix: All 20 refusals return expected gate_id and actionable repair_argv", () => {
    interface RefusalSpec {
      readonly code: string;
      readonly expectedGateNumber: number;
      readonly expectedGateId: string;
      readonly createCandidateAndContext: (
        repo: string,
        run: string,
      ) => { candidate: CandidateRecord; context: GateEvaluationContext };
    }

    const refusalSpecs: readonly RefusalSpec[] = [
      {
        code: "refusal-g1-no-witness",
        expectedGateNumber: 1,
        expectedGateId: "gate-1-witnessed",
        createCandidateAndContext: (repo, run) => ({
          candidate: {
            id: "m-cand-1",
            kind: "defect",
            statement: "missing witness",
            charter_goal_ids: ["G1"],
            falsifier_argv: ["bun", "-e", "process.exit(1)"],
            write_scope: ["src/a.ts"],
            status: "opened",
          },
          context: {
            runRoot: run,
            repoRoot: repo,
            actor: "mind-1",
            state: {},
            charterGoals: new Set(["G1"]),
            repoRoots: ["src/"],
          },
        }),
      },
      {
        code: "refusal-g1-404-cmd",
        expectedGateNumber: 1,
        expectedGateId: "gate-1-witnessed",
        createCandidateAndContext: (repo, run) => ({
          candidate: {
            id: "m-cand-2",
            kind: "defect",
            statement: "404 cmd",
            witness_command_id: "C-404-cmd",
            charter_goal_ids: ["G1"],
            falsifier_argv: ["bun", "-e", "process.exit(1)"],
            write_scope: ["src/a.ts"],
            status: "opened",
          },
          context: {
            runRoot: run,
            repoRoot: repo,
            actor: "mind-1",
            state: {},
            charterGoals: new Set(["G1"]),
            repoRoots: ["src/"],
          },
        }),
      },
      {
        code: "refusal-g1-exit-0",
        expectedGateNumber: 1,
        expectedGateId: "gate-1-witnessed",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-exit0", { exit_code: 0, stdout: "clean run" });
          return {
            candidate: {
              id: "m-cand-3",
              kind: "defect",
              statement: "exit 0 cmd",
              witness_command_id: "C-matrix-exit0",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g1-no-defect-text",
        expectedGateNumber: 1,
        expectedGateId: "gate-1-witnessed",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-mismatch", {
            exit_code: 1,
            stderr: "DatabaseConnectionRefused on port 5432",
          });
          return {
            candidate: {
              id: "m-cand-4",
              kind: "defect",
              statement: "tokenizer parser syntax token error",
              witness_command_id: "C-matrix-mismatch",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g1-proposal-no-authority",
        expectedGateNumber: 1,
        expectedGateId: "gate-1-witnessed",
        createCandidateAndContext: (repo, run) => ({
          candidate: {
            id: "m-cand-5",
            kind: "proposal",
            statement: "unauthorized proposal",
            charter_goal_ids: ["G1"],
            falsifier_argv: ["bun", "-e", "process.exit(1)"],
            write_scope: ["src/a.ts"],
            status: "opened",
          },
          context: {
            runRoot: run,
            repoRoot: repo,
            actor: "mind-1",
            state: {},
            charterGoals: new Set(["G1"]),
            repoRoots: ["src/"],
          },
        }),
      },
      {
        code: "refusal-g2-no-goal",
        expectedGateNumber: 2,
        expectedGateId: "gate-2-in-charter",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g2-no-goal", {
            exit_code: 1,
            stderr: "defect in a.ts",
          });
          return {
            candidate: {
              id: "m-cand-6",
              kind: "defect",
              statement: "defect in a.ts",
              witness_command_id: "C-matrix-g2-no-goal",
              charter_goal_ids: [],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g2-wrong-goal",
        expectedGateNumber: 2,
        expectedGateId: "gate-2-in-charter",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g2-wrong-goal", {
            exit_code: 1,
            stderr: "defect in a.ts",
          });
          return {
            candidate: {
              id: "m-cand-7",
              kind: "defect",
              statement: "defect in a.ts",
              witness_command_id: "C-matrix-g2-wrong-goal",
              charter_goal_ids: ["G-unknown-999"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g2-non-goal",
        expectedGateNumber: 2,
        expectedGateId: "gate-2-in-charter",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g2-non-goal", {
            exit_code: 1,
            stderr: "UI redesign defect",
          });
          return {
            candidate: {
              id: "m-cand-8",
              kind: "defect",
              statement: "UI redesign defect",
              witness_command_id: "C-matrix-g2-non-goal",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              charterNonGoals: ["UI redesign"],
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g3-falsifier-zero",
        expectedGateNumber: 3,
        expectedGateId: "gate-3-falsifiable",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g3-falsifier-zero", {
            exit_code: 1,
            stderr: "falsifier defect",
          });
          return {
            candidate: {
              id: "m-cand-9",
              kind: "defect",
              statement: "falsifier defect",
              witness_command_id: "C-matrix-g3-falsifier-zero",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(0)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g3-falsifier-missing",
        expectedGateNumber: 3,
        expectedGateId: "gate-3-falsifiable",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g3-falsifier-missing", {
            exit_code: 1,
            stderr: "falsifier missing defect",
          });
          return {
            candidate: {
              id: "m-cand-10",
              kind: "defect",
              statement: "falsifier missing defect",
              witness_command_id: "C-matrix-g3-falsifier-missing",
              charter_goal_ids: ["G1"],
              falsifier_argv: [],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g4-empty-scope",
        expectedGateNumber: 4,
        expectedGateId: "gate-4-scoped",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g4-empty-scope", {
            exit_code: 1,
            stderr: "scope defect",
          });
          return {
            candidate: {
              id: "m-cand-11",
              kind: "defect",
              statement: "scope defect",
              witness_command_id: "C-matrix-g4-empty-scope",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: [],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g4-outside-roots",
        expectedGateNumber: 4,
        expectedGateId: "gate-4-scoped",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g4-outside-roots", {
            exit_code: 1,
            stderr: "scope defect",
          });
          return {
            candidate: {
              id: "m-cand-12",
              kind: "defect",
              statement: "scope defect",
              witness_command_id: "C-matrix-g4-outside-roots",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["docs/planning/mind/PLAN.md"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {},
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g4-lease-collision",
        expectedGateNumber: 4,
        expectedGateId: "gate-4-scoped",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g4-lease-collision", {
            exit_code: 1,
            stderr: "scope defect",
          });
          return {
            candidate: {
              id: "m-cand-13",
              kind: "defect",
              statement: "scope defect",
              witness_command_id: "C-matrix-g4-lease-collision",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                tasks: {
                  "task-collision": {
                    id: "task-collision",
                    status: "leased",
                    lease: { write_scope: ["src/a.ts"] },
                  },
                },
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g4-candidate-collision",
        expectedGateNumber: 4,
        expectedGateId: "gate-4-scoped",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g4-cand-collision", {
            exit_code: 1,
            stderr: "scope defect",
          });
          return {
            candidate: {
              id: "m-cand-14",
              kind: "defect",
              statement: "scope defect",
              witness_command_id: "C-matrix-g4-cand-collision",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                candidates: [
                  {
                    id: "cand-existing-active",
                    kind: "defect",
                    statement: "other item",
                    write_scope: ["src/a.ts"],
                    status: "opened",
                  },
                ],
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g5-pulse-budget",
        expectedGateNumber: 5,
        expectedGateId: "gate-5-affordable",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g5-pulse", { exit_code: 1, stderr: "budget defect" });
          return {
            candidate: {
              id: "m-cand-15",
              kind: "defect",
              statement: "budget defect",
              witness_command_id: "C-matrix-g5-pulse",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                budget: {
                  pulses_per_day: 10,
                  pulses_today: 10,
                  wall_clock_ms_per_day: 100000,
                  wall_clock_ms_today: 0,
                  max_agents_in_flight: 5,
                },
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g5-clock-budget",
        expectedGateNumber: 5,
        expectedGateId: "gate-5-affordable",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g5-clock", { exit_code: 1, stderr: "budget defect" });
          return {
            candidate: {
              id: "m-cand-16",
              kind: "defect",
              statement: "budget defect",
              witness_command_id: "C-matrix-g5-clock",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                budget: {
                  pulses_per_day: 10,
                  pulses_today: 1,
                  wall_clock_ms_per_day: 10000,
                  wall_clock_ms_today: 10000,
                  max_agents_in_flight: 5,
                },
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g5-max-agents",
        expectedGateNumber: 5,
        expectedGateId: "gate-5-affordable",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g5-agents", {
            exit_code: 1,
            stderr: "budget defect",
          });
          return {
            candidate: {
              id: "m-cand-17",
              kind: "defect",
              statement: "budget defect",
              witness_command_id: "C-matrix-g5-agents",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                budget: {
                  pulses_per_day: 10,
                  pulses_today: 1,
                  wall_clock_ms_per_day: 10000,
                  wall_clock_ms_today: 100,
                  max_agents_in_flight: 1,
                },
                agents: [{ id: "agent-1", role: "implementer", status: "active" }],
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g6-dup-open",
        expectedGateNumber: 6,
        expectedGateId: "gate-6-not-a-duplicate",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g6-dup-open", {
            exit_code: 1,
            stderr: "duplicate defect",
          });
          return {
            candidate: {
              id: "m-cand-18",
              kind: "defect",
              statement: "duplicate defect",
              witness_command_id: "C-matrix-g6-dup-open",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                candidates: [
                  {
                    id: "cand-existing-open",
                    kind: "defect",
                    statement: "duplicate defect",
                    witness_command_id: "C-matrix-g6-dup-open",
                    write_scope: ["src/b.ts"],
                    status: "opened",
                  },
                ],
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g6-dup-task",
        expectedGateNumber: 6,
        expectedGateId: "gate-6-not-a-duplicate",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g6-dup-task", {
            exit_code: 1,
            stderr: "task dup defect",
          });
          return {
            candidate: {
              id: "m-cand-19",
              kind: "defect",
              statement: "task dup defect",
              witness_command_id: "C-matrix-g6-dup-task",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                tasks: {
                  "task-active": {
                    id: "task-active",
                    label: "task dup defect",
                    status: "ready",
                    write_scope: ["src/a.ts"],
                  },
                },
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
      {
        code: "refusal-g6-declined-forever",
        expectedGateNumber: 6,
        expectedGateId: "gate-6-not-a-duplicate",
        createCandidateAndContext: (repo, run) => {
          writeRecordedCommand(run, "C-matrix-g6-declined", {
            exit_code: 1,
            stderr: "declined forever defect",
          });
          return {
            candidate: {
              id: "m-cand-20",
              kind: "defect",
              statement: "declined forever defect",
              witness_command_id: "C-matrix-g6-declined",
              charter_goal_ids: ["G1"],
              falsifier_argv: ["bun", "-e", "process.exit(1)"],
              write_scope: ["src/a.ts"],
              status: "opened",
            },
            context: {
              runRoot: run,
              repoRoot: repo,
              actor: "mind-1",
              state: {
                candidates: [
                  {
                    id: "cand-declined-forever",
                    kind: "defect",
                    statement: "declined forever defect",
                    witness_command_id: "C-matrix-g6-declined",
                    write_scope: ["src/a.ts"],
                    status: "declined",
                    decline_reason: "out of scope forever",
                  },
                ],
              },
              charterGoals: new Set(["G1"]),
              repoRoots: ["src/"],
            },
          };
        },
      },
    ];

    expect(refusalSpecs.length).toBe(20);

    for (const spec of refusalSpecs) {
      const { repo, run } = setupNegativeAdmissionTest(`matrix-${spec.code}`);
      const { candidate, context } = spec.createCandidateAndContext(repo, run);

      const evalResult = evaluateAdmissionGates(candidate, context);
      expect(evalResult.admitted).toBe(false);
      expect(evalResult.failingGate).toBeDefined();
      expect(evalResult.failingGate?.gateNumber).toBe(spec.expectedGateNumber);
      expect(evalResult.failingGate?.gateId).toBe(spec.expectedGateId);
      expect(evalResult.failingGate?.repairArgv).toBeDefined();
      expect(typeof evalResult.failingGate?.repairArgv).toBe("string");
      expect(evalResult.failingGate?.repairArgv!.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // CLI mind:admit End-to-End Rejection and Event Sequence Invariance
  // -------------------------------------------------------------------------

  test("CLI mindAdmitCommand: Refusal raises HarnessError with issue details and preserves event sequence", () => {
    const candidate: CandidateRecord = {
      id: "cand-cli-refused",
      kind: "defect",
      statement: "syntax error in worker",
      charter_goal_ids: ["G1"],
      write_scope: ["src/worker.ts"],
      status: "opened",
    };

    const { run } = setupNegativeAdmissionTest("cli-refusal-invariance", {
      candidates: [candidate],
    });

    agentRegisterCommand({
      run,
      agent: "mind-1",
      role: "mind",
      host: "antigravity",
    });

    const runBefore = loadRun(run, false);
    const eventCountBefore = runBefore.events.length;

    let caughtError: HarnessError | null = null;
    try {
      mindAdmitCommand({
        run,
        actor: "mind-1",
        candidate: "cand-cli-refused",
      });
    } catch (err) {
      if (err instanceof HarnessError) {
        caughtError = err;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe("INVALID_STATE");
    expect(caughtError?.message).toContain("admission gate gate-1-witnessed (Witnessed) refused");
    expect(caughtError?.issues).toBeDefined();
    expect(caughtError?.issues?.length).toBe(1);

    const issue = caughtError?.issues?.[0] as Record<string, unknown>;
    expect(issue?.gate_id).toBe("gate-1-witnessed");
    expect(issue?.gate_number).toBe(1);
    expect(issue?.name).toBe("Witnessed");
    expect(typeof issue?.repair_argv).toBe("string");

    // Verify event sequence is unchanged on refusal
    const runAfter = loadRun(run, false);
    expect(runAfter.events.length).toBe(eventCountBefore);

    const candidateAfter = (
      runAfter.state.candidates as unknown as readonly CandidateRecord[]
    ).find((c) => c.id === "cand-cli-refused");
    expect(candidateAfter?.status).toBe("opened");
  });
});
