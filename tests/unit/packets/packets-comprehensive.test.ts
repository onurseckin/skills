import { describe, expect, test } from "bun:test";
import { renderValidationRound } from "../../../olt/scripts/src/packets/render-validation-round.ts";
import {
  anchoredChangedPaths,
  anchoredDiff,
  diffAnchor,
} from "../../../olt/scripts/src/packets/round-repository-delta.ts";
import { TimerProtectionGuard } from "../../../olt/scripts/src/authority/guards/timer-protection.ts";
import { evaluateRoleInvariants } from "../../../olt/scripts/src/authority/persona/eval-invariants.ts";
import type {
  DriftFinding,
  ReflexiveAuditContext,
  RoleBoundaryProfile,
} from "../../../olt/scripts/src/authority/persona/types.ts";

describe("Packets, Delta, Validation Round & Persona Invariants Comprehensive", () => {
  test("renderValidationRound formats all sections of validation round data", () => {
    const roundData = {
      round: 2,
      previous_round: {
        round: 1,
        started_at: "2026-08-30T10:00:00Z",
        ended_at: "2026-08-30T10:30:00Z",
      },
      prove_these_hold: [
        {
          demand_id: "D-1",
          requirement_id: "REQ-1",
          prove: "Tests pass cleanly",
          prove_by: "bun test",
          probe_round: 1,
          look_at: [{ path: "src/index.ts" }],
        },
      ],
      commands_already_run: [
        {
          command_id: "CMD-1",
          exit_code: 0,
          status: "success",
          gate_id: "G-1",
          argv: ["bun", "test"],
          cwd_relative: ".",
          actor: "worker-1",
          finished_at: "2026-08-30T10:15:00Z",
          stdout: { text: "All 10 tests passed", truncated: false },
          stderr: { text: "", truncated: false },
        },
        {
          command_id: "CMD-2",
          exit_code: null,
          status: "aborted",
          gate_id: null,
          argv: ["sleep", "10"],
          cwd_relative: ".",
          actor: "worker-1",
          finished_at: "2026-08-30T10:20:00Z",
        },
      ],
      gates: [{ gate_id: "G-1", passed: true }],
      repository_delta: {
        full: {
          anchor: { captured_at: "2026-08-30T09:00:00Z", head_commit: "abcd123" },
          argv: ["diff", "abcd123"],
          text: "diff --git a/file b/file\n+new line",
          truncated: true,
          recorded_change: {
            content_sha256_changed: true,
            file_count: { before: 10, after: 11 },
            total_bytes: { before: 1000, after: 1100 },
          },
        },
        since_previous_round: {
          anchor: { captured_at: "2026-08-30T10:00:00Z", head_commit: null },
          unavailable: "No commit found",
        },
      },
    };

    const rendered = renderValidationRound(roundData);
    expect(rendered).toContain("## Round 2 — the record this run already holds");
    expect(rendered).toContain("Prove these hold");
    expect(rendered).toContain("`D-1` — requirement REQ-1 (probe round 1)");
    expect(rendered).toContain("All 10 tests passed");
    expect(rendered).toContain("diff --git a/file");
  });

  test("renderValidationRound handles empty demands and commands", () => {
    const emptyRound = {
      round: 1,
      previous_round: {},
      prove_these_hold: [],
      commands_already_run: [],
      gates: [],
      repository_delta: {},
    };
    const rendered = renderValidationRound(emptyRound);
    expect(rendered).toContain("No demand from an earlier round stands on the record.");
    expect(rendered).toContain("This run has recorded no command against this task.");
  });

  test("diffAnchor, anchoredDiff, and anchoredChangedPaths", () => {
    const anchorWithHead = diffAnchor({
      inspection_sha256: "sha-123",
      captured_at: "2026-08-30T00:00:00Z",
      phase: "plan",
      git: { head: "commit-abc" },
    });
    expect(anchorWithHead.head_commit).toBe("commit-abc");

    const anchorWithoutHead = diffAnchor({
      inspection_sha256: "sha-456",
      captured_at: "2026-08-30T00:00:00Z",
      phase: "plan",
    });
    expect(anchorWithoutHead.head_commit).toBeNull();

    const mockGit = (_root: string, _argv: string[], _ceiling: number) => ({
      bytes: Buffer.from("src/index.ts\nsrc/types.ts\n"),
    });

    const diffRes = anchoredDiff(".", anchorWithHead, new Date(), mockGit);
    expect(diffRes.unavailable).toBeUndefined();
    expect(diffRes.text).toContain("src/index.ts");

    const diffNoHead = anchoredDiff(".", anchorWithoutHead, new Date(), mockGit);
    expect(diffNoHead.unavailable).toBeDefined();

    const pathsRes = anchoredChangedPaths(".", anchorWithHead, new Date(), mockGit);
    expect(pathsRes.paths).toEqual(["src/index.ts", "src/types.ts"]);

    const pathsNoHead = anchoredChangedPaths(".", anchorWithoutHead, new Date(), mockGit);
    expect(pathsNoHead.unavailable).toBeDefined();
  });

  test("TimerProtectionGuard allows human_root and denies other roles on supervisory timer", () => {
    const supervisoryTimer = { id: "timer-1", isSupervisory: true, label: "Heartbeat" };
    const nonSupervisoryTimer = { id: "timer-2", isSupervisory: false };

    // Human root can kill supervisory timer
    expect(() =>
      TimerProtectionGuard.assertCanKillTimer(
        { id: "human-1", role: "human_root" },
        supervisoryTimer,
      ),
    ).not.toThrow();

    // Regular agent cannot kill supervisory timer
    expect(() =>
      TimerProtectionGuard.assertCanKillTimer(
        { id: "agent-1", role: "orchestrator" },
        supervisoryTimer,
      ),
    ).toThrow("Supervisory heartbeats are immutable");

    // Any agent can kill non-supervisory timer
    expect(() =>
      TimerProtectionGuard.assertCanKillTimer(
        { id: "agent-1", role: "implementer" },
        nonSupervisoryTimer,
      ),
    ).not.toThrow();
  });

  test("evaluateRoleInvariants checks file mutations, direct execution, cross tier spawns, and main-thread release", () => {
    const roleBoundaries: RoleBoundaryProfile = {
      role: "orchestrator",
      tier: 1,
      permittedSpawns: ["coordinator"],
      forbiddenActions: ["claim_task"],
    };

    const context: ReflexiveAuditContext = {
      role: "orchestrator",
      isMainThreadExecution: true,
      fileModificationsOnSupervisoryThread: ["src/forbidden.ts"],
      directExecutionAttempts: ["claim_task"],
      crossTierSpawns: ["implementer"],
      recentActions: [{ action: "edit_file", targetFile: "src/bad.ts" }, { action: "git_commit" }],
    };

    const compliance: Record<string, boolean> = {
      zero_file_mutation: true,
      delegated_execution_only: true,
      strict_tier_hierarchy: true,
      background_finalization_confinement: true,
    };
    const findings: DriftFinding[] = [];
    const recommendedActions: string[] = [];

    evaluateRoleInvariants(
      "orchestrator",
      roleBoundaries,
      context,
      compliance,
      findings,
      recommendedActions,
    );

    expect(compliance.zero_file_mutation).toBe(false);
    expect(compliance.delegated_execution_only).toBe(false);
    expect(compliance.strict_tier_hierarchy).toBe(false);
    expect(compliance.background_finalization_confinement).toBe(false);
    expect(findings.length).toBe(4);
    expect(recommendedActions.length).toBe(4);
  });
});
