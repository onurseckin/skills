import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  buildEscalationDigest,
  extractRunSignals,
  formatEscalationDigestMarkdown,
  type DigestDeclinedCandidate,
  type DigestEscalation,
  type DigestFailingGate,
  type DigestFinding,
  type DigestOpenProposal,
} from "../../olt/scripts/src/mind/memory/digest/index.ts";
import { executeRepairLane } from "../../olt/scripts/src/mind/lanes/repair.ts";
import { initRun } from "../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../olt/scripts/src/engine/store/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Escalation Digest and REPAIR Lane", () => {
  describe("Golden-file comparison", () => {
    test("formats complete escalation digest matching expected golden output", () => {
      const fixedTimestamp = "2026-08-21T12:00:00.000Z";

      const findings: DigestFinding[] = [
        {
          findingId: "finding-T01-1",
          taskId: "T01",
          runId: "run-alpha",
          severity: "critical",
          observation: "Memory leak in event stream handler",
          remediation: "Add explicit stream disposal in afterEach hook",
          revalidationGate: "bun test tests/unit/stream.test.ts",
          commandSource: "cmd-rev-101",
        },
        {
          findingId: "finding-T02-2",
          taskId: "T02",
          runId: "run-alpha",
          severity: "minor",
          observation: "Unformatted json output on stdout",
          remediation: "Use formatJson helper",
          commandSource: "cmd-rev-102",
        },
      ];

      const failingGates: DigestFailingGate[] = [
        {
          gateId: "gate-unit-tests",
          taskId: "T01",
          runId: "run-alpha",
          command: ["bun", "test", "tests/unit/core.test.ts"],
          exitCode: 1,
          failureSnippet: "Expected 200 OK but received 500 Internal Server Error",
          commandSource: "cmd-exec-201",
        },
      ];

      const escalations: DigestEscalation[] = [
        {
          escalationId: "esc-db-drift",
          taskId: "T03",
          runId: "run-alpha",
          reason: "Database migration table schema altered outside declared write scope",
          evidence: "Migration SHA mismatch between git head and prisma index",
          escalatedAt: "2026-08-21T11:45:00.000Z",
          commandSource: "cmd-exec-301",
        },
      ];

      const declinedCandidates: DigestDeclinedCandidate[] = [
        {
          candidateId: "cand-refactor-logging",
          statement: "Refactor all logger instances to structured pino logs",
          declineReason: "No witness command output shows a logger defect (violates gate 1)",
          charterGoalId: "G1",
          witnessCommandId: "cmd-probe-401",
        },
        {
          candidateId: "cand-upgrade-deps",
          statement: "Upgrade third party network library to latest major version",
          declineReason: "Outside declared repo roots and non-goal in charter",
          charterGoalId: "G2",
        },
      ];

      const openProposals: DigestOpenProposal[] = [
        {
          proposalId: "prop-add-caching",
          statement: "Introduce Redis cache for frequently read workflow states",
          rationale: "Reduces round-trip disk reads on high-throughput supervision pulses",
          charterGoalId: "G3",
          requirementId: "req-caching-01",
          commandSource: "cmd-prop-501",
        },
      ];

      const digest = buildEscalationDigest({
        runId: "run-alpha",
        now: fixedTimestamp,
        openFindings: findings,
        failingGates,
        escalations,
        declinedCandidates,
        openProposals,
      });

      const formatted = formatEscalationDigestMarkdown(digest);

      const expectedGolden = [
        "### Escalation Digest: `run-alpha`",
        "- **Generated**: 2026-08-21T12:00:00.000Z",
        "- **Open findings**: 2",
        "  - `[finding-T01-1]` [critical] (task `T01`): Memory leak in event stream handler — Remediation: Add explicit stream disposal in afterEach hook — Revalidation: `bun test tests/unit/stream.test.ts` (source: `cmd-rev-101`)",
        "  - `[finding-T02-2]` [minor] (task `T02`): Unformatted json output on stdout — Remediation: Use formatJson helper (source: `cmd-rev-102`)",
        "- **Failing gates**: 1",
        "  - `gate-unit-tests` (task `T01`): `bun test tests/unit/core.test.ts` (exit code 1) — Expected 200 OK but received 500 Internal Server Error (source: `cmd-exec-201`)",
        "- **Escalations (needs human decision)**: 1",
        "  - `esc-db-drift` (task `T03`): Database migration table schema altered outside declared write scope — Migration SHA mismatch between git head and prisma index (source: `cmd-exec-301`)",
        "",
        "## What I would have done without asking",
        "",
        "- **Declined candidates**: 2",
        '  - `cand-refactor-logging`: "Refactor all logger instances to structured pino logs" — Reason: No witness command output shows a logger defect (violates gate 1) (goal: `G1`, witness: `cmd-probe-401`)',
        '  - `cand-upgrade-deps`: "Upgrade third party network library to latest major version" — Reason: Outside declared repo roots and non-goal in charter (goal: `G2`)',
        "- **Open proposals (needs authority decision)**: 1",
        '  - `prop-add-caching`: "Introduce Redis cache for frequently read workflow states" — Rationale: Reduces round-trip disk reads on high-throughput supervision pulses (goal: `G3`, requirement: `req-caching-01`, source: `cmd-prop-501`)',
      ].join("\n");

      expect(formatted).toBe(expectedGolden);
      expect(digest.totalSignalsCount).toBe(7);
    });
  });

  describe("Command source citation", () => {
    test("properly cites command IDs across findings, gates, escalations, candidates, and proposals", () => {
      const digest = buildEscalationDigest({
        runId: "run-citation-check",
        now: "2026-08-21T12:00:00.000Z",
        openFindings: [
          {
            findingId: "f-1",
            observation: "Missing validation",
            commandSource: "cmd-cit-01",
          },
        ],
        failingGates: [
          {
            gateId: "g-1",
            command: "bun test",
            exitCode: 2,
            commandSource: "cmd-cit-02",
          },
        ],
        escalations: [
          {
            escalationId: "e-1",
            reason: "Deadlock",
            commandSource: "cmd-cit-03",
          },
        ],
        declinedCandidates: [
          {
            candidateId: "c-1",
            statement: "Optimize DB queries",
            declineReason: "Fails gate 1",
            witnessCommandId: "cmd-cit-04",
          },
        ],
        openProposals: [
          {
            proposalId: "p-1",
            statement: "Add gRPC endpoint",
            rationale: "Microservice integration",
            commandSource: "cmd-cit-05",
          },
        ],
      });

      const markdown = formatEscalationDigestMarkdown(digest);

      expect(markdown).toContain("(source: `cmd-cit-01`)");
      expect(markdown).toContain("(source: `cmd-cit-02`)");
      expect(markdown).toContain("(source: `cmd-cit-03`)");
      expect(markdown).toContain("witness: `cmd-cit-04`");
      expect(markdown).toContain("source: `cmd-cit-05`");
    });

    test("handles missing command sources gracefully without undefined artifacts", () => {
      const digest = buildEscalationDigest({
        runId: "run-no-citations",
        now: "2026-08-21T12:00:00.000Z",
        openFindings: [
          {
            findingId: "f-no-src",
            observation: "Simple finding without citation",
          },
        ],
        failingGates: [
          {
            gateId: "g-no-src",
            command: ["npm", "run", "lint"],
            exitCode: 1,
          },
        ],
        escalations: [
          {
            escalationId: "e-no-src",
            reason: "Simple escalation",
          },
        ],
        declinedCandidates: [
          {
            candidateId: "c-no-src",
            statement: "Add dark mode",
            declineReason: "Non-goal",
          },
        ],
        openProposals: [
          {
            proposalId: "p-no-src",
            statement: "Add analytics",
            rationale: "Usage tracking",
          },
        ],
      });

      const markdown = formatEscalationDigestMarkdown(digest);

      expect(markdown).not.toContain("undefined");
      expect(markdown).not.toContain("null");
      expect(markdown).not.toContain("(source: `undefined`)");
      expect(markdown).toContain("- `[f-no-src]`: Simple finding without citation");
      expect(markdown).toContain("- `g-no-src`: `npm run lint` (exit code 1)");
      expect(markdown).toContain("- `e-no-src`: Simple escalation");
      expect(markdown).toContain('- `c-no-src`: "Add dark mode" — Reason: Non-goal');
      expect(markdown).toContain('- `p-no-src`: "Add analytics" — Rationale: Usage tracking');
    });
  });

  describe("Empty repository formatting", () => {
    test("formats cleanly with zero counts, explicit none items, and mandatory proposal section", () => {
      const digest = buildEscalationDigest({
        runId: "clean-run",
        now: "2026-08-21T12:00:00.000Z",
      });

      expect(digest.openFindings).toHaveLength(0);
      expect(digest.failingGates).toHaveLength(0);
      expect(digest.escalations).toHaveLength(0);
      expect(digest.declinedCandidates).toHaveLength(0);
      expect(digest.openProposals).toHaveLength(0);
      expect(digest.totalSignalsCount).toBe(0);

      const markdown = formatEscalationDigestMarkdown(digest);

      const expectedEmpty = [
        "### Escalation Digest: `clean-run`",
        "- **Generated**: 2026-08-21T12:00:00.000Z",
        "- **Open findings**: 0",
        "  - none",
        "- **Failing gates**: 0",
        "  - none",
        "- **Escalations (needs human decision)**: 0",
        "  - none",
        "",
        "## What I would have done without asking",
        "",
        "- **Declined candidates**: 0",
        "  - none",
        "- **Open proposals (needs authority decision)**: 0",
        "  - none",
      ].join("\n");

      expect(markdown).toBe(expectedEmpty);
    });
  });

  describe("Candidate triage and signal extraction", () => {
    test("extracts and triages declined candidates, open proposals, and admitted candidates from state", () => {
      const mockState: Record<string, unknown> = {
        mind: {
          candidates: [
            {
              id: "cand-01",
              statement: "Admitted bugfix for auth session",
              status: "admitted",
              charter_goal: "G1",
              witness: { command_id: "cmd-w-01" },
            },
            {
              id: "cand-02",
              statement: "Declined refactor of CSS modules",
              status: "declined",
              decline_reason: "Cosmetic change not matching any stability requirement",
              charter_goal: "G2",
              witness: { command_id: "cmd-w-02" },
              declined_at: "2026-08-21T10:00:00.000Z",
            },
            {
              id: "cand-03",
              statement: "Proposed telemetry pipeline upgrade",
              kind: "proposal",
              status: "proposed",
              rationale: "Enables observability for long background tasks",
              charter_goal: "G3",
              requirement_id: "req-telemetry",
              created_at: "2026-08-21T10:30:00.000Z",
            },
          ],
        },
        requirements: [
          {
            id: "req-auth-scope",
            disposition: "needs_authority",
            instruction: "Add OAuth2 provider integration",
            rationale: "Requires external client credentials approval from owner",
            charter_goal: "G4",
            command_id: "cmd-auth-plan",
          },
          {
            id: "req-standard",
            disposition: "actionable",
            instruction: "Standard actionable requirement",
          },
        ],
        tasks: {
          "task-1": {
            id: "task-1",
            status: "changes_requested",
            open_finding_ids: ["finding-101"],
            findings: [
              {
                id: "finding-101",
                observation: "Failed invariant check on queue length",
                remediation: "Add boundary clamp",
                severity: "important",
                command_id: "cmd-review-1",
              },
            ],
          },
          "task-2": {
            id: "task-2",
            status: "escalated",
            escalation_reason: "Max retry limit reached on flake test",
            escalation_evidence: "3 consecutive timeouts on network socket",
            last_command_id: "cmd-task-2-run",
          },
        },
        gates: {
          "gate-1": {
            id: "gate-1",
            task_id: "task-1",
            command: ["bun", "test", "tests/unit/queue.test.ts"],
            status: "failed",
            exit_code: 1,
            failure_output: "AssertionError: expected 5 to be 4",
            command_id: "cmd-gate-exec-1",
          },
        },
      };

      const extracted = extractRunSignals(mockState, "test-run");

      // Check findings
      expect(extracted.findings).toHaveLength(1);
      expect(extracted.findings[0].findingId).toBe("finding-101");
      expect(extracted.findings[0].observation).toBe("Failed invariant check on queue length");
      expect(extracted.findings[0].commandSource).toBe("cmd-review-1");

      // Check gates
      expect(extracted.gates).toHaveLength(1);
      expect(extracted.gates[0].gateId).toBe("gate-1");
      expect(extracted.gates[0].exitCode).toBe(1);
      expect(extracted.gates[0].commandSource).toBe("cmd-gate-exec-1");

      // Check escalations
      expect(extracted.escalations).toHaveLength(1);
      expect(extracted.escalations[0].escalationId).toBe("esc-task-2");
      expect(extracted.escalations[0].reason).toBe("Max retry limit reached on flake test");
      expect(extracted.escalations[0].commandSource).toBe("cmd-task-2-run");

      // Check candidate triage: Admitted candidate is NOT in declined or open proposals
      expect(extracted.declinedCandidates).toHaveLength(1);
      expect(extracted.declinedCandidates[0].candidateId).toBe("cand-02");
      expect(extracted.declinedCandidates[0].declineReason).toContain("Cosmetic change");
      expect(extracted.declinedCandidates[0].witnessCommandId).toBe("cmd-w-02");

      // Check proposals (both mind candidate proposal and needs_authority requirement)
      expect(extracted.openProposals).toHaveLength(2);
      const prop1 = extracted.openProposals.find((p) => p.proposalId === "cand-03");
      const prop2 = extracted.openProposals.find((p) => p.proposalId === "req-auth-scope");
      expect(prop1).toBeDefined();
      expect(prop1!.rationale).toBe("Enables observability for long background tasks");
      expect(prop2).toBeDefined();
      expect(prop2!.statement).toBe("Add OAuth2 provider integration");
      expect(prop2!.commandSource).toBe("cmd-auth-plan");
    });
  });

  describe("executeRepairLane", () => {
    test("triages live runs in scratch capsules directory without dispatching work", async () => {
      const repo = scratchRoot(import.meta.path, "repair-lane-live-runs");
      const charterBytes = Buffer.from("# Charter\n## goals\n- G1: Stability\n");

      // 1. Initialize Mind Capsule
      const mindRunRoot = initRun(repo, "mind-run-01", charterBytes, "file", true);

      // Add a proposal and a declined candidate to mind capsule
      transact(mindRunRoot, "mind-agent", "seed-mind-candidates", {}, (working) => {
        const workingMind = (working.mind ?? {}) as Record<string, unknown>;
        workingMind.candidates = [
          {
            id: "cand-declined-1",
            statement: "Rewrite in Rust",
            status: "declined",
            decline_reason: "Violates architecture contract",
            charter_goal: "G1",
            witness_command_id: "cmd-wit-001",
          },
        ];
        working.mind = workingMind;
        working.requirements = [
          {
            id: "req-needs-auth-1",
            disposition: "needs_authority",
            instruction: "Integrate third-party payment gateway",
            rationale: "Requires executive financial authority",
            charter_goal: "G1",
          },
        ];
      });

      // 2. Initialize a worker run with a failing gate and open finding
      const workerRunRoot = initRun(repo, "run-worker-01", charterBytes, "file", true);
      transact(workerRunRoot, "worker-agent", "seed-worker-failure", {}, (working) => {
        working.tasks = {
          "task-1": {
            id: "task-1",
            status: "changes_requested",
            open_finding_ids: ["finding-w1"],
            findings: [
              {
                id: "finding-w1",
                observation: "Null pointer in config parser",
                remediation: "Check for undefined before accessing property",
                severity: "critical",
                command_id: "cmd-test-fail-1",
              },
            ],
          },
        };
        working.gates = {
          "gate-worker-unit": {
            id: "gate-worker-unit",
            task_id: "task-1",
            command: ["bun", "test", "tests/unit/worker.test.ts"],
            status: "failed",
            exit_code: 1,
            failure_snippet: "TypeError: Cannot read properties of undefined",
            command_id: "cmd-gate-fail-1",
          },
        };
      });

      // 3. Execute REPAIR lane
      const result = await executeRepairLane({
        runRoot: mindRunRoot,
        now: "2026-08-21T12:00:00.000Z",
        writeReport: true,
      });

      // Assert result properties
      expect(result.hasSignals).toBe(true);
      expect(result.triageCounts.openFindings).toBe(1);
      expect(result.triageCounts.failingGates).toBe(1);
      expect(result.triageCounts.declinedCandidates).toBe(1);
      expect(result.triageCounts.openProposals).toBe(1);
      expect(result.triageCounts.totalSignals).toBe(4);
      expect(result.inspectedRuns).toContain("run-worker-01");
      expect(result.inspectedRuns).toContain("mind-run-01");

      // Verify report was written to reports/escalation-digest.md
      expect(result.reportPath).toBeDefined();
      expect(existsSync(result.reportPath!)).toBe(true);
      const writtenReport = readFileSync(result.reportPath!, "utf-8");
      expect(writtenReport).toBe(result.markdown);

      // Verify markdown content
      expect(result.markdown).toContain("### Escalation Digest: `mind-run-01`");
      expect(result.markdown).toContain(
        "- `[finding-w1]` [critical] (task `task-1`): Null pointer in config parser",
      );
      expect(result.markdown).toContain(
        "- `gate-worker-unit` (task `task-1`): `bun test tests/unit/worker.test.ts` (exit code 1)",
      );
      expect(result.markdown).toContain("## What I would have done without asking");
      expect(result.markdown).toContain(
        '- `cand-declined-1`: "Rewrite in Rust" — Reason: Violates architecture contract (goal: `G1`, witness: `cmd-wit-001`)',
      );
      expect(result.markdown).toContain(
        '- `req-needs-auth-1`: "Integrate third-party payment gateway" — Rationale: Requires executive financial authority (goal: `G1`, requirement: `req-needs-auth-1`)',
      );
    });

    test("returns hasSignals=false on clean empty repository", async () => {
      const repo = scratchRoot(import.meta.path, "repair-lane-clean");
      const charterBytes = Buffer.from("# Charter\n## goals\n- G1: Stability\n");
      const mindRunRoot = initRun(repo, "mind-clean", charterBytes, "file", true);

      const result = await executeRepairLane({
        runRoot: mindRunRoot,
        now: "2026-08-21T12:00:00.000Z",
        writeReport: true,
      });

      expect(result.hasSignals).toBe(false);
      expect(result.triageCounts.totalSignals).toBe(0);
      expect(result.markdown).toContain("- **Open findings**: 0");
      expect(result.markdown).toContain("- **Failing gates**: 0");
      expect(result.markdown).toContain("- **Escalations (needs human decision)**: 0");
      expect(result.markdown).toContain("## What I would have done without asking");
      expect(result.markdown).toContain("- **Declined candidates**: 0");
      expect(result.markdown).toContain("- **Open proposals (needs authority decision)**: 0");
    });
  });
});
