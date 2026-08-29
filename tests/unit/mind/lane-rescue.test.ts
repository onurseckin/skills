import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import { executeRescueLane } from "../../../olt/scripts/src/mind/lanes/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

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
    readonly pulseOpen?: Record<string, unknown> | null;
    readonly pulseLast?: Record<string, unknown> | null;
    readonly budget?: Record<string, unknown>;
    readonly observations?: readonly Record<string, unknown>[];
    readonly halted?: boolean;
    readonly agents?: readonly AgentGrantRecord[];
  } = {},
): MindFixture {
  const repo = mkdtempSync(join(tmpdir(), `rescue-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test application"\n  goals:\n    - id: "G1"\n      statement: "Ensure stability"\n  non_goals:\n    - "Out of scope"\n  repo_roots:\n    - "src/"\n`;
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
          goals: ["G1"],
          repo_roots: ["olt/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
        ...(overrides.halted ? { halted: true, halt_reason: "test halt" } : {}),
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
        pulses_today: 10,
        wall_clock_ms_today: 1_800_000,
        ...overrides.budget,
      };

      working.pulse = {
        counter: 12,
        open: overrides.pulseOpen !== undefined ? overrides.pulseOpen : null,
        last:
          overrides.pulseLast !== undefined
            ? overrides.pulseLast
            : {
                pulse_id: "pulse-11",
                closed_at: new Date(Date.now() - 900_000).toISOString(),
                outcome: "quiescent",
                value: 0,
                armed_interval_ms: 900_000,
                armed_at: new Date(Date.now() - 1_800_000).toISOString(),
                arm_mechanism: "systemd-timer",
                zero_value_streak: 1,
              },
      };

      working.observations = overrides.observations ?? [];
      working.candidates = [];
      working.escalations = [];
      working.agents = overrides.agents ?? [];
    },
  );

  return { repo, run, charterPath, charterSha };
}

function setupRunCapsule(
  repo: string,
  runId: string,
  stateMutator?: (working: WorkflowState) => void,
): string {
  const promptBytes = new TextEncoder().encode("Test prompt");
  const run = initRun(repo, runId, promptBytes, "file", true);

  transact(run, "test-init", "run-initialized", {}, (working) => {
    working.graph = {
      schema: "harness.graph",
      version: 1,
      revision: 1,
      nodes: [],
      edges: [],
      gates: [],
    };
    working.requirements = {
      schema: "harness.requirements",
      version: 1,
      prompt_sha256: "hash",
      dispositions: [],
      requirements: [],
    };
    working.commands = {};
    working.tasks = {};
    working.agents = [];
    working.orphan_evidence = [];
    working.escalations = [];
    if (stateMutator) {
      stateMutator(working as unknown as WorkflowState);
    }
  });

  return run;
}

describe("rescue.ts — executeRescueLane", () => {
  describe("Rung 0: Charter, Runtime, Integrity Drift", () => {
    test("Rung 0: charter drift triggers HALT and escalation", async () => {
      const fixture = setupMindCapsule("charter-drift");
      writeFileSync(
        fixture.charterPath,
        'name: "mind"\nrole: "mind"\ncharter:\n  identity: "Modified charter content"\n',
      );

      const result = await executeRescueLane(fixture.run);

      expect(result.outcome).toBe("halted");
      expect(result.halted).toBe(true);
      expect(result.rungs.rung0.charterDrifted).toBe(true);
      expect(result.rungs.rung0.halted).toBe(true);
      expect(result.rungs.rung0.haltReason).toContain("charter drifted");

      // Verify durable state change
      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toContain("charter drifted");
      const escalations = loaded.state.escalations as Record<string, unknown>[];
      expect(escalations.length).toBeGreaterThan(0);
      expect(escalations[0]?.reason).toBe("charter_drift");
    });

    test("Rung 0: missing charter file triggers HALT and escalation", async () => {
      const fixture = setupMindCapsule("charter-missing");
      rmSync(fixture.charterPath, { force: true });

      const result = await executeRescueLane(fixture.run);

      expect(result.outcome).toBe("halted");
      expect(result.halted).toBe(true);
      expect(result.rungs.rung0.charterDrifted).toBe(true);
      expect(result.rungs.rung0.haltReason).toContain("charter file missing");

      // Verify durable state change
      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
    });

    test("Rung 0: runtime drift triggers HALT and escalation", async () => {
      const fixture = setupMindCapsule("runtime-drift");

      const result = await executeRescueLane(fixture.run, {
        runtimeFreshnessOverride: {
          drifted: true,
          referenceRuntimeVersion: "1.0.0-mock",
        },
      });

      expect(result.outcome).toBe("halted");
      expect(result.halted).toBe(true);
      expect(result.rungs.rung0.runtimeDrifted).toBe(true);
      expect(result.rungs.rung0.haltReason).toContain("runtime drifted");

      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toBe("runtime drifted");
    });

    test("Rung 0: passing charter, runtime, and integrity proceeds without halt", async () => {
      const fixture = setupMindCapsule("rung0-clean");

      const result = await executeRescueLane(fixture.run, {
        runtimeFreshnessOverride: {
          drifted: false,
          referenceRuntimeVersion: "1.0.0",
        },
      });

      expect(result.rungs.rung0.halted).toBe(false);
      expect(result.rungs.rung0.charterDrifted).toBe(false);
      expect(result.rungs.rung0.runtimeDrifted).toBe(false);
      expect(result.rungs.rung0.integrityFailed).toBe(false);
    });
  });

  describe("Rung 1: Supervision Tick and Single-Writer Rule", () => {
    test("Rung 1: skips supervision tick when an active coordinator holds the grant (single-writer rule)", async () => {
      const fixture = setupMindCapsule("single-writer");
      const runPath = setupRunCapsule(fixture.repo, "run-with-coordinator", (working) => {
        working.agents = [
          {
            id: "coord-1",
            role: "coordinator",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: null,
            granted_at: new Date().toISOString(),
          },
          {
            id: "worker-1",
            role: "implementer",
            status: "active",
            host: "antigravity",
            parent_agent_id: "coord-1",
            parent_task_id: "T1",
            granted_at: new Date().toISOString(),
          },
        ];
        working.tasks = {
          T1: {
            id: "T1",
            label: "Task 1",
            type: "task",
            status: "leased",
            priority: 100,
            effort: 3,
            requirement_ids: [],
            resource_scope: [],
            write_scope: ["src/a.ts"],
            created_order: 1,
            repair_round: 0,
            dependencies: [],
            artifact_ids: [],
            history: [],
            attempts: [
              {
                attempt: 1,
                agent_id: "worker-1",
                role: "implementer",
                kind: "implementation",
                started_at: new Date(Date.now() - 3600_000).toISOString(),
              },
            ],
            lease: {
              agent_id: "worker-1",
              token_digest: "hash-1",
              expires_at: new Date(Date.now() - 1800_000).toISOString(),
              duration_seconds: 1200,
              issued_at: new Date(Date.now() - 3600_000).toISOString(),
              heartbeat_at: new Date(Date.now() - 3600_000).toISOString(),
              role: "implementer",
              write_scope: ["src/a.ts"],
              resource_scope: [],
            },
          },
        };
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung1.liveRunsChecked).toBe(1);
      expect(result.rungs.rung1.supervisionTicksRun).toBe(0);
      expect(result.rungs.rung1.skippedDueToActiveCoordinator).toContain(runPath);

      // Verify the task lease was NOT reclaimed by Rung 1 (coordinator is protected)
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      expect(state.tasks["T1"]?.lease).toBeDefined();
    });

    test("Rung 1: takes supervision tick when NO active coordinator exists (reclaims stale leases)", async () => {
      const fixture = setupMindCapsule("supervise-run");
      const runPath = setupRunCapsule(fixture.repo, "run-no-coordinator", (working) => {
        working.agents = [
          {
            id: "worker-1",
            role: "implementer",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: "T1",
            granted_at: new Date(Date.now() - 3600_000).toISOString(),
          },
        ];
        working.tasks = {
          T1: {
            id: "T1",
            label: "Task 1",
            type: "task",
            status: "leased",
            priority: 100,
            effort: 3,
            requirement_ids: [],
            resource_scope: [],
            write_scope: ["src/b.ts"],
            created_order: 1,
            repair_round: 0,
            dependencies: [],
            artifact_ids: [],
            history: [],
            attempts: [
              {
                attempt: 1,
                agent_id: "worker-1",
                role: "implementer",
                kind: "implementation",
                started_at: new Date(Date.now() - 3600_000).toISOString(),
              },
            ],
            lease: {
              agent_id: "worker-1",
              token_digest: "hash-1",
              expires_at: new Date(Date.now() - 1800_000).toISOString(),
              duration_seconds: 1200,
              issued_at: new Date(Date.now() - 3600_000).toISOString(),
              heartbeat_at: new Date(Date.now() - 3600_000).toISOString(),
              role: "implementer",
              write_scope: ["src/b.ts"],
              resource_scope: [],
            },
          },
        };
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung1.supervisionTicksRun).toBe(1);
      expect(result.rungs.rung1.reclaimedLeasesCount).toBe(1);

      // Verify the task lease was reclaimed and task transitioned to retry_ready
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      expect(state.tasks["T1"]?.lease).toBeUndefined();
      expect(state.tasks["T1"]?.status).toBe("retry_ready");
    });
  });

  describe("Rung 2: Residue the Tick Cannot Fix", () => {
    test("Rung 2: abandons open attempts whose agent is gone/released", async () => {
      const fixture = setupMindCapsule("abandon-attempt");
      const runPath = setupRunCapsule(fixture.repo, "run-abandon", (working) => {
        working.agents = [
          {
            id: "dead-worker",
            role: "implementer",
            status: "released",
            release_reason: "presumed_dead",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: "T2",
            granted_at: new Date(Date.now() - 7200_000).toISOString(),
            released_at: new Date(Date.now() - 3600_000).toISOString(),
          },
        ];
        working.tasks = {
          T2: {
            id: "T2",
            label: "Task 2",
            type: "task",
            status: "ready",
            priority: 100,
            effort: 3,
            requirement_ids: [],
            resource_scope: [],
            write_scope: ["src/c.ts"],
            created_order: 1,
            repair_round: 0,
            dependencies: [],
            artifact_ids: [],
            history: [],
            attempts: [
              {
                attempt: 1,
                agent_id: "dead-worker",
                role: "implementer",
                kind: "implementation",
                started_at: new Date(Date.now() - 7200_000).toISOString(),
                // Left open without completion or abandon
              },
            ],
          },
        };
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung2.abandonedAttempts.length).toBe(1);
      expect(result.rungs.rung2.abandonedAttempts[0]?.taskId).toBe("T2");

      // Verify durable state: attempt is closed as abandoned
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      const attempt = state.tasks["T2"]?.attempts[0];
      expect(attempt?.abandoned_at).toBeDefined();
      expect(attempt?.abandoned_reason).toContain("agent dead-worker gone");
    });

    test("Rung 2: escalates orphan evidence for coordinator disposal", async () => {
      const fixture = setupMindCapsule("orphan-ev");
      const runPath = setupRunCapsule(fixture.repo, "run-orphan", (working) => {
        working.orphan_evidence = [
          {
            id: "orphan-1",
            path: "packets/old-packet.md",
            reason: "orphaned",
          },
        ];
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung2.orphanEvidenceEscalated.length).toBe(1);
      expect(result.rungs.rung2.orphanEvidenceEscalated[0]?.evidenceCount).toBe(1);

      // Verify escalation record in state
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      expect(state.escalations?.length).toBeGreaterThan(0);
      expect(state.escalations?.[0]?.reason).toBe("orphan_evidence_needs_disposal");
    });
  });

  describe("Rung 3: Dead Tier-1/Tier-2 Agents", () => {
    test("Rung 3: releases active agent with presumed_dead when idle beyond threshold", async () => {
      const fixture = setupMindCapsule("dead-agent");
      const nowMs = Date.now();
      const runPath = setupRunCapsule(fixture.repo, "run-dead-agent", (working) => {
        working.agents = [
          {
            id: "idle-validator",
            role: "validator",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: null,
            granted_at: new Date(nowMs - 7200_000).toISOString(), // 2 hours ago
          },
        ];
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        grantIdleSeconds: 1800, // 30 min limit
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung3.deadAgentsReleased.length).toBe(1);
      expect(result.rungs.rung3.deadAgentsReleased[0]?.agentId).toBe("idle-validator");
      expect(result.rungs.rung3.deadAgentsReleased[0]?.role).toBe("validator");

      // Verify state change in run capsule: agent status is released with presumed_dead
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      const grant = state.agents?.find((a) => a.id === "idle-validator");
      expect(grant?.status).toBe("released");
      expect(grant?.release_reason).toBe("presumed_dead");
    });

    test("Rung 3: does NOT release active agent if recent attributable events exist", async () => {
      const fixture = setupMindCapsule("live-agent");
      const nowMs = Date.now();
      const runPath = setupRunCapsule(fixture.repo, "run-live-agent", (working) => {
        working.agents = [
          {
            id: "busy-planner",
            role: "planner",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: null,
            granted_at: new Date(nowMs - 7200_000).toISOString(),
          },
        ];
      });

      // Transact an event attributed to busy-planner 5 minutes ago
      transact(runPath, "busy-planner", "planner-active", { agent_id: "busy-planner" }, () => {});

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        grantIdleSeconds: 1800, // 30 min limit
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung3.deadAgentsReleased.length).toBe(0);

      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      const grant = state.agents?.find((a) => a.id === "busy-planner");
      expect(grant?.status).toBe("active");
    });
  });

  describe("Rung 4: Dead Pulse Reclaim and Consecutive Crash HALT", () => {
    test("Rung 4: reclaims dead pulse open past its deadline", async () => {
      const nowMs = Date.now();
      const fixture = setupMindCapsule("dead-pulse", {
        pulseOpen: {
          pulse_id: "pulse-dead-1",
          actor: "mind-1",
          opened_at: new Date(nowMs - 3600_000).toISOString(),
          deadline_at: new Date(nowMs - 1800_000).toISOString(),
        },
      });

      const result = await executeRescueLane(fixture.run, {
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung4.deadPulseReclaimed).toBe(true);
      expect(result.rungs.rung4.reclaimedPulseId).toBe("pulse-dead-1");
      expect(result.rungs.rung4.consecutiveCrashes).toBe(1);
      expect(result.rungs.rung4.halted).toBe(false);

      // Verify durable state change
      const loaded = loadRun(fixture.run, false);
      const pulse = loaded.state.pulse as Record<string, unknown>;
      expect(pulse.open).toBeNull();
      const last = pulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("crashed");
      expect(last.pulse_id).toBe("pulse-dead-1");
      expect(last.consecutive_crashes).toBe(1);
    });

    test("Rung 4: reaches HALT after 3 consecutive pulse crashes (poisoned capsule)", async () => {
      const nowMs = Date.now();
      const fixture = setupMindCapsule("poisoned-capsule", {
        pulseOpen: {
          pulse_id: "pulse-crash-3",
          actor: "mind-1",
          opened_at: new Date(nowMs - 3600_000).toISOString(),
          deadline_at: new Date(nowMs - 1800_000).toISOString(),
        },
        pulseLast: {
          pulse_id: "pulse-crash-2",
          closed_at: new Date(nowMs - 3700_000).toISOString(),
          outcome: "crashed",
          value: 0,
          consecutive_crashes: 2,
          armed_interval_ms: 900_000,
        },
      });

      const result = await executeRescueLane(fixture.run, {
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.outcome).toBe("halted");
      expect(result.halted).toBe(true);
      expect(result.rungs.rung4.deadPulseReclaimed).toBe(true);
      expect(result.rungs.rung4.consecutiveCrashes).toBe(3);
      expect(result.rungs.rung4.halted).toBe(true);
      expect(result.rungs.rung4.haltReason).toContain("consecutive pulse crashes");

      // Verify durable halt state
      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toContain("consecutive pulse crashes");
    });
  });

  describe("Rung 5: Driver Lateness / GAP Detection", () => {
    test("Rung 5: detects GAP > 3x armed interval, records observation and notification", async () => {
      const nowMs = Date.now();
      const armedIntervalMs = 900_000; // 15m
      const fixture = setupMindCapsule("driver-gap", {
        pulseLast: {
          pulse_id: "pulse-old",
          closed_at: new Date(nowMs - 3600_000).toISOString(), // 60 min ago (> 3x 15m)
          outcome: "quiescent",
          value: 0,
          armed_interval_ms: armedIntervalMs,
          consecutive_crashes: 0,
        },
      });

      const result = await executeRescueLane(fixture.run, {
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung5.gapExceeded).toBe(true);
      expect(result.rungs.rung5.notified).toBe(true);
      expect(result.rungs.rung5.gapMs).toBeGreaterThanOrEqual(3600_000);
      expect(result.rungs.rung5.armedIntervalMs).toBe(armedIntervalMs);

      // Verify observation in durable state
      const loaded = loadRun(fixture.run, false);
      const observations = loaded.state.observations as Record<string, unknown>[];
      const gapObs = observations.find((o) => o.source === "driver-gap");
      expect(gapObs).toBeDefined();
    });

    test("Rung 5: does NOT trigger notification if GAP <= 3x armed interval", async () => {
      const nowMs = Date.now();
      const armedIntervalMs = 900_000; // 15m
      const fixture = setupMindCapsule("driver-on-time", {
        pulseLast: {
          pulse_id: "pulse-recent",
          closed_at: new Date(nowMs - 1200_000).toISOString(), // 20m ago (<= 45m limit)
          outcome: "quiescent",
          value: 0,
          armed_interval_ms: armedIntervalMs,
          consecutive_crashes: 0,
        },
      });

      const result = await executeRescueLane(fixture.run, {
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung5.gapExceeded).toBe(false);
      expect(result.rungs.rung5.notified).toBe(false);
    });
  });

  describe("End-to-End Ladder Execution", () => {
    test("Healthy capsule with no issues returns quiescent outcome", async () => {
      const nowMs = Date.now();
      const fixture = setupMindCapsule("clean-all", {
        pulseLast: {
          pulse_id: "pulse-clean",
          closed_at: new Date(nowMs - 600_000).toISOString(),
          outcome: "quiescent",
          value: 0,
          armed_interval_ms: 900_000,
          consecutive_crashes: 0,
        },
      });

      const result = await executeRescueLane(fixture.run, {
        now: nowMs,
        targetRunRoots: [],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.outcome).toBe("quiescent");
      expect(result.halted).toBe(false);
      expect(result.actionsTaken.length).toBe(0);
      expect(result.escalations.length).toBe(0);
    });

    test("Rung 0: halts on runtime drift", async () => {
      const fixture = setupMindCapsule("runtime-drift");

      const result = await executeRescueLane(fixture.run, {
        runtimeFreshnessOverride: { drifted: true, referenceRuntimeVersion: "2.0.0" },
      });

      expect(result.halted).toBe(true);
      expect(result.haltReason).toContain("runtime drifted");
      expect(result.rungs.rung0.runtimeDrifted).toBe(true);
    });

    test("Rung 2: reclaims worktrees when worktree ledger is present", async () => {
      const fixture = setupMindCapsule("wt-reclaim");
      const workerRun = initRun(
        fixture.repo,
        "worker-capsule-1",
        readFileSync(fixture.charterPath),
        "file",
        true,
      );

      // Add a worktree ledger to workerRun
      transact(workerRun, "actor-1", "task-assigned", {}, (working) => {
        working.worktrees = {
          "wt-1": {
            id: "wt-1",
            path: "/tmp/fake-wt-1",
            branch: "task-branch-1",
            status: "active",
            created_at: new Date(Date.now() - 100_000).toISOString(),
          },
        };
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [workerRun],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
        now: "2026-08-24T12:00:00.000Z",
      });

      expect(result.rungs.rung2).toBeDefined();
    });
  });
});
