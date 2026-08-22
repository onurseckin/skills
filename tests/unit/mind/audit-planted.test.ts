import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/agent-ops.ts";
import {
  mindAuditReportCommand,
  mindAuditStartCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-audit.ts";
import { mindPulseCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-pulse.ts";
import { mindPulseOpenCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-pulse-open.ts";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type {
  HarnessEvent,
  RunState,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import type {
  JsonObject,
  JsonValue,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  assertAuditAllowsPulseOpen,
  checkAdmittedCandidateGoals,
  checkAdmittedCandidateWitnesses,
  checkAuditBlocksPulse,
  checkCharterDigestIntegrity,
  checkPulseGaps,
  checkScopeViolations,
  checkValueConsistency,
} from "../../../orchestrating-long-tasks/scripts/src/mind/audit.ts";
import { calculatePulseValue } from "../../../orchestrating-long-tasks/scripts/src/mind/value.ts";
import { verifyDefectWitness } from "../../../orchestrating-long-tasks/scripts/src/mind/witness.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";

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

interface MindFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupPlantedAuditCapsule(
  name: string,
  overrides: {
    readonly charterGoals?: string[];
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
    readonly registerAuditorAgent?: boolean;
    readonly registerMindAgent?: boolean;
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-planted-audit-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "docs", "mind");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const goals = overrides.charterGoals ?? ["G1", "G2"];
  const goalsSection = goals.map((g) => `- ${g}: Goal description`).join("\n");
  const charterContent =
    overrides.charterContent ??
    `# CHARTER\n\n## identity\nApplication under planted ledger audit verification\n\n## goals\n${goalsSection}\n\n## non-goals\n- Modifying production credentials\n\n## repo_roots\n- \`src/\`\n- \`tests/\`\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `planted-run-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "docs/mind/CHARTER.md",
      pinned_sha256: charterSha,
      goals,
      repo_roots: ["src/", "tests/"],
    },
    (draft) => {
      const working = draft as Record<string, unknown>;
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "docs/mind/CHARTER.md",
          pinned_sha256: charterSha,
          goals,
          repo_roots: ["src/", "tests/"],
          evidence_class: "harness_observed",
        },
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
        ...overrides.budget,
      };

      working.candidates = [];
      working.audit = {
        counter: 0,
        open_findings: [],
      };
    },
  );

  if (overrides.registerMindAgent !== false) {
    agentRegisterCommand({
      run,
      agent: "mind-1",
      role: "mind",
      host: "antigravity",
    });
  }

  if (overrides.registerAuditorAgent !== false) {
    agentRegisterCommand({
      run,
      agent: "auditor-1",
      role: "mind-auditor",
      host: "antigravity",
    });
  }

  return { repo, run, charterPath, charterSha };
}

function recordMockCommand(
  capsuleRoot: string,
  commandId: string,
  options: {
    readonly exitCode?: number;
    readonly status?: "failed" | "succeeded" | "running" | "timed_out";
    readonly stdout?: string;
    readonly stderr?: string;
    readonly argv?: string[];
  } = {},
): CommandRecord {
  const cmdDir = join(capsuleRoot, "commands", commandId);
  mkdirSync(cmdDir, { recursive: true });

  const record: CommandRecord = {
    id: commandId,
    argv: options.argv ?? ["bun", "test"],
    cwd: capsuleRoot,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    status: options.status ?? (options.exitCode === 0 ? "succeeded" : "failed"),
    exit_code: options.exitCode ?? 1,
    logs: {
      stdout: { path: `commands/${commandId}/stdout.log` },
      stderr: { path: `commands/${commandId}/stderr.log` },
    },
  };

  writeFileSync(join(cmdDir, "record.json"), JSON.stringify(record, null, 2), "utf-8");
  if (options.stdout !== undefined) {
    writeFileSync(join(cmdDir, "stdout.log"), options.stdout, "utf-8");
  }
  if (options.stderr !== undefined) {
    writeFileSync(join(cmdDir, "stderr.log"), options.stderr, "utf-8");
  }

  return record;
}

function generateCleanAnswers(): string[] {
  return [
    "Q1:cmd-101:pass:Every pulse in the window has exactly one open and one close",
    "Q2:cmd-102:pass:All admitted candidate defect witnesses re-verified and valid",
    "Q3:cmd-103:pass:All admitted candidates cite existing charter goals",
    "Q4:cmd-104:pass:Trailing value series is consistent with ledger metrics",
    "Q5:cmd-105:pass:No out-of-band scope modifications detected",
    "Q6:cmd-106:pass:No prohibited never-unattended actions executed",
    "Q7:cmd-107:pass:Declined candidates have valid recorded reasons",
    "Q8:cmd-108:pass:Charter digest matches pinned sha256 with no drift",
  ];
}

describe("PHASE-5 §4.1 & PLAN §13.7 Planted-Ledger Audit Test Suite", () => {
  describe("Planted Defect 1: Pulse Gaps (Open Without Close, Double Opens, Sequence Jumps)", () => {
    test("detects unclosed pulse gap and reports missing close", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-1" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
        // pulse-1 was never closed!
      ];

      const result = checkPulseGaps(events);
      expect(result.ok).toBe(false);
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0]).toContain("pulse pulse-1 was opened but never closed");
    });

    test("detects close event without corresponding open event", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-1" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkPulseGaps(events);
      expect(result.ok).toBe(false);
      expect(result.gaps[0]).toContain("pulse pulse-1 has 1 close event(s) but no open event");
    });

    test("detects sequence number jump (pulse-1 then pulse-3 skipping pulse-2)", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-1" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 2,
          revision: 1,
          timestamp: "2026-08-21T01:05:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-1" },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 3,
          revision: 1,
          timestamp: "2026-08-21T01:10:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-3" },
          previous_hash: "h2",
          projection: null,
          hash: "h3",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 4,
          revision: 1,
          timestamp: "2026-08-21T01:15:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-3" },
          previous_hash: "h3",
          projection: null,
          hash: "h4",
        },
      ];

      const result = checkPulseGaps(events);
      expect(result.ok).toBe(false);
      expect(result.gaps.some((g) => g.includes("missing pulse in sequence: pulse-2"))).toBe(true);
    });

    test("detects duplicate open and duplicate close events", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-1" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 2,
          revision: 1,
          timestamp: "2026-08-21T01:01:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-1" },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 3,
          revision: 1,
          timestamp: "2026-08-21T01:10:00Z",
          actor: "mind-1",
          kind: "mind-pulse-opened",
          payload: { pulse_id: "pulse-2" },
          previous_hash: "h2",
          projection: null,
          hash: "h3",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 4,
          revision: 1,
          timestamp: "2026-08-21T01:11:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-2" },
          previous_hash: "h3",
          projection: null,
          hash: "h4",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 5,
          revision: 1,
          timestamp: "2026-08-21T01:12:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-2" },
          previous_hash: "h4",
          projection: null,
          hash: "h5",
        },
      ];

      const result = checkPulseGaps(events);
      expect(result.ok).toBe(false);
      expect(result.gaps.some((g) => g.includes("duplicate open events"))).toBe(true);
      expect(result.gaps.some((g) => g.includes("duplicate close events"))).toBe(true);
    });

    test("refuses approved audit report when pulse gap is planted, and permits changes_requested", () => {
      const fixture = setupPlantedAuditCapsule("pulse-gap-refusal");

      // Open pulse-1 and do not close it
      mindPulseOpenCommand({
        run: fixture.run,
        actor: "mind-1",
        host: "antigravity",
        driver: "bash-loop",
      });

      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      const cleanAnswers = generateCleanAnswers();

      // Attempting to approve must throw HarnessError due to the planted pulse gap
      expect(() =>
        mindAuditReportCommand({
          run: fixture.run,
          actor: "auditor-1",
          "audit-id": "audit-1",
          verdict: "approved",
          answer: cleanAnswers,
        }),
      ).toThrow(HarnessError);

      // Reporting with changes_requested records open findings and blocks subsequent pulse
      const reportRes = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        verdict: "changes_requested",
        summary: "Planted pulse gap detected",
        answer: [
          "Q1:cmd-1:fail:pulse-1 was opened but never closed",
          "Q2:cmd-2:pass",
          "Q3:cmd-3:pass",
          "Q4:cmd-4:pass",
          "Q5:cmd-5:pass",
          "Q6:cmd-6:pass",
          "Q7:cmd-7:pass",
          "Q8:cmd-8:pass",
        ],
      });

      expect(reportRes.verdict).toBe("changes_requested");
      expect(reportRes.open_findings.length).toBeGreaterThan(0);

      const loaded = loadRun(fixture.run, true);
      const blockResult = checkAuditBlocksPulse(loaded.state);
      expect(blockResult.blocked).toBe(true);
      expect(blockResult.outcome).toBe("blocked");
      expect(() => assertAuditAllowsPulseOpen(loaded.state)).toThrow(HarnessError);
    });

    test("unplanted clean pulse sequence returns approved and unblocks pulse open", async () => {
      const fixture = setupPlantedAuditCapsule("pulse-gap-clean");

      // Transact clean pulse-1 cycle
      transact(
        fixture.run,
        "mind-1",
        "mind-pulse-opened",
        { pulse_id: "pulse-1" },
        (working) => {
          working.pulse = { open: { pulse_id: "pulse-1" } } as unknown as JsonObject;
        },
      );
      transact(
        fixture.run,
        "mind-1",
        "mind-pulse-closed",
        { pulse_id: "pulse-1", outcome: "quiescent", value: 0 },
        (working) => {
          working.pulse = { open: null, last: { pulse_id: "pulse-1", outcome: "quiescent" } } as unknown as JsonObject;
        },
      );

      const loadedPre = loadRun(fixture.run, true);
      const gapCheck = checkPulseGaps(loadedPre.events);
      expect(gapCheck.ok).toBe(true);
      expect(gapCheck.gaps).toHaveLength(0);

      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      const reportRes = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        verdict: "approved",
        summary: "Audit clean: all pulse gaps accounted for",
        answer: generateCleanAnswers(),
      });

      expect(reportRes.verdict).toBe("approved");
      expect(reportRes.open_findings).toHaveLength(0);

      const loadedPost = loadRun(fixture.run, true);
      const blockResult = checkAuditBlocksPulse(loadedPost.state);
      expect(blockResult.blocked).toBe(false);
      expect(() => assertAuditAllowsPulseOpen(loadedPost.state)).not.toThrow();
    });
  });

  describe("Planted Defect 2: Witness Anomaly (Exits 0, Lacks Defect Substring, Missing Witness)", () => {
    test("detects admitted candidate whose witness command exited with code 0 (clean)", () => {
      const fixture = setupPlantedAuditCapsule("witness-exit-0");

      // Plant mock command that exits 0
      recordMockCommand(fixture.run, "cmd-clean-witness", {
        exitCode: 0,
        status: "succeeded",
        stdout: "All 120 tests passed successfully",
      });

      // Admitted candidate citing the clean command as defect witness
      transact(
        fixture.run,
        "mind-1",
        "mind-candidate-admitted",
        {
          candidate_id: "cand-falsified-defect",
          kind: "defect",
          witness_command_id: "cmd-clean-witness",
          charter_goal_ids: ["G1"],
        },
        (draft) => {
          const working = draft as Record<string, unknown>;
          const candidates = (working.candidates ?? []) as Record<string, unknown>[];
          candidates.push({
            id: "cand-falsified-defect",
            kind: "defect",
            status: "admitted",
            witness_command_id: "cmd-clean-witness",
            charter_goal_ids: ["G1"],
          });
          working.candidates = candidates;
        },
      );

      const loaded = loadRun(fixture.run, true);
      const witnessResult = checkAdmittedCandidateWitnesses(loaded.state, loaded.events, {
        capsuleRoot: fixture.run,
      });

      expect(witnessResult.ok).toBe(false);
      expect(witnessResult.findings).toHaveLength(1);
      expect(witnessResult.findings[0]).toContain(
        "exited with code 0; defect witnesses must exit non-zero",
      );

      expect(() => verifyDefectWitness("cmd-clean-witness", fixture.run)).toThrow(HarnessError);
      expect(() => verifyDefectWitness("cmd-clean-witness", fixture.run)).toThrow(
        /defect witnesses must exit non-zero/,
      );
    });

    test("detects witness command output lacking expected defect substring", () => {
      const fixture = setupPlantedAuditCapsule("witness-lacks-substring");

      // Plant mock command that failed but with irrelevant error
      recordMockCommand(fixture.run, "cmd-unrelated-error", {
        exitCode: 1,
        status: "failed",
        stderr: "Error: Connection timeout to remote registry",
      });

      expect(() =>
        verifyDefectWitness(
          "cmd-unrelated-error",
          fixture.run,
          "TypeError: Cannot read properties of undefined",
        ),
      ).toThrow(HarnessError);

      expect(() =>
        verifyDefectWitness(
          "cmd-unrelated-error",
          fixture.run,
          "TypeError: Cannot read properties of undefined",
        ),
      ).toThrow(/does not contain cited defect substring/);
    });

    test("detects admitted defect candidate with missing or empty witness command ID", () => {
      const stateWithMissingWitness = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        candidates: [
          {
            id: "cand-no-witness",
            kind: "defect",
            status: "admitted",
            witness_command_id: "",
          },
        ],
      } as unknown as RunState;

      const result = checkAdmittedCandidateWitnesses(stateWithMissingWitness, []);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("has no witness command id");
    });

    test("detects admitted defect candidate with non-existent witness command ID", () => {
      const fixture = setupPlantedAuditCapsule("witness-non-existent");

      const stateWithFakeWitness = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        candidates: [
          {
            id: "cand-fake-cmd",
            kind: "defect",
            status: "admitted",
            witness_command_id: "cmd-does-not-exist-999",
          },
        ],
      } as unknown as RunState;

      const result = checkAdmittedCandidateWitnesses(stateWithFakeWitness, [], {
        capsuleRoot: fixture.run,
      });
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain(
        "command 'cmd-does-not-exist-999' does not exist in any capsule",
      );
    });

    test("unplanted valid defect witness verifies cleanly and allows audit approval", () => {
      const fixture = setupPlantedAuditCapsule("witness-valid-clean");

      // Record authentic defect witness (non-zero exit with matching defect substring)
      recordMockCommand(fixture.run, "cmd-real-defect", {
        exitCode: 1,
        status: "failed",
        stderr: "AssertionError: expected value 42 to equal 100",
      });

      transact(
        fixture.run,
        "mind-1",
        "mind-candidate-admitted",
        {
          candidate_id: "cand-real-defect",
          kind: "defect",
          witness_command_id: "cmd-real-defect",
          charter_goal_ids: ["G1"],
        },
        (draft) => {
          const working = draft as Record<string, unknown>;
          const candidates = (working.candidates ?? []) as Record<string, unknown>[];
          candidates.push({
            id: "cand-real-defect",
            kind: "defect",
            status: "admitted",
            witness_command_id: "cmd-real-defect",
            charter_goal_ids: ["G1"],
          });
          working.candidates = candidates;
        },
      );

      const verification = verifyDefectWitness(
        "cmd-real-defect",
        fixture.run,
        "AssertionError: expected value 42 to equal 100",
      );
      expect(verification.exitCode).toBe(1);
      expect(verification.status).toBe("failed");
      expect(verification.evidenceClass).toBe("harness_observed");

      const loaded = loadRun(fixture.run, true);
      const witnessResult = checkAdmittedCandidateWitnesses(loaded.state, loaded.events, {
        capsuleRoot: fixture.run,
      });
      expect(witnessResult.ok).toBe(true);
      expect(witnessResult.findings).toHaveLength(0);
      expect(witnessResult.verifiedCount).toBe(1);
    });
  });

  describe("Planted Defect 3: Charter Violation (Non-Existent Goal Cited)", () => {
    test("detects admitted candidate citing unknown or forged charter goals", () => {
      const stateWithForgedGoals = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 3,
        event_head: "h3",
        candidates: [
          {
            id: "cand-rogue-goal",
            status: "admitted",
            charter_goal_ids: ["G1", "G_UNAUTHORIZED_HACK", "G99_NON_EXISTENT"],
          },
        ],
      } as unknown as RunState;

      const validGoals = ["G1", "G2"];
      const result = checkAdmittedCandidateGoals(stateWithForgedGoals, [], validGoals);

      expect(result.ok).toBe(false);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]).toContain(
        "admitted candidate 'cand-rogue-goal' cited non-existent charter goal 'G_UNAUTHORIZED_HACK'",
      );
      expect(result.findings[1]).toContain(
        "admitted candidate 'cand-rogue-goal' cited non-existent charter goal 'G99_NON_EXISTENT'",
      );
    });

    test("detects admitted candidate with empty charter goals list", () => {
      const stateWithZeroGoals = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        candidates: [
          {
            id: "cand-no-goals",
            status: "admitted",
            charter_goal_ids: [],
          },
        ],
      } as unknown as RunState;

      const result = checkAdmittedCandidateGoals(stateWithZeroGoals, [], ["G1", "G2"]);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain(
        "admitted candidate 'cand-no-goals' cites zero charter goals",
      );
    });

    test("admitted candidates with legitimate charter goals pass check cleanly", () => {
      const stateWithValidGoals = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        candidates: [
          {
            id: "cand-legit-1",
            status: "admitted",
            charter_goal_ids: ["G1"],
          },
          {
            id: "cand-legit-2",
            status: "admitted",
            charter_goal_ids: ["G1", "G2"],
          },
        ],
      } as unknown as RunState;

      const result = checkAdmittedCandidateGoals(stateWithValidGoals, [], ["G1", "G2"]);
      expect(result.ok).toBe(true);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Planted Defect 4: Value Inconsistency & Excluded Metrics", () => {
    test("detects pulse recording falsified value inflated above metric calculation", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T02:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: {
            pulse_id: "pulse-1",
            value: 50, // Inflated! Real value from metrics is 2
            metrics: {
              leases_reclaimed: 1,
              findings_resolved: 1,
              gates_flipped_red_to_green: 0,
              tasks_reaching_done: 0,
              candidates_admitted: 0,
              proposals_recorded: 0,
            },
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkValueConsistency(events, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toContain(
        "pulse pulse-1 recorded value 50 inconsistent with ledger metrics (computed 2)",
      );
    });

    test("detects pulse injecting forbidden metrics (tokens_spent, files_touched, commands_run)", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T02:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: {
            pulse_id: "pulse-1",
            value: 1,
            metrics: {
              leases_reclaimed: 1,
              findings_resolved: 0,
              gates_flipped_red_to_green: 0,
              tasks_reaching_done: 0,
              candidates_admitted: 0,
              proposals_recorded: 0,
              tokens_spent: 125000,
              files_touched: 14,
              commands_run: 28,
              agents_deployed: 6,
              words_written: 4500,
            },
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkValueConsistency(events, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.findings.length).toBe(5);
      expect(
        result.findings.some((f) => f.includes("metric 'tokens_spent' is explicitly excluded")),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.includes("metric 'files_touched' is explicitly excluded")),
      ).toBe(true);
      expect(
        result.findings.some((f) => f.includes("metric 'commands_run' is explicitly excluded")),
      ).toBe(true);
    });

    test("unplanted clean value computation produces consistent trailing series", () => {
      const metrics1 = {
        leases_reclaimed: 1,
        findings_resolved: 0,
        gates_flipped_red_to_green: 1,
        tasks_reaching_done: 1,
        candidates_admitted: 0,
        proposals_recorded: 0,
      };
      const value1 = calculatePulseValue(metrics1);
      expect(value1).toBe(3);

      const metrics2 = {
        leases_reclaimed: 0,
        findings_resolved: 2,
        gates_flipped_red_to_green: 0,
        tasks_reaching_done: 0,
        candidates_admitted: 1,
        proposals_recorded: 2, // capped at 1
      };
      const value2 = calculatePulseValue(metrics2);
      expect(value2).toBe(4);

      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T02:00:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: {
            pulse_id: "pulse-1",
            value: value1,
            metrics: metrics1,
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 2,
          revision: 1,
          timestamp: "2026-08-21T02:15:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: {
            pulse_id: "pulse-2",
            value: value2,
            metrics: metrics2,
          },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
      ];

      const result = checkValueConsistency(events, {} as unknown as RunState);
      expect(result.ok).toBe(true);
      expect(result.findings).toHaveLength(0);
      expect(result.series).toEqual([3, 4]);
    });
  });

  describe("Planted Defect 5: Scope Violation & Out-of-Band Modification", () => {
    test("detects task touching files outside declared write scope", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T03:00:00Z",
          actor: "worker-1",
          kind: "task-submitted",
          payload: {
            task_id: "T-01",
            write_scope: ["src/mind/"],
            touched_files: [
              "src/mind/audit.ts",
              "src/mind/witness.ts",
              "src/forbidden/unleased-file.ts",
              "contracts/capsule.ts",
            ],
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkScopeViolations(events, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]).toContain(
        "task T-01 touched file 'src/forbidden/unleased-file.ts' outside declared write scope [src/mind/]",
      );
      expect(result.findings[1]).toContain(
        "task T-01 touched file 'contracts/capsule.ts' outside declared write scope [src/mind/]",
      );
    });

    test("detects scope-violation-detected and out-of-band-drift ledger events", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T03:00:00Z",
          actor: "monitor-1",
          kind: "scope-violation-detected",
          payload: {
            detail: "untracked write detected in root directory",
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 2,
          revision: 1,
          timestamp: "2026-08-21T03:05:00Z",
          actor: "monitor-1",
          kind: "out-of-band-drift",
          payload: {
            reason: "file modified without active task lease",
          },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
      ];

      const result = checkScopeViolations(events, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.findings).toHaveLength(2);
      expect(result.findings[0]).toContain(
        "out-of-band scope change detected at sequence 1: untracked write detected in root directory",
      );
      expect(result.findings[1]).toContain(
        "out-of-band scope change detected at sequence 2: file modified without active task lease",
      );
    });

    test("unplanted clean scope operations pass check with zero findings", () => {
      const events: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T03:00:00Z",
          actor: "worker-1",
          kind: "task-submitted",
          payload: {
            task_id: "T-01",
            write_scope: ["src/mind/", "tests/unit/mind/"],
            touched_files: ["src/mind/audit.ts", "tests/unit/mind/audit.test.ts"],
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkScopeViolations(events, {} as unknown as RunState);
      expect(result.ok).toBe(true);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Planted Defect 6: Charter Digest Drift Without Owner Decision", () => {
    test("detects unrecorded charter sha modification without owner decision", () => {
      const pinnedSha = "1111111111111111111111111111111111111111111111111111111111111111";
      const currentSha = "2222222222222222222222222222222222222222222222222222222222222222";

      const stateWithPinned = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        mind: {
          charter: {
            pinned_sha256: pinnedSha,
          },
        },
      } as unknown as RunState;

      const eventsWithoutOwnerDecision: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T04:00:00Z",
          actor: "worker-1",
          kind: "task-submitted",
          payload: { task_id: "T-01" },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkCharterDigestIntegrity(stateWithPinned, eventsWithoutOwnerDecision, {
        currentSha,
        pinnedSha,
      });

      expect(result.ok).toBe(false);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]).toContain(
        `charter sha256 changed from pinned ${pinnedSha} to ${currentSha} without recorded owner decision`,
      );
    });

    test("passes when charter sha matches pinned sha exactly", () => {
      const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const state = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        mind: { charter: { pinned_sha256: sha } },
      } as unknown as RunState;

      const result = checkCharterDigestIntegrity(state, [], {
        currentSha: sha,
        pinnedSha: sha,
      });

      expect(result.ok).toBe(true);
      expect(result.findings).toHaveLength(0);
    });

    test("passes when charter digest changed but owner decision is recorded in event ledger", () => {
      const pinnedSha = "1111111111111111111111111111111111111111111111111111111111111111";
      const currentSha = "2222222222222222222222222222222222222222222222222222222222222222";

      const state = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 2,
        event_head: "h2",
        mind: { charter: { pinned_sha256: pinnedSha } },
      } as unknown as RunState;

      const eventsWithOwnerDecision: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T04:00:00Z",
          actor: "owner",
          kind: "owner-decision-recorded",
          payload: {
            decision: "charter-update",
            new_sha256: currentSha,
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkCharterDigestIntegrity(state, eventsWithOwnerDecision, {
        currentSha,
        pinnedSha,
      });

      expect(result.ok).toBe(true);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("Simultaneous Multi-Plant Anomaly Suite & Lifecycle Blocking", () => {
    test("detects all 6 planted defects simultaneously and blocks approval across all dimensions", () => {
      const fixture = setupPlantedAuditCapsule("multi-planted-all-six");

      // 1. Plant Pulse Gap: open pulse-1 without closing it
      mindPulseOpenCommand({
        run: fixture.run,
        actor: "mind-1",
        host: "antigravity",
        driver: "bash-loop",
      });

      // 2. Plant Witness Anomaly: record mock command that exits 0
      recordMockCommand(fixture.run, "cmd-multi-exit-0", {
        exitCode: 0,
        status: "succeeded",
        stdout: "Clean output",
      });

      // 3. Plant Charter Violation: candidate citing G99_FORGED
      transact(
        fixture.run,
        "mind-1",
        "mind-candidate-admitted",
        {
          candidate_id: "cand-multi-rogue",
          kind: "defect",
          witness_command_id: "cmd-multi-exit-0",
          charter_goal_ids: ["G99_FORGED"],
        },
        (draft) => {
          const working = draft as Record<string, unknown>;
          const candidates = (working.candidates ?? []) as Record<string, unknown>[];
          candidates.push({
            id: "cand-multi-rogue",
            kind: "defect",
            status: "admitted",
            witness_command_id: "cmd-multi-exit-0",
            charter_goal_ids: ["G99_FORGED"],
          });
          working.candidates = candidates;
        },
      );

      // 4. Plant Value Inconsistency & Forbidden Metrics
      transact(
        fixture.run,
        "mind-1",
        "mind-pulse-closed",
        {
          pulse_id: "pulse-planted-val",
          value: 999, // Falsified!
          metrics: {
            leases_reclaimed: 0,
            tokens_spent: 50000,
          },
        },
        () => {},
      );

      // 5. Plant Scope Violation: task touched unleased file
      transact(
        fixture.run,
        "worker-1",
        "task-submitted",
        {
          task_id: "T-MULTI",
          write_scope: ["src/mind/"],
          touched_files: ["unleased/secrets.env"],
        },
        () => {},
      );

      // 6. Plant Charter Digest Drift
      const loaded = loadRun(fixture.run, true);

      // Check all 6 checkers independently:
      const r1 = checkPulseGaps(loaded.events);
      expect(r1.ok).toBe(false);

      const r2 = checkAdmittedCandidateWitnesses(loaded.state, loaded.events, {
        capsuleRoot: fixture.run,
      });
      expect(r2.ok).toBe(false);

      const r3 = checkAdmittedCandidateGoals(loaded.state, loaded.events, ["G1", "G2"]);
      expect(r3.ok).toBe(false);

      const r4 = checkValueConsistency(loaded.events, loaded.state);
      expect(r4.ok).toBe(false);

      const r5 = checkScopeViolations(loaded.events, loaded.state);
      expect(r5.ok).toBe(false);

      const r6 = checkCharterDigestIntegrity(loaded.state, loaded.events, {
        currentSha: "modified_drifted_sha_99999999999999999999999999999999",
      });
      expect(r6.ok).toBe(false);

      // Start audit and report all findings
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-multi-1",
      });

      const multiFailAnswers = [
        "Q1:cmd-1:fail:Pulse 1 unclosed gap",
        "Q2:cmd-2:fail:Candidate witness exited 0",
        "Q3:cmd-3:fail:Candidate cited non-existent goal G99_FORGED",
        "Q4:cmd-4:fail:Value 999 inconsistent and contains forbidden tokens_spent metric",
        "Q5:cmd-5:fail:Task touched unleased/secrets.env outside declared scope",
        "Q6:cmd-6:pass",
        "Q7:cmd-7:pass",
        "Q8:cmd-8:fail:Charter sha drifted without owner decision",
      ];

      const reportRes = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-multi-1",
        verdict: "changes_requested",
        summary: "Multiple planted defects detected across ledger",
        answer: multiFailAnswers,
      });

      expect(reportRes.verdict).toBe("changes_requested");
      expect(reportRes.open_findings.length).toBe(6);

      const stateAfterReport = loadRun(fixture.run, true).state;
      const blockResult = checkAuditBlocksPulse(stateAfterReport);
      expect(blockResult.blocked).toBe(true);
      expect(blockResult.outcome).toBe("blocked");
      expect(() => assertAuditAllowsPulseOpen(stateAfterReport)).toThrow(HarnessError);
    });

    test("full lifecycle: planted defect halts/blocks -> remediation -> clean audit unblocks next pulse", () => {
      const fixture = setupPlantedAuditCapsule("lifecycle-halt-remediate");

      // 1. Auditor detects severe anomaly and issues halt verdict
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-lifecycle-1",
      });

      const haltAnswers = [
        "Q1:cmd-1:pass",
        "Q2:cmd-2:fail:Witness exited 0",
        "Q3:cmd-3:pass",
        "Q4:cmd-4:pass",
        "Q5:cmd-5:pass",
        "Q6:cmd-6:fail:Prohibited rm -rf command attempted",
        "Q7:cmd-7:pass",
        "Q8:cmd-8:pass",
      ];

      mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-lifecycle-1",
        verdict: "halt",
        summary: "Prohibited command and witness defect detected",
        answer: haltAnswers,
      });

      const haltedState = loadRun(fixture.run, true).state;
      expect((haltedState.mind as Record<string, unknown>).halted).toBe(true);
      expect(checkAuditBlocksPulse(haltedState).blocked).toBe(true);
      expect(checkAuditBlocksPulse(haltedState).outcome).toBe("halted");

      // Verify pulse open is refused
      expect(() =>
        mindPulseOpenCommand({
          run: fixture.run,
          actor: "mind-1",
          host: "antigravity",
          driver: "bash-loop",
        }),
      ).toThrow(HarnessError);

      // 2. Owner remediates and resets halt status
      transact(
        fixture.run,
        "owner",
        "mind-halt-cleared",
        { reason: "remediated planted defects" },
        (draft) => {
          const working = draft as Record<string, unknown>;
          const mindState = (working.mind ?? {}) as Record<string, unknown>;
          mindState.halted = false;
          mindState.halt_reason = undefined;
          working.mind = mindState;
        },
      );

      // 3. New audit cycle runs and returns approved clean verdict
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-lifecycle-2",
      });

      const cleanAnswers = generateCleanAnswers();
      const approvedRes = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-lifecycle-2",
        verdict: "approved",
        summary: "All defects remediated, clean approval",
        answer: cleanAnswers,
      });

      expect(approvedRes.verdict).toBe("approved");
      expect(approvedRes.open_findings).toHaveLength(0);

      const finalState = loadRun(fixture.run, true).state;
      const finalCheck = checkAuditBlocksPulse(finalState);
      expect(finalCheck.blocked).toBe(false);
      expect(() => assertAuditAllowsPulseOpen(finalState)).not.toThrow();

      // Now opening a pulse succeeds without throwing!
      const pulseOpenRes = mindPulseOpenCommand({
        run: fixture.run,
        actor: "mind-1",
        host: "antigravity",
        driver: "bash-loop",
      });
      expect(pulseOpenRes.pulse_id).toBe("pulse-1");
      expect(pulseOpenRes.actor).toBe("mind-1");
    });
  });
});
