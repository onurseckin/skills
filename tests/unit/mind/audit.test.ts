import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  mindAuditReportCommand,
  mindAuditStartCommand,
} from "../../../olt/scripts/src/cli/commands/mind-audit.ts";
import { mindPulseOpenCommand } from "../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import type { HarnessEvent, RunState } from "../../../olt/scripts/src/core/contracts/capsule.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  assertAuditAllowsPulseOpen,
  AUDIT_QUESTION_IDS,
  AUDIT_QUESTIONS,
  checkAdmittedCandidateGoals,
  checkAuditBlocksPulse,
  checkCharterDigestIntegrity,
  checkDeclinedCandidates,
  checkNeverUnattendedActions,
  checkPulseGaps,
  checkValueConsistency,
  normalizeQuestionId,
  validateAuditAnswers,
} from "../../../olt/scripts/src/mind/audit.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
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

function setupMindCapsule(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
    readonly registerAuditorAgent?: boolean;
    readonly registerMindAgent?: boolean;
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-audit-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test application for mind audit"\n  goals:\n    - id: "G1"\n      statement: "Ensure stability"\n    - id: "G2"\n      statement: "Performance improvements"\n  non_goals:\n    - "Out of scope items"\n  repo_roots:\n    - "src/"\n    - "docs/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

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
          repo_roots: ["src/", "docs/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
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

describe("Phase 5 W5.2 - Mind Audit Questionnaire & Verification", () => {
  describe("Audit Questionnaire Structure & Normalization", () => {
    test("defines exactly 8 fixed questions per PHASE-5 §3.2 and PLAN.md §12.2", () => {
      expect(AUDIT_QUESTIONS).toHaveLength(8);
      expect(AUDIT_QUESTION_IDS).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"]);

      const questionKeys = AUDIT_QUESTIONS.map((q) => q.key);
      expect(questionKeys).toContain("pulse_gaps");
      expect(questionKeys).toContain("witness_defects");
      expect(questionKeys).toContain("charter_goals");
      expect(questionKeys).toContain("value_consistency");
      expect(questionKeys).toContain("scope_violations");
      expect(questionKeys).toContain("never_unattended");
      expect(questionKeys).toContain("declined_candidates");
      expect(questionKeys).toContain("charter_digest");
    });

    test("normalizes question IDs across various alias representations", () => {
      expect(normalizeQuestionId("Q1")).toBe("Q1");
      expect(normalizeQuestionId("1")).toBe("Q1");
      expect(normalizeQuestionId("pulse_gaps")).toBe("Q1");
      expect(normalizeQuestionId("pulse-gaps")).toBe("Q1");
      expect(normalizeQuestionId("Q8")).toBe("Q8");
      expect(normalizeQuestionId("8")).toBe("Q8");
      expect(normalizeQuestionId("charter_digest")).toBe("Q8");
      expect(normalizeQuestionId("unknown-q")).toBeUndefined();
    });
  });

  describe("Command ID Requirement & Answers Validation", () => {
    test("accepts valid 8-question answer list with command IDs", () => {
      const answers = generateCleanAnswers();
      const validated = validateAuditAnswers(answers);
      expect(validated).toHaveLength(8);
      expect(validated[0]!.question_id).toBe("Q1");
      expect(validated[0]!.command_id).toBe("cmd-101");
      expect(validated[0]!.verdict).toBe("pass");
    });

    test("refuses answers when any question lacks a command ID", () => {
      const missingCmdAnswers = [
        "Q1::pass", // missing command ID
        "Q2:cmd-102:pass",
        "Q3:cmd-103:pass",
        "Q4:cmd-104:pass",
        "Q5:cmd-105:pass",
        "Q6:cmd-106:pass",
        "Q7:cmd-107:pass",
        "Q8:cmd-108:pass",
      ];

      expect(() => validateAuditAnswers(missingCmdAnswers)).toThrow(HarnessError);
      expect(() => validateAuditAnswers(missingCmdAnswers)).toThrow(
        /must cite a non-empty command id/,
      );
    });

    test("refuses answers when fewer than 8 questions are answered", () => {
      const incompleteAnswers = ["Q1:cmd-101:pass", "Q2:cmd-102:pass", "Q3:cmd-103:pass"];

      expect(() => validateAuditAnswers(incompleteAnswers)).toThrow(HarnessError);
      expect(() => validateAuditAnswers(incompleteAnswers)).toThrow(
        /missing answers for audit questionnaire/,
      );
    });

    test("accepts object format with question IDs or keys", () => {
      const answerObj = {
        Q1: { command_id: "cmd-1", verdict: "pass", statement: "Clean" },
        Q2: { command_id: "cmd-2", verdict: "pass" },
        Q3: { command_id: "cmd-3", verdict: "pass" },
        Q4: { command_id: "cmd-4", verdict: "pass" },
        Q5: { command_id: "cmd-5", verdict: "pass" },
        Q6: { command_id: "cmd-6", verdict: "pass" },
        Q7: { command_id: "cmd-7", verdict: "pass" },
        Q8: { command_id: "cmd-8", verdict: "pass" },
      };

      const validated = validateAuditAnswers(answerObj);
      expect(validated).toHaveLength(8);
      expect(validated[0]!.command_id).toBe("cmd-1");
    });

    test("refuses object format when command ID is empty string", () => {
      const answerObj = {
        Q1: { command_id: "   ", verdict: "pass" },
        Q2: { command_id: "cmd-2", verdict: "pass" },
        Q3: { command_id: "cmd-3", verdict: "pass" },
        Q4: { command_id: "cmd-4", verdict: "pass" },
        Q5: { command_id: "cmd-5", verdict: "pass" },
        Q6: { command_id: "cmd-6", verdict: "pass" },
        Q7: { command_id: "cmd-7", verdict: "pass" },
        Q8: { command_id: "cmd-8", verdict: "pass" },
      };

      expect(() => validateAuditAnswers(answerObj)).toThrow(HarnessError);
      expect(() => validateAuditAnswers(answerObj)).toThrow(/must cite a non-empty command id/);
    });
  });

  describe("8 Verification Check Functions", () => {
    test("Q1 checkPulseGaps detects gaps in open/close pairs and sequence jumps", () => {
      const cleanEvents: HarnessEvent[] = [
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
          timestamp: "2026-08-21T01:10:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-1" },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
      ];

      const cleanResult = checkPulseGaps(cleanEvents);
      expect(cleanResult.ok).toBe(true);
      expect(cleanResult.gaps).toHaveLength(0);

      // Defective: pulse-1 opened but never closed, and pulse-3 closed without open (skipping pulse-2)
      const defectiveEvents: HarnessEvent[] = [
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
          timestamp: "2026-08-21T01:10:00Z",
          actor: "mind-1",
          kind: "mind-pulse-closed",
          payload: { pulse_id: "pulse-3" },
          previous_hash: "h1",
          projection: null,
          hash: "h2",
        },
      ];

      const defResult = checkPulseGaps(defectiveEvents);
      expect(defResult.ok).toBe(false);
      expect(defResult.gaps.some((g) => g.includes("opened but never closed"))).toBe(true);
      expect(defResult.gaps.some((g) => g.includes("no open event"))).toBe(true);
    });

    test("Q3 checkAdmittedCandidateGoals detects invalid charter goals", () => {
      const stateWithInvalidGoal = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 5,
        event_head: "h5",
        candidates: [
          {
            id: "cand-1",
            status: "admitted",
            charter_goal_ids: ["G1", "G99_INVALID"],
          },
        ],
      } as unknown as RunState;

      const result = checkAdmittedCandidateGoals(stateWithInvalidGoal, [], ["G1", "G2"]);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("non-existent charter goal 'G99_INVALID'");
    });

    test("Q4 checkValueConsistency verifies value matches ledger computation", () => {
      const eventsWithValue: HarnessEvent[] = [
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
          payload: {
            pulse_id: "pulse-1",
            value: 100, // Inflated/falsified value
            metrics: {
              leases_reclaimed: 1,
              findings_resolved: 0,
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

      const result = checkValueConsistency(eventsWithValue, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("inconsistent with ledger metrics");
    });

    test("Q6 checkNeverUnattendedActions catches prohibited command patterns", () => {
      const eventsWithProhibited: HarnessEvent[] = [
        {
          schema: "harness.event",
          version: 1,
          run_id: "r1",
          capsule_id: "c1",
          sequence: 1,
          revision: 1,
          timestamp: "2026-08-21T01:00:00Z",
          actor: "worker-1",
          kind: "run-exec",
          payload: {
            command: "git push --force origin main",
          },
          previous_hash: null,
          projection: null,
          hash: "h1",
        },
      ];

      const result = checkNeverUnattendedActions(eventsWithProhibited, {} as unknown as RunState);
      expect(result.ok).toBe(false);
      expect(result.violations[0]).toContain("prohibited never-unattended command");
    });

    test("Q7 checkDeclinedCandidates checks non-empty decline reason", () => {
      const stateWithDeclined = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 2,
        event_head: "h2",
        candidates: [
          {
            id: "cand-1",
            status: "declined",
            decline_reason: "   ", // Blank reason!
          },
        ],
      } as unknown as RunState;

      const result = checkDeclinedCandidates(stateWithDeclined, []);
      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("missing a non-empty decline reason");
    });

    test("Q8 checkCharterDigestIntegrity detects unauthorized charter sha drift", () => {
      const stateWithPinned = {
        schema: "harness.state",
        version: 1,
        revision: 1,
        event_sequence: 1,
        event_head: "h1",
        mind: {
          charter: {
            pinned_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      } as unknown as RunState;

      const result = checkCharterDigestIntegrity(stateWithPinned, [], {
        currentSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });

      expect(result.ok).toBe(false);
      expect(result.findings[0]).toContain("without recorded owner decision");
    });
  });

  describe("mind:audit-start Command", () => {
    test("starts audit cycle and records event in hash chain", () => {
      const fixture = setupMindCapsule("start-basic");
      const res = mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        "window-start": "2026-08-20T00:00:00Z",
      });

      expect(res.audit_id).toBe("audit-1");
      expect(res.actor).toBe("auditor-1");
      expect(res.status).toBe("in_progress");
      expect(res.markdown).toContain("Mind Audit Started: `audit-1`");

      const loaded = loadRun(fixture.run, true);
      const auditState = loaded.state.audit as Record<string, unknown>;
      expect(auditState.status).toBe("in_progress");
      expect(auditState.audit_id).toBe("audit-1");

      const issues = verifyIntegrity(fixture.run);
      expect(issues).toHaveLength(0);
    });

    test("refuses agent without grant or with unauthorized role", () => {
      const fixture = setupMindCapsule("start-unauth");
      expect(() =>
        mindAuditStartCommand({
          run: fixture.run,
          actor: "unregistered-agent",
        }),
      ).toThrow(HarnessError);

      agentRegisterCommand({
        run: fixture.run,
        agent: "impl-1",
        role: "implementer",
        host: "antigravity",
      });

      expect(() =>
        mindAuditStartCommand({
          run: fixture.run,
          actor: "impl-1",
        }),
      ).toThrow(HarnessError);
    });

    test("refuses starting audit when mind is halted", () => {
      const fixture = setupMindCapsule("start-halted");
      transact(fixture.run, "owner", "mind-halted", { reason: "manual test halt" }, (working) => {
        const mindState = (working.mind ?? {}) as Record<string, unknown>;
        mindState.halted = true;
        mindState.halt_reason = "manual test halt";
        working.mind = mindState as unknown as JsonObject;
      });

      expect(() =>
        mindAuditStartCommand({
          run: fixture.run,
          actor: "auditor-1",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("mind:audit-report Command & Gaps Enforcement", () => {
    test("approves clean audit when all 8 answers pass and no pulse gaps exist", () => {
      const fixture = setupMindCapsule("report-approved");
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      const res = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        verdict: "approved",
        summary: "All verification checks passed cleanly",
        answer: generateCleanAnswers(),
      });

      expect(res.verdict).toBe("approved");
      expect(res.open_findings).toHaveLength(0);
      expect(res.markdown).toContain("APPROVED");

      const loaded = loadRun(fixture.run, true);
      const auditState = loaded.state.audit as Record<string, unknown>;
      expect(auditState.status).toBe("approved");
      expect(auditState.last_verdict).toBe("approved");
    });

    test("refuses approved verdict when pulse gaps exist (Question 1)", () => {
      const fixture = setupMindCapsule("report-gap-refusal");

      // Open pulse-1 without closing it
      mindPulseOpenCommand({
        run: fixture.run,
        actor: "mind-1",
        host: "antigravity",
        driver: "bash-loop",
      });

      // Transact another un-closed pulse to create a gap
      transact(
        fixture.run,
        "mind-1",
        "mind-pulse-opened",
        { pulse_id: "pulse-2", opened_at: new Date().toISOString() },
        (working) => {
          const pulse = (working.pulse ?? {}) as Record<string, unknown>;
          pulse.counter = 2;
          working.pulse = pulse as unknown as JsonObject;
        },
      );

      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      const cleanAnswers = generateCleanAnswers();

      expect(() =>
        mindAuditReportCommand({
          run: fixture.run,
          actor: "auditor-1",
          "audit-id": "audit-1",
          verdict: "approved",
          answer: cleanAnswers,
        }),
      ).toThrow(HarnessError);
      expect(() =>
        mindAuditReportCommand({
          run: fixture.run,
          actor: "auditor-1",
          "audit-id": "audit-1",
          verdict: "approved",
          answer: cleanAnswers,
        }),
      ).toThrow(/cannot approve audit when pulse gaps exist/);
    });

    test("allows changes_requested verdict when findings or gaps exist", () => {
      const fixture = setupMindCapsule("report-changes-req");
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      const answersWithFinding = [
        "Q1:cmd-1:fail:Pulse 2 had no corresponding close event",
        "Q2:cmd-2:pass",
        "Q3:cmd-3:pass",
        "Q4:cmd-4:pass",
        "Q5:cmd-5:pass",
        "Q6:cmd-6:pass",
        "Q7:cmd-7:pass",
        "Q8:cmd-8:pass",
      ];

      const res = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        verdict: "changes_requested",
        summary: "Pulse gap in Q1 requires investigation",
        answer: answersWithFinding,
      });

      expect(res.verdict).toBe("changes_requested");
      expect(res.open_findings.length).toBeGreaterThan(0);

      const loaded = loadRun(fixture.run, true);
      const auditState = loaded.state.audit as Record<string, unknown>;
      expect(auditState.status).toBe("changes_requested");
      expect(auditState.open_findings).toContain("Q1: Pulse 2 had no corresponding close event");
    });

    test("parses answers from --answers-file JSON", () => {
      const fixture = setupMindCapsule("report-file-answers");
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      const answersJsonPath = join(fixture.run, "answers.json");
      const fileData = [
        { question_id: "Q1", command_id: "cmd-1", verdict: "pass" },
        { question_id: "Q2", command_id: "cmd-2", verdict: "pass" },
        { question_id: "Q3", command_id: "cmd-3", verdict: "pass" },
        { question_id: "Q4", command_id: "cmd-4", verdict: "pass" },
        { question_id: "Q5", command_id: "cmd-5", verdict: "pass" },
        { question_id: "Q6", command_id: "cmd-6", verdict: "pass" },
        { question_id: "Q7", command_id: "cmd-7", verdict: "pass" },
        { question_id: "Q8", command_id: "cmd-8", verdict: "pass" },
      ];
      writeFileSync(answersJsonPath, JSON.stringify(fileData), "utf-8");

      const res = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        "answers-file": "answers.json",
        verdict: "approved",
      });

      expect(res.verdict).toBe("approved");
      expect(res.answers).toHaveLength(8);
    });
  });

  describe("Halt Verdict & Pulse-Open Wake Blocking", () => {
    test("halt verdict halts the mind and blocks next pulse-open", () => {
      const fixture = setupMindCapsule("report-halt-blocking");
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      const haltAnswers = [
        "Q1:cmd-1:pass",
        "Q2:cmd-2:fail:Candidate 5 defect witness exited 0",
        "Q3:cmd-3:pass",
        "Q4:cmd-4:pass",
        "Q5:cmd-5:pass",
        "Q6:cmd-6:fail:Prohibited git push command attempted",
        "Q7:cmd-7:pass",
        "Q8:cmd-8:pass",
      ];

      const reportRes = mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        verdict: "halt",
        summary: "Critical defect and prohibited action detected",
        answer: haltAnswers,
      });

      expect(reportRes.verdict).toBe("halt");

      const loaded = loadRun(fixture.run, true);
      const mindState = loaded.state.mind as Record<string, unknown>;
      expect(mindState.halted).toBe(true);

      const blockCheck = checkAuditBlocksPulse(loaded.state);
      expect(blockCheck.blocked).toBe(true);
      expect(blockCheck.outcome).toBe("halted");

      expect(() => assertAuditAllowsPulseOpen(loaded.state)).toThrow(HarnessError);

      // Opening next pulse must be blocked!
      expect(() =>
        mindPulseOpenCommand({
          run: fixture.run,
          actor: "mind-1",
          host: "antigravity",
          driver: "bash-loop",
        }),
      ).toThrow(HarnessError);
      expect(() =>
        mindPulseOpenCommand({
          run: fixture.run,
          actor: "mind-1",
          host: "antigravity",
          driver: "bash-loop",
        }),
      ).toThrow(/mind is halted/);
    });

    test("open audit findings block pulse from proceeding past WAKE", () => {
      const fixture = setupMindCapsule("open-findings-blocking");
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        verdict: "changes_requested",
        summary: "Finding detected in candidate goals",
        answer: [
          "Q1:cmd-1:pass",
          "Q2:cmd-2:pass",
          "Q3:cmd-3:fail:Candidate cited non-existent goal G99",
          "Q4:cmd-4:pass",
          "Q5:cmd-5:pass",
          "Q6:cmd-6:pass",
          "Q7:cmd-7:pass",
          "Q8:cmd-8:pass",
        ],
      });

      const loaded = loadRun(fixture.run, true);
      const blockCheck = checkAuditBlocksPulse(loaded.state);
      expect(blockCheck.blocked).toBe(true);
      expect(blockCheck.outcome).toBe("blocked");
      expect(blockCheck.reason).toContain("open audit finding(s) block next pulse");

      expect(() => assertAuditAllowsPulseOpen(loaded.state)).toThrow(HarnessError);
    });

    test("assertAuditAllowsPulseOpen succeeds when audit is approved and clean", () => {
      const fixture = setupMindCapsule("approved-clean");
      mindAuditStartCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
      });

      mindAuditReportCommand({
        run: fixture.run,
        actor: "auditor-1",
        "audit-id": "audit-1",
        verdict: "approved",
        answer: generateCleanAnswers(),
      });

      const loaded = loadRun(fixture.run, true);
      const blockCheck = checkAuditBlocksPulse(loaded.state);
      expect(blockCheck.blocked).toBe(false);

      expect(() => assertAuditAllowsPulseOpen(loaded.state)).not.toThrow();
    });
  });
});
