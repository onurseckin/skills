import { describe, expect, test } from "bun:test";
import {
  buildEscalationDigest,
  buildOwnerDigest,
  extractRunSignals,
  formatEscalationDigestMarkdown,
  formatOwnerDigestMarkdown,
  type DigestDeclinedCandidate,
  type DigestEscalation,
  type DigestFailingGate,
  type DigestFinding,
  type DigestOpenProposal,
  type EscalationDigestData,
} from "../../../olt/scripts/src/mind/memory/digest/index.ts";
import { generateTrailingValueSeries } from "../../../olt/scripts/src/mind/lifecycle/interval/index.ts";

describe("mind/digest.ts - Owner Digest and Escalation Digest", () => {
  const FIXED_NOW = new Date("2026-08-21T12:00:00.000Z");

  test("empty digest renders explicit 'No unasked actions or proposals in this period.' text and raw series", () => {
    const digest = buildOwnerDigest({
      runId: "mind-empty-run",
      now: FIXED_NOW,
      trailingValueSeries: [],
    });

    expect(digest.openFindings).toHaveLength(0);
    expect(digest.failingGates).toHaveLength(0);
    expect(digest.escalations).toHaveLength(0);
    expect(digest.declinedCandidates).toHaveLength(0);
    expect(digest.openProposals).toHaveLength(0);
    expect(digest.totalSignalsCount).toBe(0);
    expect(digest.trailingValueSeries.rawValues).toEqual([]);
    expect(digest.trailingValueSeries.formattedSeries).toBe("[]");

    const markdown = formatOwnerDigestMarkdown(digest);

    // Section presence
    expect(markdown).toContain("## What I would have done without asking");
    // Explicit empty message
    expect(markdown).toContain("No unasked actions or proposals in this period.");
    // Trailing value series section presence
    expect(markdown).toContain("## Trailing value series");
    expect(markdown).toContain("- **Raw series**: `[]`");
    expect(markdown).toContain("- **Total value**: 0");
    expect(markdown).toContain("- **Trailing zero streak**: 0");

    // Golden file check
    const expected = [
      "### Owner Digest: `mind-empty-run`",
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
      "No unasked actions or proposals in this period.",
      "",
      "## Trailing value series",
      "",
      "- **Raw series**: `[]`",
      "- **Total value**: 0",
      "- **Trailing zero streak**: 0",
    ].join("\n");

    expect(markdown).toBe(expected);
  });

  test("renders 'What I would have done without asking' with declined candidates and open proposals citing command IDs and event indexes", () => {
    const declinedCandidates: readonly DigestDeclinedCandidate[] = [
      {
        candidateId: "cand-optimize-db",
        statement: "Add composite index on pulse_ledger(run_id, sequence)",
        rationale: "Speeds up pulse lookups",
        declineReason: "Refused by Gate 2 (Charter non-goal: no speculative index optimizations)",
        charterGoalId: "goal-stability",
        witnessCommandId: "C-wit-cand-01",
        commandSource: "C-wit-cand-01",
        eventIndex: 104,
      },
    ];

    const openProposals: readonly DigestOpenProposal[] = [
      {
        proposalId: "prop-new-backup-lane",
        statement: "Introduce automated cold-storage snapshot lane",
        rationale: "Requires external AWS credentials and recurring cost approval",
        charterGoalId: "goal-durability",
        requirementId: "req-cold-storage",
        commandSource: "C-prop-cmd-02",
        eventIndex: 112,
      },
    ];

    const digest = buildEscalationDigest({
      runId: "mind-unasked-run",
      now: FIXED_NOW,
      declinedCandidates,
      openProposals,
      trailingValueSeries: [1, 0, 2, 0, 3],
    });

    expect(digest.declinedCandidates).toHaveLength(1);
    expect(digest.openProposals).toHaveLength(1);
    expect(digest.totalSignalsCount).toBe(2);

    const markdown = formatEscalationDigestMarkdown(digest);

    // Verify section presence
    expect(markdown).toContain("## What I would have done without asking");
    expect(markdown).not.toContain("No unasked actions or proposals in this period.");

    // Verify declined candidate line with citations
    expect(markdown).toContain(
      '`cand-optimize-db`: "Add composite index on pulse_ledger(run_id, sequence)" — Reason: Refused by Gate 2 (Charter non-goal: no speculative index optimizations) (goal: `goal-stability`, witness: `C-wit-cand-01`, event: #104)',
    );

    // Verify open proposal line with citations
    expect(markdown).toContain(
      '`prop-new-backup-lane`: "Introduce automated cold-storage snapshot lane" — Rationale: Requires external AWS credentials and recurring cost approval (goal: `goal-durability`, requirement: `req-cold-storage`, source: `C-prop-cmd-02`, event: #112)',
    );

    // Verify trailing value series
    expect(markdown).toContain("- **Raw series**: `[1, 0, 2, 0, 3]`");
    expect(markdown).toContain("- **Total value**: 6");
    expect(markdown).toContain("- **Trailing zero streak**: 0");
  });

  test("renders raw unmasked trailing value series and flags long flat zero series with warning", () => {
    const rawZeros = [0, 0, 0, 0, 0, 0];
    const digest = buildOwnerDigest({
      runId: "mind-flat-zero-run",
      now: FIXED_NOW,
      trailingValueSeries: rawZeros,
    });

    expect(digest.trailingValueSeries.rawValues).toEqual([0, 0, 0, 0, 0, 0]);
    expect(digest.trailingValueSeries.isFlatZero).toBe(true);
    expect(digest.trailingValueSeries.trailingZeroStreak).toBe(6);

    const markdown = formatOwnerDigestMarkdown(digest);

    expect(markdown).toContain("## Trailing value series");
    expect(markdown).toContain("- **Raw series**: `[0, 0, 0, 0, 0, 0]`");
    expect(markdown).toContain("- **Total value**: 0");
    expect(markdown).toContain("- **Trailing zero streak**: 6");
    expect(markdown).toContain(
      "> ⚠️ **Flat Zero Series**: All 6 recent pulses produced 0 value. A long flat zero is either a healthy repository or a broken mind, and only a human can tell which.",
    );
  });

  test("renders full digest with findings, failing gates, escalations, each carrying command ID citations", () => {
    const openFindings: readonly DigestFinding[] = [
      {
        findingId: "find-deadlock-risk",
        taskId: "T-P5-W02",
        runId: "mind-full-run",
        severity: "critical",
        observation: "Concurrent lease acquisition creates lock order cycle",
        remediation: "Enforce strict alphabetical lock acquisition order",
        revalidationGate: "gate-lease-concurrency",
        commandSource: "C-audit-find-01",
        eventIndex: 201,
      },
    ];

    const failingGates: readonly DigestFailingGate[] = [
      {
        gateId: "gate-unit-tests",
        taskId: "T-P5-W01",
        runId: "mind-full-run",
        command: ["bun", "test", "tests/unit/mind/budget.test.ts"],
        exitCode: 1,
        failureSnippet: "1 test failed in tests/unit/mind/budget.test.ts",
        commandSource: "C-gate-exec-02",
        eventIndex: 205,
      },
    ];

    const escalations: readonly DigestEscalation[] = [
      {
        escalationId: "esc-quota-exceeded",
        taskId: "T-P5-W03",
        runId: "mind-full-run",
        reason: "Daily pulse ceiling of 50 pulses reached",
        evidence: "state.budget.pulses_today == 50",
        commandSource: "C-pulse-open-03",
        eventIndex: 210,
      },
    ];

    const digest = buildOwnerDigest({
      runId: "mind-full-run",
      now: FIXED_NOW,
      openFindings,
      failingGates,
      escalations,
      trailingValueSeries: [0, 1, 0, 0, 4],
    });

    const markdown = formatOwnerDigestMarkdown(digest);

    // Finding citation
    expect(markdown).toContain(
      "- `[find-deadlock-risk]` [critical] (task `T-P5-W02`): Concurrent lease acquisition creates lock order cycle — Remediation: Enforce strict alphabetical lock acquisition order — Revalidation: `gate-lease-concurrency` (source: `C-audit-find-01`, event: #201)",
    );

    // Gate citation
    expect(markdown).toContain(
      "- `gate-unit-tests` (task `T-P5-W01`): `bun test tests/unit/mind/budget.test.ts` (exit code 1) — 1 test failed in tests/unit/mind/budget.test.ts (source: `C-gate-exec-02`, event: #205)",
    );

    // Escalation citation
    expect(markdown).toContain(
      "- `esc-quota-exceeded` (task `T-P5-W03`): Daily pulse ceiling of 50 pulses reached — state.budget.pulses_today == 50 (source: `C-pulse-open-03`, event: #210)",
    );

    // Trailing value series
    expect(markdown).toContain("- **Raw series**: `[0, 1, 0, 0, 4]`");
    expect(markdown).toContain("- **Total value**: 5");
    expect(markdown).toContain("- **Trailing zero streak**: 0");
  });

  test("extracts signals and value series from state object correctly", () => {
    const mockState: Record<string, unknown> = {
      escalations: [
        {
          id: "esc-1",
          task_id: "T-1",
          reason: "Out of memory in subagent container",
          evidence: "exit code 137",
          command_id: "C-esc-cmd-1",
          event_sequence: 55,
        },
      ],
      tasks: {
        "T-2": {
          status: "changes_requested",
          reason: "Missing unit test coverage for edge case",
          last_command_id: "C-rev-cmd-2",
          event_sequence: 60,
        },
      },
      gates: [
        {
          id: "gate-lint",
          task_id: "T-2",
          command: "bun run lint",
          exit_code: 2,
          failure_snippet: "3 lint errors found",
          command_id: "C-gate-cmd-3",
          event_sequence: 65,
        },
      ],
      candidates: [
        {
          id: "cand-unsafe-refactor",
          statement: "Remove legacy validation module",
          status: "declined",
          decline_reason: "Violates safety invariants",
          charter_goal: "goal-safety",
          witness: { command_id: "C-wit-cmd-4" },
          event_sequence: 70,
        },
        {
          id: "prop-new-tool",
          statement: "Add sqlite export CLI command",
          kind: "proposal",
          rationale: "Requires human review of schema additions",
          charter_goal: "goal-usability",
          command_id: "C-prop-cmd-5",
          event_sequence: 75,
        },
      ],
      pulse: {
        history: [
          { pulse_id: "pulse-1", outcome: "quiescent", value: 0 },
          { pulse_id: "pulse-2", outcome: "advance", value: 3 },
          { pulse_id: "pulse-3", outcome: "quiescent", value: 0 },
        ],
      },
    };

    const signals = extractRunSignals(mockState, "test-run");

    expect(signals.escalations).toHaveLength(1);
    expect(signals.escalations[0].commandSource).toBe("C-esc-cmd-1");
    expect(signals.escalations[0].eventIndex).toBe(55);

    expect(signals.findings).toHaveLength(1);
    expect(signals.findings[0].commandSource).toBe("C-rev-cmd-2");
    expect(signals.findings[0].eventIndex).toBe(60);

    expect(signals.gates).toHaveLength(1);
    expect(signals.gates[0].commandSource).toBe("C-gate-cmd-3");
    expect(signals.gates[0].eventIndex).toBe(65);

    expect(signals.declinedCandidates).toHaveLength(1);
    expect(signals.declinedCandidates[0].witnessCommandId).toBe("C-wit-cmd-4");
    expect(signals.declinedCandidates[0].eventIndex).toBe(70);

    expect(signals.openProposals).toHaveLength(1);
    expect(signals.openProposals[0].commandSource).toBe("C-prop-cmd-5");
    expect(signals.openProposals[0].eventIndex).toBe(75);

    const digest = buildOwnerDigest({
      runId: "test-run",
      now: FIXED_NOW,
      state: mockState,
    });

    expect(digest.trailingValueSeries.rawValues).toEqual([0, 3, 0]);
    expect(digest.trailingValueSeries.formattedSeries).toBe("[0, 3, 0]");
    expect(digest.trailingValueSeries.totalValue).toBe(3);
    expect(digest.trailingValueSeries.trailingZeroStreak).toBe(1);

    const markdown = formatOwnerDigestMarkdown(digest);
    expect(markdown).toContain("### Owner Digest: `test-run`");
    expect(markdown).toContain("## What I would have done without asking");
    expect(markdown).toContain("## Trailing value series");
    expect(markdown).toContain("- **Raw series**: `[0, 3, 0]`");
  });

  test("extracts value series from events array correctly", () => {
    const mockEvents: readonly Record<string, unknown>[] = [
      {
        kind: "mind-pulse-closed",
        timestamp: "2026-08-21T10:00:00.000Z",
        payload: { pulse_id: "pulse-10", value: 1, outcome: "advance" },
      },
      {
        kind: "mind-pulse-closed",
        timestamp: "2026-08-21T10:15:00.000Z",
        payload: { pulse_id: "pulse-11", value: 0, outcome: "quiescent" },
      },
      {
        kind: "mind-pulse-closed",
        timestamp: "2026-08-21T10:30:00.000Z",
        payload: { pulse_id: "pulse-12", value: 2, outcome: "advance" },
      },
    ];

    const digest = buildOwnerDigest({
      runId: "events-run",
      now: FIXED_NOW,
      events: mockEvents,
    });

    expect(digest.trailingValueSeries.rawValues).toEqual([1, 0, 2]);
    expect(digest.trailingValueSeries.formattedSeries).toBe("[1, 0, 2]");
    expect(digest.trailingValueSeries.totalValue).toBe(3);
  });

  test("golden-file verification for complete multi-signal owner report", () => {
    const series = generateTrailingValueSeries([
      { pulseId: "pulse-1", outcome: "quiescent", value: 0 },
      { pulseId: "pulse-2", outcome: "advance", value: 2 },
      { pulseId: "pulse-3", outcome: "advance", value: 1 },
      { pulseId: "pulse-4", outcome: "quiescent", value: 0 },
    ]);

    const digest: EscalationDigestData = {
      generatedAt: "2026-08-21T12:00:00.000Z",
      runId: "mind-phase-5-verification",
      openFindings: [
        {
          findingId: "find-001",
          taskId: "T-P5-W02",
          severity: "important",
          observation: "Missing witness validation on candidate re-admission",
          remediation: "Invoke gate:prove before candidate activation",
          revalidationGate: "gate-prove-witness",
          commandSource: "C-aud-001",
          eventIndex: 12,
        },
      ],
      failingGates: [
        {
          gateId: "gate-t-p5-w03",
          taskId: "T-P5-W03",
          command: "bun test tests/unit/mind/interval.test.ts",
          exitCode: 1,
          failureSnippet: "Jitter bound exceeded: 25% > 20%",
          commandSource: "C-gate-002",
          eventIndex: 15,
        },
      ],
      escalations: [
        {
          escalationId: "esc-003",
          taskId: "T-P5-W04",
          reason: "Budget limit wall_clock_ms_per_day exceeded",
          evidence: "Used 4 hours of 4 hours daily allocation",
          commandSource: "C-bud-003",
          eventIndex: 18,
        },
      ],
      declinedCandidates: [
        {
          candidateId: "cand-autocommit",
          statement: "Automatically commit and push to remote origin",
          declineReason: "Never unattended list prohibits unattended remote push",
          charterGoalId: "goal-safety",
          witnessCommandId: "C-wit-004",
          commandSource: "C-wit-004",
          eventIndex: 20,
        },
      ],
      openProposals: [
        {
          proposalId: "prop-add-slack-webhook",
          statement: "Send morning report to #ops Slack channel",
          rationale: "External webhook token requires owner secret grant",
          charterGoalId: "goal-transparency",
          requirementId: "req-slack-notify",
          commandSource: "C-prop-005",
          eventIndex: 22,
        },
      ],
      trailingValueSeries: series,
      totalSignalsCount: 5,
    };

    const markdown = formatOwnerDigestMarkdown(digest);

    const expected = [
      "### Owner Digest: `mind-phase-5-verification`",
      "- **Generated**: 2026-08-21T12:00:00.000Z",
      "- **Open findings**: 1",
      "  - `[find-001]` [important] (task `T-P5-W02`): Missing witness validation on candidate re-admission — Remediation: Invoke gate:prove before candidate activation — Revalidation: `gate-prove-witness` (source: `C-aud-001`, event: #12)",
      "- **Failing gates**: 1",
      "  - `gate-t-p5-w03` (task `T-P5-W03`): `bun test tests/unit/mind/interval.test.ts` (exit code 1) — Jitter bound exceeded: 25% > 20% (source: `C-gate-002`, event: #15)",
      "- **Escalations (needs human decision)**: 1",
      "  - `esc-003` (task `T-P5-W04`): Budget limit wall_clock_ms_per_day exceeded — Used 4 hours of 4 hours daily allocation (source: `C-bud-003`, event: #18)",
      "",
      "## What I would have done without asking",
      "",
      "- **Declined candidates**: 1",
      '  - `cand-autocommit`: "Automatically commit and push to remote origin" — Reason: Never unattended list prohibits unattended remote push (goal: `goal-safety`, witness: `C-wit-004`, event: #20)',
      "- **Open proposals (needs authority decision)**: 1",
      '  - `prop-add-slack-webhook`: "Send morning report to #ops Slack channel" — Rationale: External webhook token requires owner secret grant (goal: `goal-transparency`, requirement: `req-slack-notify`, source: `C-prop-005`, event: #22)',
      "",
      "## Trailing value series",
      "",
      "- **Raw series**: `[0, 2, 1, 0]`",
      "- **Total value**: 3",
      "- **Trailing zero streak**: 1",
    ].join("\n");

    expect(markdown).toBe(expected);
  });

  test("buildEscalationDigest processes liveRuns, state, events, and trailing value numbers", () => {
    const liveRunState = {
      tasks: {
        "task-1": {
          id: "task-1",
          status: "open",
          open_finding_ids: ["find-live-1"],
          findings: [
            {
              id: "find-live-1",
              severity: "critical",
              observation: "Critical live finding",
              status: "open",
            },
          ],
        },
      },
      gates: {
        "gate-live-1": {
          status: "failed",
          exit_code: 1,
          name: "Live gate 1",
          command: ["bun", "test"],
        },
      },
    };

    const digest = buildEscalationDigest({
      runId: "mind-multi-source",
      now: "2026-08-21T15:00:00.000Z",
      liveRuns: [
        {
          runId: "worker-live-1",
          state: liveRunState,
        },
      ],
      trailingValueSeries: [0, 1, 3, 0],
    });

    expect(digest.openFindings.length).toBe(1);
    expect(digest.openFindings[0].findingId).toBe("find-live-1");
    expect(digest.failingGates.length).toBe(1);
    expect(digest.trailingValueSeries.rawValues).toEqual([0, 1, 3, 0]);

    const md = formatEscalationDigestMarkdown(digest);
    expect(md).toContain("Escalation Digest");
    expect(md).toContain("find-live-1");
  });
});
