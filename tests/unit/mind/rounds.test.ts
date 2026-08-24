import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  mindRoundCloseCommand,
  mindRoundOpenCommand,
} from "../../../olt/scripts/src/cli/commands/mind-round.ts";
import type { JsonObject, JsonValue } from "../../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  carryForwardFindingsAndRequirements,
  formatMindRoundCloseBrief,
  formatMindRoundOpenBrief,
  getAllRounds,
  getOpenRoundForObjective,
  isRoundResult,
  reconcileRoundState,
  resolveCapsulePath,
  validateCandidateAdmitted,
  validateObjectiveStatement,
  validatePriorRoundCompleted,
  validateRoundBudget,
  validateRoundCloseArmingRail,
} from "../../../olt/scripts/src/mind/rounds.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

interface MindFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindCapsule(
  label: string,
  overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
    readonly candidates?: readonly Record<string, unknown>[];
    readonly halted?: boolean;
    readonly haltReason?: string;
    readonly registerAgent?: boolean;
    readonly agentRole?: "mind" | "orchestrator" | "coordinator" | "implementer" | "validator";
    readonly agentId?: string;
  } = {},
): MindFixture {
  const repo = scratchRoot(import.meta.path, label);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test mind"\n  goals:\n    - id: "G1"\n      statement: "Stability"\n  non_goals:\n    - "None"\n  repo_roots:\n    - "src/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${label}`, charterBytes, "file", true);

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
          goals: ["G1"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
        ...(overrides.halted
          ? { halted: true, halt_reason: overrides.haltReason ?? "test halt" }
          : {}),
      };

      working.budget = {
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21_600_000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 3,
        base_interval_ms: 900_000,
        max_interval_ms: 14_400_000,
        max_pause_interval_ms: 1_800_000,
        pulse_deadline_ms: 1_200_000,
        max_open_proposals: 5,
        quiet_hours: null,
        day_key: "2026-08-21",
        pulses_today: 0,
        wall_clock_ms_today: 0,
        // Bridge budget overrides object into JsonObject
        ...(overrides.budget as unknown as JsonObject),
      };

      const candList = overrides.candidates
        ? [...overrides.candidates]
        : [
            {
              id: "cand-1",
              kind: "defect",
              statement: "fix parser race condition",
              charter_goal_ids: ["G1"],
              write_scope: ["src/parser.ts"],
              status: "admitted",
              witness_command_id: "cmd-1",
            },
          ];
      // Bridge candidates list into JsonValue
      working.candidates = candList as unknown as JsonValue;

      working.pulse = {
        counter: 1,
        open: null,
        last: null,
      };

      working.rounds = [];
      working.objectives = [];
    },
  );

  const shouldRegister = overrides.registerAgent ?? true;
  if (shouldRegister) {
    const role = overrides.agentRole ?? "orchestrator";
    const agent = overrides.agentId ?? "orch-1";
    agentRegisterCommand({
      run,
      agent,
      role,
      host: "test-host",
    });
  }

  return { repo, run, charterPath, charterSha };
}

function setupPriorRoundCapsule(
  repoRoot: string,
  runId: string,
  overrides: {
    readonly tasks?: Record<string, unknown>;
    readonly branches?: Record<string, unknown>;
    readonly requirements?: readonly Record<string, unknown>[];
    readonly pulseOpen?: Record<string, unknown> | null;
  } = {},
): string {
  const promptBytes = Buffer.from("Round execution prompt");
  const capsulePath = initRun(repoRoot, runId, promptBytes, "file", true);

  transact(
    capsulePath,
    "init",
    "plan-initialized",
    { prompt: "Round execution prompt" },
    (working) => {
      const defaultTasks: Record<string, unknown> = {
        "task-1": {
          id: "task-1",
          status: "completed",
          write_scope: ["src/parser.ts"],
          findings: [
            {
              id: "find-1",
              status: "unresolved",
              severity: "critical",
              observation: "type error in parser",
            },
            {
              id: "find-2",
              status: "resolved",
              severity: "low",
              observation: "minor comment typo",
            },
          ],
        },
      };
      // Bridge tasks object into JsonValue
      working.tasks = (overrides.tasks ?? defaultTasks) as unknown as JsonValue;

      const defaultReqs: Record<string, unknown>[] = [
        {
          id: "req-1",
          statement: "parser must handle null input",
          status: "unsatisfied",
        },
        {
          id: "req-2",
          statement: "parser must return AST",
          status: "satisfied",
        },
      ];
      // Bridge requirements into JsonValue
      working.requirements = (overrides.requirements ?? defaultReqs) as unknown as JsonValue;

      if (overrides.branches) {
        // Bridge branches into JsonValue
        working.branches = overrides.branches as unknown as JsonValue;
      }

      if (overrides.pulseOpen) {
        // Bridge pulse object into JsonObject
        working.pulse = {
          counter: 1,
          open: overrides.pulseOpen as unknown as JsonObject,
          last: null,
        };
      }
    },
  );

  return capsulePath;
}

describe("mind/rounds - round state helpers and chainer integration", () => {
  test("carryForwardFindingsAndRequirements carries forward unsatisfied requirements and unresolved findings", () => {
    const fixture = setupMindCapsule("chainer-test");
    const sourcePath = setupPriorRoundCapsule(fixture.repo, "round-r1");
    const targetPath = join(fixture.repo, ".olt", "capsules", "round-r2");
    mkdirSync(targetPath, { recursive: true });

    const manifest = carryForwardFindingsAndRequirements({
      sourceRunId: "round-r1",
      targetRunId: "round-r2",
      sourceCapsulePath: sourcePath,
      targetCapsulePath: targetPath,
      roundNumber: 2,
    });

    expect(manifest.schema).toBe("orchestrator.chain_manifest");
    expect(manifest.version).toBe(1);
    expect(manifest.sourceRunId).toBe("round-r1");
    expect(manifest.targetRunId).toBe("round-r2");
    expect(manifest.roundNumber).toBe(2);
    expect(manifest.carryoverRequirements).toEqual(["req-1"]);
    expect(manifest.unresolvedFindingIds).toEqual(["find-1"]);

    const writtenManifestPath = join(targetPath, "chain_manifest.json");
    expect(existsSync(writtenManifestPath)).toBeTrue();
    const written = JSON.parse(readFileSync(writtenManifestPath, "utf-8")) as typeof manifest;
    expect(written.unresolvedFindingIds).toEqual(["find-1"]);
    expect(written.carryoverRequirements).toEqual(["req-1"]);
  });

  test("carryForwardFindingsAndRequirements throws on non-existent source capsule", () => {
    const fixture = setupMindCapsule("chainer-nonexistent");
    const targetPath = join(fixture.repo, ".olt", "capsules", "round-r2");

    expect(() =>
      carryForwardFindingsAndRequirements({
        sourceRunId: "nonexistent",
        targetRunId: "round-r2",
        sourceCapsulePath: join(fixture.repo, ".olt", "capsules", "nonexistent"),
        targetCapsulePath: targetPath,
        roundNumber: 2,
      }),
    ).toThrow(HarnessError);
  });

  test("validateCandidateAdmitted permits admitted candidates and rejects others", () => {
    const state: Record<string, unknown> = {
      candidates: [
        { id: "cand-admitted", status: "admitted", statement: "fix defect" },
        { id: "cand-opened", status: "opened", statement: "open defect" },
        { id: "cand-declined", status: "declined", statement: "declined defect" },
      ],
    };

    const admitted = validateCandidateAdmitted(state, "cand-admitted");
    expect(admitted.id).toBe("cand-admitted");

    expect(() => validateCandidateAdmitted(state, "cand-opened")).toThrow(
      /is not admitted \(status: opened\)/,
    );
    expect(() => validateCandidateAdmitted(state, "cand-declined")).toThrow(
      /is not admitted \(status: declined\)/,
    );
    expect(() => validateCandidateAdmitted(state, "cand-unknown")).toThrow(
      /unknown candidate 'cand-unknown'/,
    );
  });

  test("validateObjectiveStatement detects statement drift between candidate and objective", () => {
    const candidate = {
      id: "cand-1",
      kind: "defect" as const,
      statement: "fix parser race condition",
      write_scope: ["src/parser.ts"],
      status: "admitted",
    };

    expect(() => validateObjectiveStatement(candidate, "fix parser race condition")).not.toThrow();

    expect(() => validateObjectiveStatement(candidate, "add new feature to parser")).toThrow(
      /objective statement drifted from candidate 'cand-1' statement/,
    );

    expect(() =>
      validateObjectiveStatement(
        candidate,
        "fix parser race condition",
        "different prior statement",
      ),
    ).toThrow(/objective statement drifted from prior round statement/);
  });

  test("validateRoundBudget enforces max_rounds_per_objective limit", () => {
    const state: Record<string, unknown> = {
      budget: {
        max_rounds_per_objective: 3,
      },
    };

    expect(() => validateRoundBudget(state, 1, "obj-1")).not.toThrow();
    expect(() => validateRoundBudget(state, 2, "obj-1")).not.toThrow();
    expect(() => validateRoundBudget(state, 3, "obj-1")).not.toThrow();

    expect(() => validateRoundBudget(state, 4, "obj-1")).toThrow(
      /round budget spent for objective 'obj-1' \(4 > max 3 rounds\)/,
    );
  });

  test("validatePriorRoundCompleted detects live leases and unclosed branches", () => {
    const fixture = setupMindCapsule("prior-round-validation");

    // Case 1: Live task lease
    const liveLeasePath = setupPriorRoundCapsule(fixture.repo, "round-live-lease", {
      tasks: {
        "task-1": {
          id: "task-1",
          status: "leased",
          lease: {
            agent: "worker-1",
            expires_at: new Date(Date.now() + 600_000).toISOString(),
          },
        },
      },
    });
    expect(() => validatePriorRoundCompleted(liveLeasePath, "round-live-lease")).toThrow(
      /has a live lease on task 'task-1'/,
    );

    // Case 2: Unclosed branch
    const unclosedBranchPath = setupPriorRoundCapsule(fixture.repo, "round-open-branch", {
      branches: {
        "branch-1": {
          id: "branch-1",
          status: "open",
        },
      },
    });
    expect(() => validatePriorRoundCompleted(unclosedBranchPath, "round-open-branch")).toThrow(
      /has an unclosed branch attempt 'branch-1'/,
    );

    // Case 3: Completed prior round without active leases
    const cleanPath = setupPriorRoundCapsule(fixture.repo, "round-clean", {
      tasks: {
        "task-1": { id: "task-1", status: "completed" },
      },
    });
    expect(() => validatePriorRoundCompleted(cleanPath, "round-clean")).not.toThrow();
  });

  test("validateRoundCloseArmingRail enforces successor or terminal-reason at tier 1", () => {
    expect(() =>
      validateRoundCloseArmingRail({
        result: "converged",
        successor: undefined,
        terminalReason: undefined,
      }),
    ).toThrow(/a round may not close without either an armed successor/);

    expect(() =>
      validateRoundCloseArmingRail({
        result: "converged",
        successor: "round-2",
      }),
    ).not.toThrow();

    expect(() =>
      validateRoundCloseArmingRail({
        result: "converged",
        terminalReason: "all criteria satisfied",
      }),
    ).not.toThrow();
  });

  test("isRoundResult validates result values", () => {
    expect(isRoundResult("converged")).toBeTrue();
    expect(isRoundResult("exhausted")).toBeTrue();
    expect(isRoundResult("escalated")).toBeTrue();
    expect(isRoundResult("quiescent")).toBeFalse();
    expect(isRoundResult("failed")).toBeFalse();
    expect(isRoundResult(null)).toBeFalse();
    expect(isRoundResult(123)).toBeFalse();
  });

  test("formatMindRoundOpenBrief and formatMindRoundCloseBrief conform to line limits", () => {
    const openBrief = formatMindRoundOpenBrief({
      runRoot: ".olt/capsules/mind-gen-1",
      actor: "orch-1",
      objective: "obj-1",
      candidate: "cand-1",
      statement: "fix parser race condition",
      round: 1,
      maxRounds: 3,
      chainFrom: null,
      openedAt: "2026-08-21T05:00:00.000Z",
    });
    expect(openBrief).toContain("Mind Round Opened: `obj-1` (Round 1)");
    expect(openBrief).toContain("Candidate");
    expect(openBrief.split("\n").length).toBeLessThanOrEqual(30);

    const closeBrief = formatMindRoundCloseBrief({
      runRoot: ".olt/capsules/mind-gen-1",
      actor: "orch-1",
      objective: "obj-1",
      round: 1,
      result: "converged",
      successor: null,
      terminalReason: "all criteria satisfied",
      closedAt: "2026-08-21T05:20:00.000Z",
    });
    expect(closeBrief).toContain("Mind Round Closed: `obj-1` (Round 1)");
    expect(closeBrief).toContain("**Result**: `converged`");
    expect(closeBrief.split("\n").length).toBeLessThanOrEqual(30);
  });
});

describe("mind:round-open and mind:round-close CLI commands", () => {
  test("mindRoundOpenCommand opens an initial round and updates capsule state", () => {
    const fixture = setupMindCapsule("open-round-happy");

    const result = mindRoundOpenCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-parser-race",
      candidate: "cand-1",
    });

    expect(result.objective_id).toBe("obj-parser-race");
    expect(result.candidate_id).toBe("cand-1");
    expect(result.round).toBe(1);
    expect(result.actor).toBe("orch-1");
    expect(result.chain_from).toBeNull();
    expect(result.markdown).toContain("Mind Round Opened: `obj-parser-race` (Round 1)");

    const loaded = loadRun(fixture.run, false);
    const rounds = getAllRounds(loaded.state);
    expect(rounds.length).toBe(1);
    expect(rounds[0]!.round_id).toBe("round-obj-parser-race-r1");
    expect(rounds[0]!.status).toBe("opened");
    expect(rounds[0]!.round).toBe(1);

    const openRound = getOpenRoundForObjective(loaded.state, "obj-parser-race");
    expect(openRound).toBeDefined();
    expect(openRound!.round).toBe(1);
  });

  test("mindRoundOpenCommand refuses when candidate is not admitted", () => {
    const fixture = setupMindCapsule("open-unadmitted-cand", {
      candidates: [
        {
          id: "cand-pending",
          kind: "defect",
          statement: "unadmitted defect",
          status: "opened",
        },
      ],
    });

    expect(() =>
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-unadmitted",
        candidate: "cand-pending",
      }),
    ).toThrow(/candidate 'cand-pending' is not admitted/);
  });

  test("mindRoundOpenCommand refuses when objective statement drifts from admitted candidate", () => {
    const fixture = setupMindCapsule("open-statement-drift");

    expect(() =>
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-parser-race",
        candidate: "cand-1",
        statement: "drifted statement that does not match cand-1",
      }),
    ).toThrow(/objective statement drifted from candidate 'cand-1' statement/);
  });

  test("mindRoundOpenCommand refuses when prior round has a live lease", () => {
    const fixture = setupMindCapsule("open-prior-live-lease");
    const priorPath = setupPriorRoundCapsule(fixture.repo, "round-prior-leased", {
      tasks: {
        "task-1": {
          id: "task-1",
          status: "leased",
          lease: {
            agent: "worker-1",
            expires_at: new Date(Date.now() + 600_000).toISOString(),
          },
        },
      },
    });

    expect(() =>
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-parser-race",
        candidate: "cand-1",
        "chain-from": priorPath,
      }),
    ).toThrow(/has a live lease on task 'task-1'/);
  });

  test("mindRoundOpenCommand refuses when round budget is spent", () => {
    const fixture = setupMindCapsule("open-budget-spent", {
      budget: {
        max_rounds_per_objective: 2,
      },
    });

    // Round 1
    mindRoundOpenCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-budget",
      candidate: "cand-1",
      round: "1",
    });
    mindRoundCloseCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-budget",
      round: "1",
      result: "exhausted",
      successor: "round-obj-budget-r2",
    });

    // Round 2
    mindRoundOpenCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-budget",
      candidate: "cand-1",
      round: "2",
    });
    mindRoundCloseCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-budget",
      round: "2",
      result: "exhausted",
      successor: "round-obj-budget-r3",
    });

    // Round 3 exceeds max_rounds_per_objective = 2
    expect(() =>
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-budget",
        candidate: "cand-1",
        round: "3",
      }),
    ).toThrow(/round budget spent for objective 'obj-budget' \(3 > max 2 rounds\)/);
  });

  test("mindRoundOpenCommand refuses double-open on the same objective", () => {
    const fixture = setupMindCapsule("double-open-refusal");

    mindRoundOpenCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-double",
      candidate: "cand-1",
    });

    expect(() =>
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-double",
        candidate: "cand-1",
      }),
    ).toThrow(
      /round 1 is already open for objective 'obj-double'; close it first with mind:round-close/,
    );
  });

  test("mindRoundOpenCommand and mindRoundCloseCommand enforce role contract grants", () => {
    const fixture = setupMindCapsule("role-contract-enforcement", {
      registerAgent: false,
    });

    // 1. Unregistered agent
    expect(() =>
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "unregistered",
        objective: "obj-1",
        candidate: "cand-1",
      }),
    ).toThrow(/agent unregistered holds no grant/);

    // 2. Register agent as implementer (prohibited from mind round operations)
    agentRegisterCommand({
      run: fixture.run,
      agent: "impl-1",
      role: "implementer",
      host: "test-host",
    });

    expect(() =>
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "impl-1",
        objective: "obj-1",
        candidate: "cand-1",
      }),
    ).toThrow(/agent impl-1 holds role 'implementer'; role 'orchestrator' or 'mind' is required/);
  });

  test("mindRoundCloseCommand closes round and enforces tier 1 arming rail", () => {
    const fixture = setupMindCapsule("close-round-arming-rail");

    mindRoundOpenCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-close-test",
      candidate: "cand-1",
    });

    // Refusal: no successor and no terminal reason
    expect(() =>
      mindRoundCloseCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-close-test",
        round: "1",
        result: "converged",
      }),
    ).toThrow(/a round may not close without either an armed successor/);

    // Refusal: invalid result
    expect(() =>
      mindRoundCloseCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-close-test",
        round: "1",
        result: "invalid-result",
        "terminal-reason": "some reason",
      }),
    ).toThrow(/invalid round result 'invalid-result'/);

    // Success: valid close with terminal reason
    const closeRes = mindRoundCloseCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-close-test",
      round: "1",
      result: "converged",
      "terminal-reason": "all defect falsifiers green",
    });

    expect(closeRes.objective_id).toBe("obj-close-test");
    expect(closeRes.round).toBe(1);
    expect(closeRes.result).toBe("converged");
    expect(closeRes.terminal_reason).toBe("all defect falsifiers green");
    expect(closeRes.markdown).toContain("Mind Round Closed: `obj-close-test` (Round 1)");

    const loaded = loadRun(fixture.run, false);
    const round = getAllRounds(loaded.state)[0]!;
    expect(round.status).toBe("closed");
    expect(round.result).toBe("converged");
    expect(round.terminal_reason).toBe("all defect falsifiers green");
  });

  test("multi-round chaining end-to-end with reconcileRoundState", () => {
    const fixture = setupMindCapsule("multiround-reconcile");
    const r1CapsulePath = setupPriorRoundCapsule(fixture.repo, "round-obj-test-r1");

    // Round 1
    mindRoundOpenCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-multi",
      candidate: "cand-1",
      round: "1",
    });

    mindRoundCloseCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-multi",
      round: "1",
      result: "exhausted",
      successor: "round-obj-test-r2",
    });

    // Round 2 chained from Round 1
    mindRoundOpenCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-multi",
      candidate: "cand-1",
      round: "2",
      "chain-from": r1CapsulePath,
    });

    mindRoundCloseCommand({
      run: fixture.run,
      actor: "orch-1",
      objective: "obj-multi",
      round: "2",
      result: "converged",
      "terminal-reason": "resolved in round 2",
    });

    const loaded = loadRun(fixture.run, false);
    const reconciled = reconcileRoundState(loaded.state, "obj-multi");

    expect(reconciled.totalRoundsCount).toBe(2);
    expect(reconciled.activeRounds.length).toBe(0);
    expect(reconciled.objectives.length).toBe(1);

    const obj = reconciled.objectives[0]!;
    expect(obj.id).toBe("obj-multi");
    expect(obj.candidate_id).toBe("cand-1");
    expect(obj.statement).toBe("fix parser race condition");
    expect(obj.current_round).toBe(2);
    expect(obj.status).toBe("converged");
    expect(obj.rounds.length).toBe(2);
    expect(obj.rounds[0]!.result).toBe("exhausted");
    expect(obj.rounds[1]!.result).toBe("converged");
  });

  test("resolveCapsulePath handles directory, baseRunRoot relative search, and direct path", () => {
    const fixture = setupMindCapsule("resolve-capsule-test");
    const resolvedDirect = resolveCapsulePath(fixture.run);
    expect(resolvedDirect).toBe(fixture.run);

    const resolvedWithBase = resolveCapsulePath("non-existent-round-123", fixture.run);
    expect(resolvedWithBase).toContain("non-existent-round-123");
  });

  test("mindRoundCloseCommand rejects invalid result or missing round", () => {
    const fixture = setupMindCapsule("close-errors");

    // Invalid round result
    expect(() =>
      mindRoundCloseCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-1",
        round: "1",
        result: "not-a-valid-result" as unknown as "converged",
      }),
    ).toThrow(HarnessError);

    // Non-existent round
    expect(() =>
      mindRoundCloseCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-non-existent",
        round: "99",
        result: "converged",
        "terminal-reason": "done",
      }),
    ).toThrow(HarnessError);
  });
});
