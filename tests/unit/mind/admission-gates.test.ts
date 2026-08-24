import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  formatMindAdmitBrief,
  mindAdmitCommand,
} from "../../../olt/scripts/src/cli/commands/mind-admit.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  evaluateAdmissionGates,
  evaluateGate1Witnessed,
  evaluateGate2InCharter,
  evaluateGate3Falsifiable,
  evaluateGate4Scoped,
  evaluateGate5Affordable,
  evaluateGate6NotADuplicate,
  type CandidateRecord,
} from "../../../olt/scripts/src/mind/gates.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

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

interface MindTestContext {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
}

function setupMindTest(
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
  const repo = mkdtempSync(join(tmpdir(), `mind-admission-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    options.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test application for admission gates"\n  goals:\n    - id: "G1"\n      statement: "Ensure stability"\n    - id: "G2"\n      statement: "Comprehensive verification"\n  non_goals:\n    - "Out of scope"\n    - "UI redesign"\n  repo_roots:\n    - "src/"\n    - "olt/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-admission-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "olt/agents/mind.yaml",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1", "G2"],
          non_goals: ["Out of scope", "UI redesign"],
          repo_roots: ["src/", "olt/"],
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
        working.candidates = [...options.candidates];
      }

      if (options.tasks) {
        working.tasks = { ...options.tasks };
      }

      if (options.agents) {
        working.agents = [...options.agents];
      }

      if (options.commands) {
        working.commands = { ...options.commands };
      }
    },
  );

  return { repo, run, charterPath };
}

function writeCommandRecordToCapsule(
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

describe("Mind Admission Gates (W3.3 / PLAN.md §7.3)", () => {
  test("Gate 1 (Witnessed): Refuses candidate with missing witness", () => {
    const { repo, run } = setupMindTest("gate1-missing");
    const candidate: CandidateRecord = {
      id: "cand-1",
      kind: "defect",
      statement: "syntax error in parser",
      charter_goal_ids: ["G1"],
      write_scope: ["src/parser.ts"],
      status: "opened",
    };

    const verdict = evaluateGate1Witnessed(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.gateNumber).toBe(1);
    expect(verdict.reason).toContain("no witness command record");
    expect(verdict.repairArgv).toContain("--witness");
  });

  test("Gate 1 (Witnessed): Refuses candidate citing non-existent command record", () => {
    const { repo, run } = setupMindTest("gate1-nonexistent");
    const candidate: CandidateRecord = {
      id: "cand-1",
      kind: "defect",
      statement: "syntax error in parser",
      witness_command_id: "C-nonexistent-999",
      charter_goal_ids: ["G1"],
      write_scope: ["src/parser.ts"],
      status: "opened",
    };

    const verdict = evaluateGate1Witnessed(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.reason).toContain("not found");
    expect(verdict.repairArgv).toContain("run:exec");
  });

  test("Gate 1 (Witnessed): Refuses candidate citing command record with exit code 0", () => {
    const { repo, run } = setupMindTest("gate1-exit0");
    const cmdId = "C-witness-clean";
    writeCommandRecordToCapsule(run, cmdId, {
      exit_code: 0,
      stdout: "all 12 tests passed",
      status: "succeeded",
    });

    const candidate: CandidateRecord = {
      id: "cand-1",
      kind: "defect",
      statement: "typecheck failure",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      write_scope: ["src/parser.ts"],
      status: "opened",
    };

    const verdict = evaluateGate1Witnessed(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.reason).toContain("recorded exit was 0");
    expect(verdict.repairArgv).toContain("run:exec");
  });

  test("Gate 1 (Witnessed): Refuses candidate whose witness output does not contain defect", () => {
    const { repo, run } = setupMindTest("gate1-output-mismatch");
    const cmdId = "C-witness-unrelated";
    writeCommandRecordToCapsule(run, cmdId, {
      exit_code: 1,
      stderr: "unrelated error in database connection",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-1",
      kind: "defect",
      statement: "memory leak in rendering loop",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      write_scope: ["src/render.ts"],
      status: "opened",
    };

    const verdict = evaluateGate1Witnessed(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-1-witnessed");
    expect(verdict.reason).toContain("output does not contain the cited defect");
  });

  test("Gate 1 (Witnessed): Passes defect candidate with non-zero exit and matching output", () => {
    const { repo, run } = setupMindTest("gate1-pass");
    const cmdId = "C-witness-real-defect";
    writeCommandRecordToCapsule(run, cmdId, {
      exit_code: 1,
      stderr: "TypeScript error TS2345: Argument of type in parser.ts",
      status: "failed",
    });

    const candidate: CandidateRecord = {
      id: "cand-1",
      kind: "defect",
      statement: "parser.ts type error",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      write_scope: ["src/parser.ts"],
      status: "opened",
    };

    const verdict = evaluateGate1Witnessed(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.gateId).toBe("gate-1-witnessed");
  });

  test("Gate 1 (Witnessed): Refuses proposal without owner decision and passes proposal with owner-decision", () => {
    const { repo, run } = setupMindTest("gate1-proposal");
    const unapproved: CandidateRecord = {
      id: "cand-prop-1",
      kind: "proposal",
      statement: "add automatic backup feature",
      charter_goal_ids: ["G1"],
      write_scope: ["src/backup.ts"],
      status: "opened",
    };

    const verdict1 = evaluateGate1Witnessed(unapproved, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });
    expect(verdict1.passed).toBe(false);
    expect(verdict1.reason).toContain("owner authority decision");

    const approved: CandidateRecord = {
      ...unapproved,
      witness_command_id: "owner-decision",
    };
    const verdict2 = evaluateGate1Witnessed(approved, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });
    expect(verdict2.passed).toBe(true);
  });

  test("Gate 2 (In charter): Refuses candidate with no charter goals or non-existent goal", () => {
    const { repo, run } = setupMindTest("gate2-goals");
    const candidateNoGoals: CandidateRecord = {
      id: "cand-2",
      kind: "defect",
      statement: "some fix",
      charter_goal_ids: [],
      write_scope: ["src/index.ts"],
      status: "opened",
    };

    const verdictNoGoals = evaluateGate2InCharter(candidateNoGoals, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
    });
    expect(verdictNoGoals.passed).toBe(false);
    expect(verdictNoGoals.gateId).toBe("gate-2-in-charter");
    expect(verdictNoGoals.gateNumber).toBe(2);
    expect(verdictNoGoals.reason).toContain("cites no charter goals");

    const candidateBadGoal: CandidateRecord = {
      id: "cand-2",
      kind: "defect",
      statement: "some fix",
      charter_goal_ids: ["G99"],
      write_scope: ["src/index.ts"],
      status: "opened",
    };

    const verdictBadGoal = evaluateGate2InCharter(candidateBadGoal, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
    });
    expect(verdictBadGoal.passed).toBe(false);
    expect(verdictBadGoal.reason).toContain("charter goal 'G99' does not exist");
  });

  test("Gate 2 (In charter): Refuses candidate matching charter non-goals", () => {
    const { repo, run } = setupMindTest("gate2-nongoal");
    const candidate: CandidateRecord = {
      id: "cand-2",
      kind: "defect",
      statement: "Perform UI redesign of dashboard",
      charter_goal_ids: ["G1"],
      write_scope: ["src/ui/dashboard.tsx"],
      status: "opened",
    };

    const verdict = evaluateGate2InCharter(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      charterGoals: new Set(["G1", "G2"]),
      charterNonGoals: ["UI redesign", "Out of scope"],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-2-in-charter");
    expect(verdict.reason).toContain("matches charter non-goal 'UI redesign'");
  });

  test("Gate 3 (Falsifiable): Spawns live execution and fails when falsifier exits 0", () => {
    const { repo, run } = setupMindTest("gate3-exit0");
    const candidate: CandidateRecord = {
      id: "cand-3",
      kind: "defect",
      statement: "falsifier passes unexpectedly",
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(0)"],
      write_scope: ["src/index.ts"],
      status: "opened",
    };

    const verdict = evaluateGate3Falsifiable(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-3-falsifiable");
    expect(verdict.gateNumber).toBe(3);
    expect(verdict.reason).toContain("exited with 0; a falsifier must fail");
    expect(verdict.metadata?.exitCode).toBe(0);
  });

  test("Gate 3 (Falsifiable): Spawns live execution and passes when falsifier exits non-zero", () => {
    const { repo, run } = setupMindTest("gate3-exit1");
    const candidate: CandidateRecord = {
      id: "cand-3",
      kind: "defect",
      statement: "falsifier fails as expected",
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/index.ts"],
      status: "opened",
    };

    const verdict = evaluateGate3Falsifiable(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.gateId).toBe("gate-3-falsifiable");
    expect(verdict.metadata?.exitCode).toBe(1);
  });

  test("Gate 4 (Scoped): Refuses scope outside repo_roots or empty scope", () => {
    const { repo, run } = setupMindTest("gate4-roots");
    const emptyScopeCandidate: CandidateRecord = {
      id: "cand-4",
      kind: "defect",
      statement: "empty scope",
      charter_goal_ids: ["G1"],
      write_scope: [],
      status: "opened",
    };
    const vEmpty = evaluateGate4Scoped(emptyScopeCandidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      repoRoots: ["src/"],
    });
    expect(vEmpty.passed).toBe(false);
    expect(vEmpty.gateId).toBe("gate-4-scoped");
    expect(vEmpty.reason).toContain("write scope is empty");

    const outsideScopeCandidate: CandidateRecord = {
      id: "cand-4",
      kind: "defect",
      statement: "outside scope",
      charter_goal_ids: ["G1"],
      write_scope: ["docs/planning/mind/PLAN.md"],
      status: "opened",
    };
    const vOutside = evaluateGate4Scoped(outsideScopeCandidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
      repoRoots: ["src/"],
    });
    expect(vOutside.passed).toBe(false);
    expect(vOutside.reason).toContain("is outside charter repo_roots");
  });

  test("Gate 4 (Scoped): Refuses scope conflicting with live task lease", () => {
    const { repo, run } = setupMindTest("gate4-lease-conflict");
    const candidate: CandidateRecord = {
      id: "cand-4",
      kind: "defect",
      statement: "fix parser",
      charter_goal_ids: ["G1"],
      write_scope: ["src/parser.ts"],
      status: "opened",
    };

    const verdict = evaluateGate4Scoped(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        tasks: {
          "task-live-1": {
            id: "task-live-1",
            status: "leased",
            lease: {
              write_scope: ["src/parser.ts"],
              expires_at: new Date(Date.now() + 600000).toISOString(),
            },
          },
        },
      },
      repoRoots: ["src/"],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-4-scoped");
    expect(verdict.reason).toContain("write scope conflicts with live task lease 'task-live-1'");
  });

  test("Gate 5 (Affordable): Refuses when daily pulses or wall-clock budget is exhausted", () => {
    const { repo, run } = setupMindTest("gate5-budget");
    const candidate: CandidateRecord = {
      id: "cand-5",
      kind: "defect",
      statement: "affordable defect",
      charter_goal_ids: ["G1"],
      write_scope: ["src/index.ts"],
      status: "opened",
    };

    const vPulseExhausted = evaluateGate5Affordable(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        budget: {
          pulses_per_day: 96,
          pulses_today: 96,
          wall_clock_ms_per_day: 21600000,
          wall_clock_ms_today: 1000,
        },
      },
    });
    expect(vPulseExhausted.passed).toBe(false);
    expect(vPulseExhausted.gateId).toBe("gate-5-affordable");
    expect(vPulseExhausted.gateNumber).toBe(5);
    expect(vPulseExhausted.reason).toContain("daily pulse budget exhausted");

    const vWallClockExhausted = evaluateGate5Affordable(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        budget: {
          pulses_per_day: 96,
          pulses_today: 10,
          wall_clock_ms_per_day: 21600000,
          wall_clock_ms_today: 22000000,
        },
      },
    });
    expect(vWallClockExhausted.passed).toBe(false);
    expect(vWallClockExhausted.reason).toContain("daily wall-clock budget exhausted");
  });

  test("Gate 6 (Not a duplicate): Permanently declined candidate is remembered and rejected", () => {
    const { repo, run } = setupMindTest("gate6-declined");
    const candidate: CandidateRecord = {
      id: "cand-6-new",
      kind: "defect",
      statement: "Refactor parser token stream",
      witness_command_id: "C-witness-old",
      charter_goal_ids: ["G1"],
      write_scope: ["src/parser/tokens.ts"],
      status: "opened",
    };

    const verdict = evaluateGate6NotADuplicate(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {
        candidates: [
          {
            id: "cand-declined-yesterday",
            kind: "defect",
            statement: "Refactor parser token stream",
            witness_command_id: "C-witness-old",
            charter_goal_ids: ["G1"],
            write_scope: ["src/parser/tokens.ts"],
            status: "declined",
            decline_reason: "out of scope busywork refactor",
            decided_at: "2026-08-20T10:00:00.000Z",
          },
        ],
      },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.gateId).toBe("gate-6-not-a-duplicate");
    expect(verdict.gateNumber).toBe(6);
    expect(verdict.reason).toContain(
      "duplicate of permanently declined candidate 'cand-declined-yesterday'",
    );
    expect(verdict.reason).toContain("out of scope busywork refactor");
  });

  test("Admission evaluation stops at first failure", () => {
    const { repo, run } = setupMindTest("eval-stop-at-first");
    const candidate: CandidateRecord = {
      id: "cand-multi-fail",
      kind: "defect",
      statement: "missing witness and bad goal",
      charter_goal_ids: ["G99"],
      falsifier_argv: ["bun", "-e", "process.exit(0)"],
      write_scope: [],
      status: "opened",
    };

    const result = evaluateAdmissionGates(candidate, {
      runRoot: run,
      repoRoot: repo,
      actor: "mind-1",
      state: {},
    });

    expect(result.admitted).toBe(false);
    expect(result.failingGate?.gateId).toBe("gate-1-witnessed");
    expect(result.verdicts.length).toBe(1);
  });

  test("CLI mindAdmitCommand: End-to-end admission of valid candidate", () => {
    const cmdId = "C-witness-valid-e2e";
    const candidate: CandidateRecord = {
      id: "cand-valid-e2e",
      kind: "defect",
      statement: "typecheck error in gates.ts",
      witness_command_id: cmdId,
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "-e", "process.exit(1)"],
      write_scope: ["src/gates.ts"],
      status: "opened",
    };

    const { run } = setupMindTest("cli-admit-success", {
      candidates: [candidate],
    });

    writeCommandRecordToCapsule(run, cmdId, {
      exit_code: 1,
      stderr: "typecheck error TS123 in gates.ts",
      status: "failed",
    });

    // Register mind agent
    agentRegisterCommand({
      run,
      agent: "mind-1",
      role: "mind",
      host: "antigravity",
    });

    const result = mindAdmitCommand({
      run,
      actor: "mind-1",
      candidate: "cand-valid-e2e",
    });

    expect(result.candidate_id).toBe("cand-valid-e2e");
    expect(result.actor).toBe("mind-1");
    expect(result.falsifier_exit_observed).toBe(1);
    expect(Array.isArray(result.verdicts)).toBe(true);
    expect((result.verdicts as readonly unknown[]).length).toBe(6);

    const loaded = loadRun(run, false);
    const candidateAfter = (loaded.state.candidates as readonly CandidateRecord[]).find(
      (c) => c.id === "cand-valid-e2e",
    );
    expect(candidateAfter?.status).toBe("admitted");
    expect(candidateAfter?.falsifier_exit).toBe(1);
  });

  test("CLI mindAdmitCommand: Refuses when agent holds no grant or wrong role", () => {
    const { run } = setupMindTest("cli-admit-role");
    expect(() => {
      mindAdmitCommand({
        run,
        actor: "unregistered-agent",
        candidate: "cand-1",
      });
    }).toThrow(HarnessError);
  });

  test("CLI mindAdmitCommand: Refuses when pulse is not open", () => {
    const candidate: CandidateRecord = {
      id: "cand-no-pulse",
      kind: "defect",
      statement: "some defect",
      charter_goal_ids: ["G1"],
      write_scope: ["src/index.ts"],
      status: "opened",
    };
    const { run } = setupMindTest("cli-no-pulse", {
      pulseOpen: false,
      candidates: [candidate],
    });

    agentRegisterCommand({
      run,
      agent: "mind-1",
      role: "mind",
      host: "antigravity",
    });

    expect(() => {
      mindAdmitCommand({
        run,
        actor: "mind-1",
        candidate: "cand-no-pulse",
      });
    }).toThrow("no active pulse is open");
  });

  test("formatMindAdmitBrief: Renders clean markdown summary within line limits", () => {
    const brief = formatMindAdmitBrief({
      candidateId: "cand-100",
      runRoot: ".olt/capsules/mind-gen-1",
      actor: "mind-1",
      statement: "Syntax error in parser",
      admittedAt: "2026-08-21T12:00:00.000Z",
      falsifierExitObserved: 1,
      verdicts: [
        { gateId: "gate-1-witnessed", gateNumber: 1, name: "Witnessed", passed: true },
        { gateId: "gate-2-in-charter", gateNumber: 2, name: "In charter", passed: true },
        { gateId: "gate-3-falsifiable", gateNumber: 3, name: "Falsifiable", passed: true },
        { gateId: "gate-4-scoped", gateNumber: 4, name: "Scoped", passed: true },
        { gateId: "gate-5-affordable", gateNumber: 5, name: "Affordable", passed: true },
        { gateId: "gate-6-not-a-duplicate", gateNumber: 6, name: "Not a duplicate", passed: true },
      ],
    });

    expect(brief).toContain("Candidate Admitted: `cand-100`");
    expect(brief).toContain("Gate 1 (Witnessed): PASSED");
    expect(brief).toContain("Gate 6 (Not a duplicate): PASSED");
  });
});
