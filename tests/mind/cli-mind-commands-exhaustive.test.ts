import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatMindAuditStartBrief,
  mindAuditStartCommand,
} from "../../olt/scripts/src/cli/commands/mind-audit-start.ts";
import {
  formatMindAuditReportBrief,
  mindAuditReportCommand,
} from "../../olt/scripts/src/cli/commands/mind-audit-report.ts";
import { mindAuditLiveCommand } from "../../olt/scripts/src/cli/commands/mind-audit-live.ts";
import {
  mindRoundOpenCommand,
  mindRoundCloseCommand,
  formatMindRoundOpenBrief,
  formatMindRoundCloseBrief,
} from "../../olt/scripts/src/cli/commands/mind-round.ts";
import {
  mindAdmitCommand,
  mindDeclineCommand,
  formatMindAdmitBrief,
} from "../../olt/scripts/src/cli/commands/mind-admit.ts";
import {
  mindCandidateCommand,
  formatMindCandidateBrief,
} from "../../olt/scripts/src/cli/commands/mind-candidate.ts";
import {
  mindObserveCommand,
  formatMindObserveBrief,
} from "../../olt/scripts/src/cli/commands/mind-observe.ts";
import {
  mindPulseCommand,
  computeMindCognitiveTelemetry,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  formatPulseDirective,
} from "../../olt/scripts/src/cli/commands/mind-pulse.ts";
import { mindPulseOpenCommand } from "../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { mindQuiesceCommand } from "../../olt/scripts/src/cli/commands/mind-quiesce.ts";
import { mindInitCommand } from "../../olt/scripts/src/cli/commands/mind-init.ts";
import { mindWakeCommand } from "../../olt/scripts/src/cli/commands/mind-wake.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { initRun, loadRun, transact } from "../../olt/scripts/src/engine/store/index.ts";
import { writeAgentLedger } from "../../olt/scripts/src/workflow/agents/ledger.ts";
import { MindAuditorEngine } from "../../olt/scripts/src/mind/auditing/cognitive/index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

function createTestFixture(name = "mind-cli-fixture") {
  const repo = mkdtempSync(join(tmpdir(), `mind-cli-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent = `
# Mind Charter
goals:
  - G1
  - G2
  - G3
repo_roots:
  - .
budgets:
  pulses_per_day: 100
  wall_clock_ms_per_day: 86400000
  max_agents_in_flight: 5
  max_rounds_per_objective: 3
  base_interval_ms: 900000
  max_interval_ms: 7200000
  pulse_deadline_ms: 1800000
  max_open_proposals: 5
`;
  writeFileSync(charterPath, charterContent.trim());
  const charterBytes = Buffer.from(charterContent.trim(), "utf-8");
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `run-${name}`, charterBytes, "file", true);
  roots.push(run);

  // Set initial mind state
  transact(run, "owner", "mind-initialized", { generation: 1 }, (state) => {
    state.mind = {
      generation: 1,
      opened_at: new Date().toISOString(),
      charter: {
        source_path: "olt/agents/mind.yaml",
        pinned_sha256: charterSha,
        goals: ["G1", "G2", "G3"],
        repo_roots: ["."],
        evidence_class: "harness_observed",
      },
      halted: false,
    };
    state.budget = {
      pulses_per_day: 100,
      wall_clock_ms_per_day: 86400000,
      pulse_deadline_ms: 1800000,
      base_interval_ms: 900000,
      day_key: new Date().toISOString().slice(0, 10),
      pulses_today: 0,
      wall_clock_ms_today: 0,
      max_rounds_per_objective: 3,
      max_open_proposals: 5,
    };
    state.pulse = {
      counter: 0,
      open: null,
      last: null,
    };
    writeAgentLedger(state, [
      {
        id: "mind-1",
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: new Date().toISOString(),
        status: "active",
      },
      {
        id: "auditor-1",
        role: "mind-auditor",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: new Date().toISOString(),
        status: "active",
      },
      {
        id: "orch-1",
        role: "orchestrator",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: new Date().toISOString(),
        status: "active",
      },
      {
        id: "worker-1",
        role: "implementer",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: new Date().toISOString(),
        status: "active",
      },
    ]);
  });

  return { repo, run, charterPath, charterSha };
}

describe("CLI Mind Commands - Exhaustive Unit Tests", () => {
  describe("mindAuditLiveCommand", () => {
    it("runs audit live in healthy and stagnant modes", async () => {
      const fix = createTestFixture("audit-live");
      // healthy
      const resHealthy = await mindAuditLiveCommand({
        repo: fix.repo,
        threshold: 300,
        json: true,
      });
      expect(resHealthy).toBeDefined();
      expect(typeof resHealthy.stagnant).toBe("boolean");
      expect(resHealthy.json).toBe(true);

      // spy on auditMindPulse to return stagnant with injectionPrompt
      const orig = MindAuditorEngine.auditMindPulse;
      MindAuditorEngine.auditMindPulse = () =>
        ({
          stagnant: true,
          idleDurationSeconds: 400,
          localDefectCount: 1,
          defectCreated: true,
          remediation: "Trigger pulse",
          injectionPrompt: "INJECT_PULSE_NOW",
          telemetry: {
            pendingBacklogCount: 2,
            unresolvedDefectCount: 1,
          },
          cursor: {
            lastInspectedTimestamp: "2026-08-31T00:00:00Z",
            lastInspectedPulseSequence: 1,
          },
        }) as any;

      try {
        const resStagnant = await mindAuditLiveCommand({
          threshold: 120,
          "conversation-id": "conv-123",
        });
        expect(resStagnant.stagnant).toBe(true);
        expect(resStagnant.injection_prompt).toBe("INJECT_PULSE_NOW");
        expect(resStagnant.output).toContain("STAGNANT");
      } finally {
        MindAuditorEngine.auditMindPulse = orig;
      }
    });
  });

  describe("mindAuditStartCommand", () => {
    it("handles invalid now timestamp", () => {
      const fix = createTestFixture("audit-start-now");
      expect(() =>
        mindAuditStartCommand({
          run: fix.run,
          actor: "auditor-1",
          now: "invalid-date",
        }),
      ).toThrow(HarnessError);
    });

    it("auto-grants for known actors and rejects unknown actors", () => {
      const fix = createTestFixture("audit-start-auto");
      // Auto-grant for mind-auditor-x
      const res = mindAuditStartCommand({
        run: fix.run,
        actor: "mind-auditor-2",
        "audit-id": "custom-audit-1",
        window: "2026-08-30T00:00:00Z",
      });
      expect(res.audit_id).toBe("custom-audit-1");
      expect(res.status).toBe("in_progress");

      // Unknown actor without grant
      expect(() =>
        mindAuditStartCommand({
          run: fix.run,
          actor: "random-unregistered-actor",
        }),
      ).toThrow(HarnessError);

      // Actor with invalid role (worker-1 is implementer)
      expect(() =>
        mindAuditStartCommand({
          run: fix.run,
          actor: "worker-1",
        }),
      ).toThrow(HarnessError);
    });

    it("rejects when mind is halted", () => {
      const fix = createTestFixture("audit-start-halted");
      transact(fix.run, "owner", "halt-mind", {}, (state) => {
        state.mind = { halted: true, halt_reason: "critical drift" } as any;
      });
      expect(() =>
        mindAuditStartCommand({
          run: fix.run,
          actor: "auditor-1",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("mindAuditReportCommand", () => {
    it("validates now timestamp, verdict parsing, and answer sources", () => {
      const fix = createTestFixture("audit-report-val");

      // Invalid now
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "auditor-1",
          verdict: "approved",
          now: "invalid",
        }),
      ).toThrow(HarnessError);

      // Invalid verdict
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "auditor-1",
          verdict: "invalid_verdict_str",
        }),
      ).toThrow(HarnessError);

      // Missing answer source
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "auditor-1",
          verdict: "approved",
        }),
      ).toThrow(HarnessError);

      // Answers file missing
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "auditor-1",
          verdict: "approved",
          "answers-file": "nonexistent-answers.json",
        }),
      ).toThrow(HarnessError);

      // Answers file corrupt JSON
      const corruptFile = join(fix.run, "corrupt.json");
      writeFileSync(corruptFile, "{not-json");
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "auditor-1",
          verdict: "approved",
          "answers-file": "corrupt.json",
        }),
      ).toThrow(HarnessError);
    });

    it("verdict aliases and actor roles", () => {
      const fix = createTestFixture("audit-report-aliases");

      // Start an audit first
      mindAuditStartCommand({ run: fix.run, actor: "auditor-1" });

      const allPassAnswers = [
        "Q1:pass:cmd-1:statement 1",
        "Q2:pass:cmd-2:statement 2",
        "Q3:pass:cmd-3:statement 3",
        "Q4:pass:cmd-4:statement 4",
        "Q5:pass:cmd-5:statement 5",
        "Q6:pass:cmd-6:statement 6",
        "Q7:pass:cmd-7:statement 7",
        "Q8:pass:cmd-8:statement 8",
      ];

      // Unknown actor
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "unknown-actor-xyz",
          verdict: "approved",
          answer: allPassAnswers,
        }),
      ).toThrow(HarnessError);

      // Invalid role (worker-1 is implementer)
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "worker-1",
          verdict: "approved",
          answer: allPassAnswers,
        }),
      ).toThrow(HarnessError);

      // Auto-grant actor reporting changes_requested via alias "failed"
      const failedAnswers = [
        "Q1:pass:cmd-1:statement 1",
        "Q2:fail:cmd-2:statement 2",
        "Q3:pass:cmd-3:statement 3",
        "Q4:pass:cmd-4:statement 4",
        "Q5:pass:cmd-5:statement 5",
        "Q6:pass:cmd-6:statement 6",
        "Q7:pass:cmd-7:statement 7",
        "Q8:pass:cmd-8:statement 8",
      ];
      const resChanges = mindAuditReportCommand({
        run: fix.run,
        actor: "mind-auditor-1",
        verdict: "failed",
        answer: failedAnswers,
      });
      expect(resChanges.verdict).toBe("changes_requested");

      // Halt verdict
      const resHalt = mindAuditReportCommand({
        run: fix.run,
        actor: "auditor-1",
        verdict: "halted",
        answer: failedAnswers,
      });
      expect(resHalt.verdict).toBe("halt");
      const loaded = loadRun(fix.run);
      expect((loaded.state.mind as any).halted).toBe(true);
    });

    it("rejects approved verdict when findings are open or Q1 failed", () => {
      const fix = createTestFixture("audit-report-fail-approved");
      mindAuditStartCommand({ run: fix.run, actor: "auditor-1" });

      const failedAnswers = [
        "Q1:cmd-1:fail:statement 1",
        "Q2:cmd-2:pass:statement 2",
        "Q3:cmd-3:pass:statement 3",
        "Q4:cmd-4:pass:statement 4",
        "Q5:cmd-5:pass:statement 5",
        "Q6:cmd-6:pass:statement 6",
        "Q7:cmd-7:pass:statement 7",
        "Q8:cmd-8:pass:statement 8",
      ];
      expect(() =>
        mindAuditReportCommand({
          run: fix.run,
          actor: "auditor-1",
          verdict: "pass",
          answer: failedAnswers,
        }),
      ).toThrow(HarnessError);
    });

    it("reads answers from JSON answers-file with findings arrays", () => {
      const fix = createTestFixture("audit-report-json-file");
      mindAuditStartCommand({ run: fix.run, actor: "auditor-1" });

      const answersObj = [
        { question_id: "Q1", verdict: "pass", command_id: "cmd-1", statement: "clean" },
        {
          question_id: "Q2",
          verdict: "fail",
          command_id: "cmd-2",
          statement: "fail stmt",
          findings: ["Finding A", "Finding B"],
        },
        { question_id: "Q3", verdict: "pass", command_id: "cmd-3", statement: "clean" },
        { question_id: "Q4", verdict: "pass", command_id: "cmd-4", statement: "clean" },
        { question_id: "Q5", verdict: "pass", command_id: "cmd-5", statement: "clean" },
        { question_id: "Q6", verdict: "pass", command_id: "cmd-6", statement: "clean" },
        { question_id: "Q7", verdict: "pass", command_id: "cmd-7", statement: "clean" },
        { question_id: "Q8", verdict: "pass", command_id: "cmd-8", statement: "clean" },
      ];
      const answersPath = join(fix.run, "my-answers.json");
      writeFileSync(answersPath, JSON.stringify(answersObj));

      const res = mindAuditReportCommand({
        run: fix.run,
        actor: "auditor-1",
        verdict: "changes_requested",
        "answers-file": "my-answers.json",
        summary: "Custom summary for changes",
      });
      expect(res.verdict).toBe("changes_requested");
      expect(res.open_findings).toContain("Finding A");
      expect(res.open_findings).toContain("Finding B");
    });
  });

  describe("mindRoundCommand", () => {
    it("handles round open and close error paths and auto grants", () => {
      const fix = createTestFixture("mind-round-flow");

      // Admitted candidate first
      transact(fix.run, "owner", "add-candidate", {}, (state) => {
        state.candidates = [
          {
            id: "cand-1",
            kind: "defect",
            statement: "Fix defect 1",
            status: "admitted",
            charter_goal_ids: ["G1"],
            write_scope: ["src"],
            falsifier_argv: ["test"],
            falsifier_exit: 1,
            witness_command_id: "cmd-1",
            created_at: new Date().toISOString(),
          },
        ] as any;
      });

      // Unknown actor on round open
      expect(() =>
        mindRoundOpenCommand({
          run: fix.run,
          actor: "unregistered-stranger",
          objective: "obj-1",
          candidate: "cand-1",
        }),
      ).toThrow(HarnessError);

      // Actor with invalid role (worker-1 is implementer)
      expect(() =>
        mindRoundOpenCommand({
          run: fix.run,
          actor: "worker-1",
          objective: "obj-1",
          candidate: "cand-1",
        }),
      ).toThrow(HarnessError);

      // Halt check on round open
      transact(fix.run, "owner", "halt-mind", {}, (state) => {
        state.mind = { halted: true, halt_reason: "emergency" } as any;
      });
      expect(() =>
        mindRoundOpenCommand({
          run: fix.run,
          actor: "orch-1",
          objective: "obj-1",
          candidate: "cand-1",
        }),
      ).toThrow(HarnessError);

      // Unhalt
      transact(fix.run, "owner", "unhalt-mind", {}, (state) => {
        state.mind = { halted: false } as any;
      });

      // Auto-grant actor opening round
      const openRes = mindRoundOpenCommand({
        run: fix.run,
        actor: "coordinator-1",
        objective: "obj-1",
        candidate: "cand-1",
      });
      expect(openRes.round).toBe(1);
      expect(openRes.objective_id).toBe("obj-1");

      // Close round validations
      // Missing result
      expect(() =>
        mindRoundCloseCommand({
          run: fix.run,
          actor: "orch-1",
          objective: "obj-1",
          round: 1,
        }),
      ).toThrow(HarnessError);

      // Invalid result
      expect(() =>
        mindRoundCloseCommand({
          run: fix.run,
          actor: "orch-1",
          objective: "obj-1",
          round: 1,
          result: "not_a_valid_result",
        }),
      ).toThrow(HarnessError);

      // Unknown actor on close
      expect(() =>
        mindRoundCloseCommand({
          run: fix.run,
          actor: "unregistered-actor-xyz",
          objective: "obj-1",
          round: 1,
          result: "converged",
          reason: "done",
        }),
      ).toThrow(HarnessError);

      // Invalid role on close
      expect(() =>
        mindRoundCloseCommand({
          run: fix.run,
          actor: "worker-1",
          objective: "obj-1",
          round: 1,
          result: "converged",
          reason: "done",
        }),
      ).toThrow(HarnessError);

      // Auto-grant actor on close
      const closeRes = mindRoundCloseCommand({
        run: fix.run,
        actor: "orchestrator-auto",
        objective: "obj-1",
        round: 1,
        result: "converged",
        reason: "All tests pass",
      });
      expect(closeRes.result).toBe("converged");
      expect(closeRes.terminal_reason).toBe("All tests pass");
    });
  });

  describe("mindAdmitCommand and mindCandidateDeclineCommand", () => {
    it("handles charter resolution fallbacks, grant checks, and candidate validation", async () => {
      const fix = createTestFixture("mind-admit-flow");

      // Candidate setup
      transact(fix.run, "owner", "setup-candidates", {}, (state) => {
        state.pulse = {
          open: {
            pulse_id: "pulse-1",
            opened_at: new Date().toISOString(),
            deadline_at: new Date(Date.now() + 100000).toISOString(),
          },
        } as any;
        state.candidates = [
          {
            id: "cand-open",
            kind: "proposal",
            statement: "Open proposal",
            status: "open",
            charter_goal_ids: ["G1"],
            write_scope: ["src"],
            falsifier_argv: null,
            falsifier_exit: null,
            witness_command_id: null,
            created_at: new Date().toISOString(),
          },
          {
            id: "cand-admitted",
            kind: "proposal",
            statement: "Admitted proposal",
            status: "admitted",
            charter_goal_ids: ["G1"],
            write_scope: ["src"],
            falsifier_argv: null,
            falsifier_exit: null,
            witness_command_id: null,
            created_at: new Date().toISOString(),
          },
          {
            id: "cand-declined",
            kind: "proposal",
            statement: "Declined proposal",
            status: "declined",
            decline_reason: "out of scope",
            charter_goal_ids: ["G1"],
            write_scope: ["src"],
            falsifier_argv: null,
            falsifier_exit: null,
            witness_command_id: null,
            created_at: new Date().toISOString(),
          },
        ] as any;
      });

      // Role check: orch-1 has role orchestrator (not mind/coordinator)
      expect(() =>
        mindAdmitCommand({
          run: fix.run,
          actor: "orch-1",
          candidate: "cand-open",
        }),
      ).toThrow(HarnessError);

      // Mind halted
      transact(fix.run, "owner", "halt-mind", {}, (state) => {
        state.mind = { halted: true, halt_reason: "drift" } as any;
      });
      expect(() =>
        mindAdmitCommand({
          run: fix.run,
          actor: "mind-1",
          candidate: "cand-open",
        }),
      ).toThrow(HarnessError);

      // Unhalt
      transact(fix.run, "owner", "unhalt-mind", {}, (state) => {
        state.mind = {
          halted: false,
          charter: {
            goals: [{ id: "G1" }, "G2"],
            non_goals: ["NG1"],
            repo_roots: ["."],
          },
        } as any;
      });

      // Unknown candidate
      expect(() =>
        mindAdmitCommand({
          run: fix.run,
          actor: "mind-1",
          candidate: "cand-unknown",
        }),
      ).toThrow(HarnessError);

      // Already admitted candidate
      expect(() =>
        mindAdmitCommand({
          run: fix.run,
          actor: "mind-1",
          candidate: "cand-admitted",
        }),
      ).toThrow(HarnessError);

      // Permanently declined candidate
      expect(() =>
        mindAdmitCommand({
          run: fix.run,
          actor: "mind-1",
          candidate: "cand-declined",
        }),
      ).toThrow(HarnessError);

      // Candidate decline command edge cases
      await expect(
        mindDeclineCommand({
          run: fix.run,
          actor: "mind-1",
          candidate: "nonexistent-cand",
          reason: "not needed",
        }),
      ).rejects.toThrow(HarnessError);

      await expect(
        mindDeclineCommand({
          run: fix.run,
          actor: "mind-1",
          candidate: "cand-declined",
          reason: "already decided",
        }),
      ).rejects.toThrow(HarnessError);

      const declRes = await mindDeclineCommand({
        run: fix.run,
        actor: "mind-1",
        candidate: "cand-open",
        reason: "superseded",
      });
      expect(declRes.candidate_id).toBe("cand-open");
    });
  });

  describe("mindCandidateCommand", () => {
    it("handles invalid kind, defect falsifier fallbacks, and ID collision resolution", () => {
      const fix = createTestFixture("mind-candidate-flow");

      // Invalid kind
      expect(() =>
        mindCandidateCommand({
          run: fix.run,
          actor: "mind-1",
          kind: "invalid-kind",
          statement: "Some statement",
          "charter-goal": ["G1"],
          "write-scope": ["src"],
        }),
      ).toThrow(HarnessError);

      // Open a candidate to occupy cand-1
      const res1 = mindCandidateCommand({
        run: fix.run,
        actor: "mind-1",
        kind: "proposal",
        statement: "Proposal 1",
        "charter-goal": ["G1"],
        "write-scope": ["src"],
      });
      expect(res1.candidate_id).toBe("cand-1");

      // Next candidate gets cand-2
      const res2 = mindCandidateCommand({
        run: fix.run,
        actor: "mind-1",
        kind: "proposal",
        statement: "Proposal 2",
        "charter-goal": ["G1"],
        "write-scope": ["src"],
      });
      expect(res2.candidate_id).toBe("cand-2");
    });
  });

  describe("mindObserveCommand", () => {
    it("validates command ID, count bounds, and now timestamp", () => {
      const fix = createTestFixture("mind-observe-val");

      // Missing command id
      expect(() =>
        mindObserveCommand({
          run: fix.run,
          actor: "mind-1",
          source: "defects_ledger",
          count: 0,
        }),
      ).toThrow(HarnessError);

      // Invalid count (negative)
      expect(() =>
        mindObserveCommand({
          run: fix.run,
          actor: "mind-1",
          source: "defects_ledger",
          "command-id": "cmd-1",
          count: -5,
        }),
      ).toThrow(HarnessError);

      // Invalid now
      expect(() =>
        mindObserveCommand({
          run: fix.run,
          actor: "mind-1",
          source: "defects_ledger",
          "command-id": "cmd-1",
          count: 0,
          now: "invalid-now",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("mindPulseMetrics and mindPulseFormatter", () => {
    it("computes cognitive telemetry with compiled tasks, leases, parent task fallbacks, and wave formatting", () => {
      const fix = createTestFixture("pulse-metrics");

      const testState = {
        graph: { nodes: [] },
        tasks: {
          "task-1": {
            id: "task-1",
            status: "leased",
            effort: 2,
            dependencies: [],
            lease: { agent_id: "agent-alpha", role: "implementer" },
          },
          "task-2": {
            id: "task-2",
            status: "validating",
            effort: 1,
            dependencies: ["task-1"],
            lease: { agent: "agent-beta" },
          },
          "task-3": {
            id: "task-3",
            status: "proposed",
            effort: 3,
            dependencies: ["task-2", "task-3"], // cyclic dependency
          },
        },
        agents: [
          { id: "agent-alpha", role: "implementer", host: "local", status: "active" },
          { id: "agent-beta", role: "validator", host: "local", status: "active" },
          { id: "agent-gamma", role: "coordinator", parent_task_id: "task-1", status: "active" },
        ],
      } as any;

      const telem = computeMindCognitiveTelemetry(testState);
      expect(telem.workSpan.total_work).toBe(6);
      expect(telem.activeAgents.length).toBe(3);

      const briefActive = formatMindPulseActiveBrief({
        pulseId: "pulse-1",
        runRoot: fix.run,
        actor: "mind-1",
        host: "local",
        driver: "test",
        openedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 100000).toISOString(),
        scheduledIntervalMs: 900000,
        nextWakeAt: new Date(Date.now() + 900000).toISOString(),
        pulsesToday: 1,
        pulsesPerDay: 100,
        workSpan: telem.workSpan,
        activeAgents: telem.activeAgents,
        dagBadges: ["[DAG: W1:L1]"],
        waveLanes: [
          { wave: 1, lane_count: 1, status: "active", is_active: true },
          { wave: 2, lane_count: 2, status: "pending", is_active: false },
        ],
        activeRuns: 1,
        pendingBacklog: 2,
      });
      expect(briefActive).toContain("Work/Span Concurrency");
      expect(briefActive).toContain("ASCII DAG Badges");
      expect(briefActive).toContain("Wave Lanes");

      const briefOpened = formatMindPulseOpenedBrief({
        pulseId: "pulse-1",
        runRoot: fix.run,
        actor: "mind-1",
        host: "local",
        driver: "test",
        openedAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 100000).toISOString(),
        scheduledIntervalMs: 900000,
        nextWakeAt: new Date(Date.now() + 900000).toISOString(),
        pulsesToday: 1,
        pulsesPerDay: 100,
        workSpan: telem.workSpan,
        activeAgents: telem.activeAgents,
        dagBadges: ["[DAG: W1:L1]"],
        waveLanes: [
          { wave: 1, lane_count: 1, status: "active", is_active: true },
          { wave: 2, lane_count: 2, status: "pending", is_active: false },
        ],
      });
      expect(briefOpened).toContain("Work/Span Concurrency");
      expect(briefOpened).toContain("Wave Lanes");
    });
  });

  describe("mindQuiesceCommand", () => {
    it("validates empty source list, invalid now, and actor grants", async () => {
      const fix = createTestFixture("quiesce-val");

      // Empty source
      await expect(
        mindQuiesceCommand({
          run: fix.run,
          actor: "mind-1",
          source: [],
        }),
      ).rejects.toThrow(HarnessError);

      // Invalid now
      await expect(
        mindQuiesceCommand({
          run: fix.run,
          actor: "mind-1",
          source: ["s1:c1:0"],
          now: "invalid-now",
        }),
      ).rejects.toThrow(HarnessError);

      // Unknown actor
      await expect(
        mindQuiesceCommand({
          run: fix.run,
          actor: "unknown-actor-abc",
          source: ["s1:c1:0"],
        }),
      ).rejects.toThrow(HarnessError);

      // Non-mind role
      await expect(
        mindQuiesceCommand({
          run: fix.run,
          actor: "worker-1",
          source: ["s1:c1:0"],
        }),
      ).rejects.toThrow(HarnessError);
    });
  });

  describe("mindInitCommand", () => {
    it("validates repo existence, charter flag, and invalid UTF-8", () => {
      // Nonexistent repo directory
      expect(() =>
        mindInitCommand({
          repo: "/path/that/does/not/exist/at/all",
          charter: "charter.md",
        }),
      ).toThrow(HarnessError);

      const fix = createTestFixture("init-val");

      // Missing charter flag
      expect(() =>
        mindInitCommand({
          repo: fix.repo,
        }),
      ).toThrow(HarnessError);

      // Invalid UTF-8 bytes in charter
      const badCharter = join(fix.repo, "bad-charter.md");
      writeFileSync(badCharter, Uint8Array.from([0xff, 0xfe, 0x80, 0xbf]));
      expect(() =>
        mindInitCommand({
          repo: fix.repo,
          charter: badCharter,
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("mindWakeCommand", () => {
    it("validates invalid now timestamp", async () => {
      const fix = createTestFixture("wake-val");
      await expect(
        mindWakeCommand({
          run: fix.run,
          now: "invalid-now-date",
        }),
      ).rejects.toThrow(HarnessError);
    });
  });
});
