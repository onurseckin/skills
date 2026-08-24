import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import { mindPulseOpenCommand } from "../../../olt/scripts/src/cli/commands/mind-pulse-open.ts";
import { mindWakeCommand } from "../../../olt/scripts/src/cli/commands/mind-wake.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/agents.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/json.ts";
import { executeRescueLane } from "../../../olt/scripts/src/mind/lanes/rescue.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";
import { readAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import type { WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

interface MindDamageFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindDamageCapsule(
  label: string,
  overrides: {
    readonly charterContent?: string;
    readonly pulseOpen?: Record<string, unknown> | null;
    readonly pulseLast?: Record<string, unknown> | null;
    readonly budget?: Record<string, unknown>;
    readonly observations?: readonly Record<string, unknown>[];
    readonly halted?: boolean;
    readonly haltReason?: string;
    readonly agents?: readonly AgentGrantRecord[];
    readonly registerMindAgent?: boolean;
  } = {},
): MindDamageFixture {
  const repo = scratchRoot(import.meta.path, label);
  const charterDir = join(repo, ".olt");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "CHARTER.md");
  const charterContent =
    overrides.charterContent ??
    `# CHARTER\n\n## identity\nDeliberate Damage Test App\n\n## goals\n- G1: Ensure stability under damage\n\n## non-goals\n- Out of scope\n\n## repo_roots\n- \`src/\`\n- \`.olt/\`\n`;
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
      charter_source_path: ".olt/CHARTER.md",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: ".olt/CHARTER.md",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: [".olt/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
        ...(overrides.halted
          ? { halted: true, halt_reason: overrides.haltReason ?? "manual test halt" }
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
        pulses_today: 10,
        wall_clock_ms_today: 1_800_000,
        ...overrides.budget,
      };

      working.pulse = {
        counter: 12,
        open:
          overrides.pulseOpen !== undefined ? (overrides.pulseOpen as unknown as JsonObject) : null,
        last:
          overrides.pulseLast !== undefined
            ? (overrides.pulseLast as unknown as JsonObject)
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
      } as unknown as JsonObject;

      working.observations = (overrides.observations as unknown as JsonObject[]) ?? [];
      working.candidates = [];
      working.escalations = [];
      working.agents = (overrides.agents as unknown as JsonObject[]) ?? [];
    },
  );

  if (overrides.registerMindAgent) {
    agentRegisterCommand({
      run,
      agent: "mind-1",
      role: "mind",
      host: "antigravity",
    });
  }

  return { repo, run, charterPath, charterSha };
}

function setupRunDamageCapsule(
  repo: string,
  runId: string,
  stateMutator?: (working: Record<string, unknown>) => void,
): string {
  const promptBytes = new TextEncoder().encode("Damage test run prompt");
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
      stateMutator(working as Record<string, unknown>);
    }
  });

  return run;
}

describe("Deliberate-Damage Test Suite (PHASE-2.md §4.1 & VERIFICATION.md §3.4)", () => {
  describe("Rung 0 Damage: Charter Drift and Runtime Freshness", () => {
    test("Damage: modified charter bytes after pin triggers Rung 0 HALT and records durable escalation", async () => {
      const fixture = setupMindDamageCapsule("charter-modified");
      // Deliberately tamper with charter bytes on disk
      writeFileSync(
        fixture.charterPath,
        "# CHARTER\n\n## identity\nTampered identity\n\n## goals\n- G1: Changed goal\n",
        "utf-8",
      );

      const result = await executeRescueLane(fixture.run);

      // Verify ladder response
      expect(result.outcome).toBe("halted");
      expect(result.halted).toBe(true);
      expect(result.rungs.rung0.charterDrifted).toBe(true);
      expect(result.rungs.rung0.halted).toBe(true);
      expect(result.rungs.rung0.haltReason).toContain("charter drifted");

      // Verify actual durable state change on disk
      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toContain("charter drifted");

      const escalations = (loaded.state.escalations ?? []) as readonly Record<string, unknown>[];
      expect(escalations.length).toBeGreaterThan(0);
      expect(escalations.some((e) => e.reason === "charter_drift")).toBe(true);

      const haltEvent = loaded.events.find((e) => e.kind === "mind-halted");
      expect(haltEvent).toBeDefined();
      expect((haltEvent?.payload as Record<string, unknown>)?.reason).toContain("charter drifted");
    });

    test("Damage: missing charter file triggers Rung 0 HALT and records durable escalation", async () => {
      const fixture = setupMindDamageCapsule("charter-missing");
      // Deliberately delete the charter file
      rmSync(fixture.charterPath, { force: true });

      const result = await executeRescueLane(fixture.run);

      expect(result.outcome).toBe("halted");
      expect(result.halted).toBe(true);
      expect(result.rungs.rung0.charterDrifted).toBe(true);
      expect(result.rungs.rung0.halted).toBe(true);
      expect(result.rungs.rung0.haltReason).toContain("charter file missing");

      // Verify durable state
      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toContain("charter file missing");

      const escalations = (loaded.state.escalations ?? []) as readonly Record<string, unknown>[];
      expect(escalations.some((e) => e.reason === "charter_missing")).toBe(true);
    });

    test("Damage: charter changed bytes halts mind:wake without arming", async () => {
      const fixture = setupMindDamageCapsule("charter-wake-halt");
      writeFileSync(fixture.charterPath, "# CHARTER\n\nModified charter content\n", "utf-8");

      const result = await mindWakeCommand({ run: fixture.run });

      expect(result.mode).toBe("halted");
      expect(result.charter_status).toBe("DRIFTED");
      const nextCommands = result.next as string[];
      expect(nextCommands.join(" ")).toContain("mind:escalate");
      expect(nextCommands.join(" ")).toContain("charter drifted from pinned digest");
    });

    test("Damage: drifted runtime version triggers Rung 0 HALT and records durable escalation", async () => {
      const fixture = setupMindDamageCapsule("runtime-drifted");

      const result = await executeRescueLane(fixture.run, {
        runtimeFreshnessOverride: {
          drifted: true,
          referenceRuntimeVersion: "99.0.0-tampered",
        },
      });

      expect(result.outcome).toBe("halted");
      expect(result.halted).toBe(true);
      expect(result.rungs.rung0.runtimeDrifted).toBe(true);
      expect(result.rungs.rung0.halted).toBe(true);
      expect(result.rungs.rung0.haltReason).toBe("runtime drifted");

      // Verify durable state on disk
      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toBe("runtime drifted");

      const escalations = (loaded.state.escalations ?? []) as readonly Record<string, unknown>[];
      expect(escalations.some((e) => e.reason === "runtime_drift")).toBe(true);

      const haltEvent = loaded.events.find((e) => e.kind === "mind-halted");
      expect(haltEvent).toBeDefined();
    });
  });

  describe("Rung 0 Damage: Integrity READ_RACE and State Corruption", () => {
    test("Damage: transient READ_RACE in state projection triggers single retry and self-heals", async () => {
      const fixture = setupMindDamageCapsule("read-race-repair");
      const stateFile = join(fixture.run, "state.json");
      const stateBytesBefore = readFileSync(stateFile);

      // Mutate capsule to create event 2
      transact(fixture.run, "mind-1", "mind-test-mutation", { extra: "test" }, (working) => {
        working.test_marker = "applied";
      });

      // Deliberately roll back state.json to revision 1 (simulating write race where events.jsonl was appended first)
      writeFileSync(stateFile, stateBytesBefore);

      // Verify verifyIntegrity detects READ_RACE subcode
      const preCheck = verifyIntegrity(fixture.run);
      const readRaceIssue = preCheck.find((i) => i.code === "STATE_PROJECTION");
      expect(readRaceIssue).toBeDefined();
      expect(readRaceIssue?.subcode).toBe("READ_RACE");

      // Execute rescue lane: Rung 0 should detect READ_RACE, retry once, run doctor/recoverProjection
      const result = await executeRescueLane(fixture.run, {
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung0.readRaceRetried).toBe(true);
      expect(result.rungs.rung0.integrityRepaired).toBe(true);
      expect(result.rungs.rung0.integrityFailed).toBe(false);
      expect(result.rungs.rung0.halted).toBe(false);

      // Verify durable state is fully repaired on disk
      const postCheck = verifyIntegrity(fixture.run);
      expect(postCheck.length).toBe(0);

      const loaded = loadRun(fixture.run, false);
      expect(loaded.state.test_marker).toBe("applied");
    });

    test("Damage: truncated tail of events.jsonl is detected as an integrity issue", () => {
      const fixture = setupMindDamageCapsule("truncate-events");
      const eventsFile = join(fixture.run, "events.jsonl");
      const eventsContent = readFileSync(eventsFile, "utf-8");

      // Append a malformed/truncated event line without newline termination
      writeFileSync(eventsFile, `${eventsContent}{"schema":"harness.event","sequence":99`);

      const issues = verifyIntegrity(fixture.run);
      expect(issues.length).toBeGreaterThan(0);
      expect(
        issues.some(
          (i) =>
            i.code === "EVENT_TORN" ||
            i.code === "EVENT_JSON" ||
            i.code === "EVENT_PATH" ||
            i.code === "STATE_PROJECTION",
        ),
      ).toBe(true);
    });
  });

  describe("Rung 1 Damage: Expired Leases and Single-Writer Coordination", () => {
    test("Damage: expired lease on dead run reclaims lease and marks task retry_ready", async () => {
      const fixture = setupMindDamageCapsule("reclaim-lease");
      const runPath = setupRunDamageCapsule(fixture.repo, "run-dead-lease", (working) => {
        working.agents = [
          {
            id: "worker-dead",
            role: "implementer",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: "T-DAMAGE-01",
            granted_at: new Date(Date.now() - 3600_000).toISOString(),
          },
        ];
        working.tasks = {
          "T-DAMAGE-01": {
            id: "T-DAMAGE-01",
            label: "Damaged Task",
            type: "task",
            status: "leased",
            priority: 100,
            effort: 3,
            requirement_ids: [],
            resource_scope: [],
            write_scope: ["src/damage.ts"],
            created_order: 1,
            repair_round: 0,
            dependencies: [],
            artifact_ids: [],
            history: [],
            attempts: [
              {
                attempt: 1,
                agent_id: "worker-dead",
                role: "implementer",
                kind: "implementation",
                started_at: new Date(Date.now() - 3600_000).toISOString(),
              },
            ],
            lease: {
              agent_id: "worker-dead",
              token_digest: "hash-dead-1",
              expires_at: new Date(Date.now() - 1800_000).toISOString(), // 30m expired
              duration_seconds: 1200,
              issued_at: new Date(Date.now() - 3600_000).toISOString(),
              heartbeat_at: new Date(Date.now() - 3600_000).toISOString(),
              role: "implementer",
              write_scope: ["src/damage.ts"],
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

      // Verify actual durable state changes in target run capsule
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      expect(state.tasks["T-DAMAGE-01"]?.lease).toBeUndefined();
      expect(state.tasks["T-DAMAGE-01"]?.status).toBe("retry_ready");

      // Verify supervisor stale recovery event recorded in event stream
      const staleRecoveryEvent = loaded.events.find((e) => e.kind === "stale-recovery");
      expect(staleRecoveryEvent).toBeDefined();
    });

    test("Damage: active coordinator grant protects run from supervision race (Single-Writer Rule)", async () => {
      const fixture = setupMindDamageCapsule("single-writer-protect");
      const runPath = setupRunDamageCapsule(fixture.repo, "run-live-coordinator", (working) => {
        working.agents = [
          {
            id: "coord-live",
            role: "coordinator",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: null,
            granted_at: new Date().toISOString(),
          },
          {
            id: "worker-busy",
            role: "implementer",
            status: "active",
            host: "antigravity",
            parent_agent_id: "coord-live",
            parent_task_id: "T-LIVE-01",
            granted_at: new Date().toISOString(),
          },
        ];
        working.tasks = {
          "T-LIVE-01": {
            id: "T-LIVE-01",
            label: "Active Task",
            type: "task",
            status: "leased",
            priority: 100,
            effort: 3,
            requirement_ids: [],
            resource_scope: [],
            write_scope: ["src/live.ts"],
            created_order: 1,
            repair_round: 0,
            dependencies: [],
            artifact_ids: [],
            history: [],
            attempts: [],
            lease: {
              agent_id: "worker-busy",
              token_digest: "hash-busy-1",
              expires_at: new Date(Date.now() - 60_000).toISOString(),
              duration_seconds: 1200,
              issued_at: new Date(Date.now() - 1800_000).toISOString(),
              heartbeat_at: new Date(Date.now() - 1800_000).toISOString(),
              role: "implementer",
              write_scope: ["src/live.ts"],
              resource_scope: [],
            },
          },
        };
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      // Assert supervision was bypassed for this run
      expect(result.rungs.rung1.supervisionTicksRun).toBe(0);
      expect(result.rungs.rung1.skippedDueToActiveCoordinator).toContain(runPath);

      // Verify the task lease was NOT modified
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      expect(state.tasks["T-LIVE-01"]?.lease).toBeDefined();
      expect(state.tasks["T-LIVE-01"]?.lease?.agent_id).toBe("worker-busy");
    });
  });

  describe("Rung 2 Damage: Agent Gone Mid-Attempt, Orphan Evidence, Abandoned Worktrees", () => {
    test("Damage: open attempt with dead/released agent triggers Rung 2 task:abandon", async () => {
      const fixture = setupMindDamageCapsule("dead-agent-abandon");
      const runPath = setupRunDamageCapsule(fixture.repo, "run-dead-attempt", (working) => {
        working.agents = [
          {
            id: "killed-agent",
            role: "implementer",
            status: "released",
            release_reason: "presumed_dead",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: "T-KILLED-01",
            granted_at: new Date(Date.now() - 7200_000).toISOString(),
            released_at: new Date(Date.now() - 3600_000).toISOString(),
          },
        ];
        working.tasks = {
          "T-KILLED-01": {
            id: "T-KILLED-01",
            label: "Killed Agent Task",
            type: "task",
            status: "ready",
            priority: 100,
            effort: 3,
            requirement_ids: [],
            resource_scope: [],
            write_scope: ["src/killed.ts"],
            created_order: 1,
            repair_round: 0,
            dependencies: [],
            artifact_ids: [],
            history: [],
            attempts: [
              {
                attempt: 1,
                agent_id: "killed-agent",
                role: "implementer",
                kind: "implementation",
                started_at: new Date(Date.now() - 7200_000).toISOString(),
                // Left unclosed
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
      expect(result.rungs.rung2.abandonedAttempts[0]?.taskId).toBe("T-KILLED-01");
      expect(result.rungs.rung2.abandonedAttempts[0]?.agentId).toBe("killed-agent");

      // Verify actual durable state: attempt is marked abandoned
      const loaded = loadRun(runPath, false);
      const state = loaded.state as unknown as WorkflowState;
      const attempt = state.tasks["T-KILLED-01"]?.attempts[0];
      expect(attempt?.abandoned_at).toBeDefined();
      expect(attempt?.abandoned_reason).toContain("agent killed-agent gone");

      const abandonEvent = loaded.events.find((e) => e.kind === "attempt-abandoned");
      expect(abandonEvent).toBeDefined();
    });

    test("Damage: orphan evidence in live run triggers Rung 2 escalation", async () => {
      const fixture = setupMindDamageCapsule("orphan-evidence-damage");
      const runPath = setupRunDamageCapsule(fixture.repo, "run-orphan-ev", (working) => {
        working.orphan_evidence = [
          {
            id: "ev-orphan-1",
            path: "packets/loose-packet.md",
            reason: "orphaned packet without task parent",
          },
          {
            id: "ev-orphan-2",
            path: "packets/loose-packet-2.md",
            reason: "orphaned packet 2",
          },
        ];
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung2.orphanEvidenceEscalated.length).toBe(1);
      expect(result.rungs.rung2.orphanEvidenceEscalated[0]?.evidenceCount).toBe(2);

      // Verify escalation record in target run capsule state
      const loaded = loadRun(runPath, false);
      const escalations = (loaded.state.escalations ?? []) as readonly Record<string, unknown>[];
      expect(escalations.length).toBe(1);
      expect(escalations[0]?.reason).toBe("orphan_evidence_needs_disposal");

      const escEvent = loaded.events.find((e) => e.kind === "orphan-evidence-escalated");
      expect(escEvent).toBeDefined();
    });
  });

  describe("Rung 3 Damage: Active Grants with Dead Agents", () => {
    test("Damage: active agent with no activity past idle limit is released with presumed_dead", async () => {
      const fixture = setupMindDamageCapsule("idle-agent-damage");
      const nowMs = 1755780000000; // Fixed deterministic timestamp
      const runPath = setupRunDamageCapsule(fixture.repo, "run-idle-agent", (working) => {
        working.agents = [
          {
            id: "idle-validator-1",
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
        grantIdleSeconds: 1800, // 30 min idle threshold
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung3.deadAgentsReleased.length).toBe(1);
      expect(result.rungs.rung3.deadAgentsReleased[0]?.agentId).toBe("idle-validator-1");
      expect(result.rungs.rung3.deadAgentsReleased[0]?.role).toBe("validator");

      // Verify actual durable state change
      const loaded = loadRun(runPath, false);
      const ledger = readAgentLedger(loaded.state);
      const grant = ledger.find((a) => a.id === "idle-validator-1");
      expect(grant?.status).toBe("released");
      expect(grant?.release_reason).toBe("presumed_dead");

      const releaseEvent = loaded.events.find((e) => e.kind === "agent-released");
      expect(releaseEvent).toBeDefined();
    });

    test("Damage: active agent with recent attributable events is NOT released", async () => {
      const fixture = setupMindDamageCapsule("active-agent-keep");
      const nowMs = 1755780000000;
      const runPath = setupRunDamageCapsule(fixture.repo, "run-active-agent", (working) => {
        working.agents = [
          {
            id: "active-worker-1",
            role: "implementer",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: "T1",
            granted_at: new Date(nowMs - 7200_000).toISOString(),
          },
        ];
      });

      // Transact recent event attributed to active-worker-1
      transact(
        runPath,
        "active-worker-1",
        "worker-progress",
        { agent_id: "active-worker-1", progress: "halfway" },
        () => {},
      );

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        grantIdleSeconds: 1800,
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung3.deadAgentsReleased.length).toBe(0);

      const loaded = loadRun(runPath, false);
      const ledger = readAgentLedger(loaded.state);
      const grant = ledger.find((a) => a.id === "active-worker-1");
      expect(grant?.status).toBe("active");
    });
  });

  describe("Rung 4 Damage: Pulse Deadlines, Consecutive Crashes, and Dual-Pulse Locks", () => {
    test("Damage: pulse left open past deadline is closed crashed by Rung 4 and records last_pulse.json", async () => {
      const nowMs = 1755780000000;
      const openedAt = new Date(nowMs - 3600_000).toISOString();
      const deadlineAt = new Date(nowMs - 1800_000).toISOString();

      const fixture = setupMindDamageCapsule("dead-pulse-reclaim", {
        pulseOpen: {
          pulse_id: "pulse-overdue-1",
          actor: "mind-1",
          opened_at: openedAt,
          deadline_at: deadlineAt,
        },
      });

      const result = await executeRescueLane(fixture.run, {
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      expect(result.rungs.rung4.deadPulseReclaimed).toBe(true);
      expect(result.rungs.rung4.reclaimedPulseId).toBe("pulse-overdue-1");
      expect(result.rungs.rung4.consecutiveCrashes).toBe(1);
      expect(result.rungs.rung4.halted).toBe(false);

      // Verify durable state in capsule
      const loaded = loadRun(fixture.run, false);
      const pulse = loaded.state.pulse as Record<string, unknown>;
      expect(pulse.open).toBeNull();
      const last = pulse.last as Record<string, unknown>;
      expect(last.outcome).toBe("crashed");
      expect(last.pulse_id).toBe("pulse-overdue-1");
      expect(last.consecutive_crashes).toBe(1);

      // Verify last_pulse.json written on disk
      const lastPulseFile = join(fixture.run, "last_pulse.json");
      const lastPulseContent = JSON.parse(readFileSync(lastPulseFile, "utf-8")) as {
        outcome: string;
        pulse_id: string;
      };
      expect(lastPulseContent.outcome).toBe("crashed");
      expect(lastPulseContent.pulse_id).toBe("pulse-overdue-1");

      const reclaimEvent = loaded.events.find((e) => e.kind === "mind-pulse-reclaimed");
      expect(reclaimEvent).toBeDefined();
    });

    test("Damage: three consecutive pulse crashes trigger Rung 4 HALT (poisoned capsule)", async () => {
      const nowMs = 1755780000000;
      const fixture = setupMindDamageCapsule("three-crashes-halt", {
        pulseOpen: {
          pulse_id: "pulse-crash-03",
          actor: "mind-1",
          opened_at: new Date(nowMs - 3600_000).toISOString(),
          deadline_at: new Date(nowMs - 1800_000).toISOString(),
        },
        pulseLast: {
          pulse_id: "pulse-crash-02",
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

      // Verify durable state in mind capsule
      const loaded = loadRun(fixture.run, false);
      const mind = loaded.state.mind as Record<string, unknown>;
      expect(mind.halted).toBe(true);
      expect(mind.halt_reason).toContain("consecutive pulse crashes");

      const escalations = (loaded.state.escalations ?? []) as readonly Record<string, unknown>[];
      expect(escalations.some((e) => e.reason === "consecutive_pulse_crashes")).toBe(true);
    });

    test("Damage: holding two pulses at once refuses second open and leaves capsule unmutated", () => {
      const fixture = setupMindDamageCapsule("two-pulses-lock", {
        pulseOpen: {
          pulse_id: "pulse-already-open",
          actor: "mind-1",
          opened_at: new Date().toISOString(),
          deadline_at: new Date(Date.now() + 1800_000).toISOString(),
        },
        registerMindAgent: true,
      });

      const preLoad = loadRun(fixture.run, false);
      const eventSequenceBefore = preLoad.events.length;
      const eventHeadBefore = preLoad.manifest.event_head;

      let errorThrown = false;
      try {
        mindPulseOpenCommand({
          run: fixture.run,
          actor: "mind-1",
          host: "antigravity",
          driver: "manual",
        });
      } catch (err: unknown) {
        errorThrown = true;
        expect(String(err)).toContain("already open");
      }

      expect(errorThrown).toBe(true);

      // Verify capsule integrity: 0 state changes on refusal
      const postLoad = loadRun(fixture.run, false);
      expect(postLoad.events.length).toBe(eventSequenceBefore);
      expect(postLoad.manifest.event_head).toBe(eventHeadBefore);
    });
  });

  describe("Rung 5 Damage: Driver Lateness and GAP Monitoring", () => {
    test("Damage: driver GAP > 3x armed interval records durable observation and warning", async () => {
      const nowMs = 1755780000000;
      const armedIntervalMs = 900_000; // 15m
      const fixture = setupMindDamageCapsule("gap-late-driver", {
        pulseLast: {
          pulse_id: "pulse-gap-old",
          closed_at: new Date(nowMs - 3600_000).toISOString(), // 60m ago (> 3x 15m)
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
      expect(result.rungs.rung5.gapMs).toBe(3600_000);
      expect(result.rungs.rung5.armedIntervalMs).toBe(armedIntervalMs);

      // Verify observation in durable state
      const loaded = loadRun(fixture.run, false);
      const observations = (loaded.state.observations ?? []) as readonly Record<string, unknown>[];
      const gapObs = observations.find((o) => o.source === "driver-gap");
      expect(gapObs).toBeDefined();
      expect(gapObs?.evidence_class).toBe("harness_observed");

      const gapEvent = loaded.events.find((e) => e.kind === "mind-driver-gap-observed");
      expect(gapEvent).toBeDefined();
    });

    test("Damage: driver GAP <= 3x armed interval does NOT trigger lateness observation", async () => {
      const nowMs = 1755780000000;
      const armedIntervalMs = 900_000;
      const fixture = setupMindDamageCapsule("gap-on-time", {
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

      const loaded = loadRun(fixture.run, false);
      const observations = (loaded.state.observations ?? []) as readonly Record<string, unknown>[];
      const gapObs = observations.find((o) => o.source === "driver-gap");
      expect(gapObs).toBeUndefined();
    });
  });

  describe("End-to-End Multi-Defect Scratch Recovery", () => {
    test("Damage: scratch environment with multiple non-halting defects resolves all rungs cleanly", async () => {
      const nowMs = 1755780000000;
      const armedIntervalMs = 900_000;

      const fixture = setupMindDamageCapsule("multi-defect-rescue", {
        pulseOpen: {
          pulse_id: "pulse-stuck-open",
          actor: "mind-1",
          opened_at: new Date(nowMs - 3600_000).toISOString(),
          deadline_at: new Date(nowMs - 1800_000).toISOString(),
        },
        pulseLast: {
          pulse_id: "pulse-multi-prev",
          closed_at: new Date(nowMs - 4000_000).toISOString(),
          outcome: "quiescent",
          value: 0,
          armed_interval_ms: armedIntervalMs,
          consecutive_crashes: 0,
        },
      });

      // Create target run with expired lease, dead agent attempt, orphan evidence, and idle agent
      const runPath = setupRunDamageCapsule(fixture.repo, "run-multi-defects", (working) => {
        working.agents = [
          {
            id: "dead-worker-1",
            role: "implementer",
            status: "released",
            release_reason: "presumed_dead",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: "T-MULTI-01",
            granted_at: new Date(nowMs - 7200_000).toISOString(),
            released_at: new Date(nowMs - 3600_000).toISOString(),
          },
          {
            id: "idle-validator-2",
            role: "validator",
            status: "active",
            host: "antigravity",
            parent_agent_id: null,
            parent_task_id: null,
            granted_at: new Date(nowMs - 7200_000).toISOString(),
          },
        ];
        working.tasks = {
          "T-MULTI-01": {
            id: "T-MULTI-01",
            label: "Multi-defect Task",
            type: "task",
            status: "ready",
            priority: 100,
            effort: 3,
            requirement_ids: [],
            resource_scope: [],
            write_scope: ["src/multi.ts"],
            created_order: 1,
            repair_round: 0,
            dependencies: [],
            artifact_ids: [],
            history: [],
            attempts: [
              {
                attempt: 1,
                agent_id: "dead-worker-1",
                role: "implementer",
                kind: "implementation",
                started_at: new Date(nowMs - 7200_000).toISOString(),
              },
            ],
          },
        };
        working.orphan_evidence = [
          {
            id: "ev-orphan-multi",
            path: "packets/multi-orphan.md",
            reason: "orphaned",
          },
        ];
      });

      const result = await executeRescueLane(fixture.run, {
        targetRunRoots: [runPath],
        grantIdleSeconds: 1800,
        now: nowMs,
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      });

      // Verify overall outcome
      expect(result.outcome).toBe("rescued");
      expect(result.halted).toBe(false);
      expect(result.actionsTaken.length).toBeGreaterThan(0);

      // Verify each rung's contribution
      expect(result.rungs.rung0.halted).toBe(false);
      expect(result.rungs.rung2.abandonedAttempts.length).toBe(1);
      expect(result.rungs.rung2.orphanEvidenceEscalated.length).toBe(1);
      expect(result.rungs.rung3.deadAgentsReleased.length).toBe(1);
      expect(result.rungs.rung4.deadPulseReclaimed).toBe(true);

      // Verify durable state across mind capsule and run capsule
      const loadedMind = loadRun(fixture.run, false);
      const mindPulse = loadedMind.state.pulse as Record<string, unknown>;
      expect(mindPulse.open).toBeNull();
      expect((mindPulse.last as Record<string, unknown>).outcome).toBe("crashed");

      const loadedRun = loadRun(runPath, false);
      const runState = loadedRun.state as unknown as WorkflowState;
      expect(runState.tasks["T-MULTI-01"]?.attempts[0]?.abandoned_at).toBeDefined();
      const escalations = (runState.escalations ?? []) as readonly Record<string, unknown>[];
      expect(escalations.length).toBe(1);
      const ledger = readAgentLedger(loadedRun.state);
      const idleGrant = ledger.find((a) => a.id === "idle-validator-2");
      expect(idleGrant?.status).toBe("released");
    });
  });
});
