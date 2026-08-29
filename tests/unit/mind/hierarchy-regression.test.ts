import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentRegisterCommand } from "../../../olt/scripts/src/cli/commands/agent-ops.ts";
import {
  mindRoundCloseCommand,
  mindRoundOpenCommand,
} from "../../../olt/scripts/src/cli/commands/mind-round.ts";
import { COMMAND_REGISTRY, findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import { evidenced } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { JsonObject, JsonValue } from "../../../olt/scripts/src/core/contracts/index.ts";
import { AGENT_ROLES } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  type MindBudget,
  type ParsedCharter,
} from "../../../olt/scripts/src/mind/charter.ts";
import {
  ABSTRACT_PROFILES,
  assertAbstractProfile,
  assertNoModelTelemetry,
  assertTierSpawn,
  buildTier1DeploymentPacket,
  createTier1DeployInputFromCandidate,
  loadMindContract,
  validateAbstractProfile,
  validateTierSpawn,
  type Tier1DeploymentPacketInput,
} from "../../../olt/scripts/src/mind/deploy.ts";
import type { CandidateRecord } from "../../../olt/scripts/src/mind/gates.ts";
import {
  formatHostDegradation,
  isAbstractProfile,
  isPerAgentModelSelectionSupported,
  resolveAgentProfile,
  resolveProfile,
  roleToProfile,
  type ProfileBindings,
} from "../../../olt/scripts/src/mind/profiles.ts";
import {
  carryForwardFindingsAndRequirements,
  getAllRounds,
  getOpenRoundForObjective,
  reconcileRoundState,
} from "../../../olt/scripts/src/mind/rounds.ts";
import {
  loadRoleContract,
  resolveRoleContractPath,
} from "../../../olt/scripts/src/packets/role-contract.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

function createMindTestCapsule(
  callerPath: string,
  label: string,
  overrides: {
    readonly budget?: Record<string, unknown>;
    readonly candidates?: readonly Record<string, unknown>[];
    readonly registerAgent?: boolean;
    readonly agentRole?: "mind" | "orchestrator" | "coordinator" | "implementer" | "validator";
    readonly agentId?: string;
  } = {},
): { repo: string; run: string } {
  const repo = scratchRoot(callerPath, label);
  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  writeFileSync(
    charterPath,
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Regression"\n  goals:\n    - id: "G1"\n      statement: "Stability"\n  non_goals:\n    - "None"\n  repo_roots:\n    - "src/"\n`,
    "utf-8",
  );
  const charterSha = createHash("sha256").update(readFileSync(charterPath)).digest("hex");
  const run = initRun(repo, `mind-reg-${label}`, readFileSync(charterPath), "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    { generation: 1, charter_source_path: "olt/agents/mind.yaml", pinned_sha256: charterSha },
    (w) => {
      w.mind = {
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
      };
      w.budget = {
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
        ...(overrides.budget as unknown as JsonObject),
      };
      const candList = overrides.candidates ?? [
        {
          id: "cand-1",
          kind: "defect",
          statement: "fix parser race condition",
          charter_goal_ids: ["G1"],
          write_scope: ["src/parser.ts"],
          status: "admitted",
          witness_command_id: "cmd-witness-1",
        },
      ];
      w.candidates = candList as unknown as JsonValue;
      w.pulse = { counter: 1, open: null, last: null };
      w.rounds = [];
      w.objectives = [];
    },
  );

  if (overrides.registerAgent ?? true) {
    agentRegisterCommand({
      run,
      agent: overrides.agentId ?? "orch-1",
      role: overrides.agentRole ?? "orchestrator",
      host: "test-host",
    });
  }
  return { repo, run };
}

function createPriorRoundCapsule(
  repoRoot: string,
  runId: string,
  overrides: {
    tasks?: Record<string, unknown>;
    requirements?: readonly Record<string, unknown>[];
  } = {},
): string {
  const capsulePath = initRun(repoRoot, runId, Buffer.from("Prior"), "file", true);
  transact(capsulePath, "init", "plan-initialized", { prompt: "Prior" }, (w) => {
    w.tasks = (overrides.tasks ?? {
      "task-1": {
        id: "task-1",
        status: "completed",
        write_scope: ["src/parser.ts"],
        findings: [
          { id: "find-1", status: "unresolved", severity: "critical", observation: "bug" },
          { id: "find-2", status: "resolved", severity: "low", observation: "fixed" },
        ],
      },
    }) as unknown as JsonValue;
    w.requirements = (overrides.requirements ?? [
      { id: "req-1", statement: "parse", status: "unsatisfied" },
      { id: "req-2", statement: "ast", status: "satisfied" },
    ]) as unknown as JsonValue;
  });
  return capsulePath;
}

describe("Phase 4 Hierarchy and Regression Integration Suite", () => {
  describe("1. Role Contracts Reconciliation and Registry Invariants", () => {
    test("orchestrator and coordinator role contracts are reconciled without orchestrator:run or dual-role prose", () => {
      const orch = loadRoleContract("orchestrator");
      expect(orch.tier).toBe(1);
      expect(orch.spawns).toContain("coordinator");
      expect(orch.commands).not.toContain("orchestrator:run");

      const coord = loadRoleContract("coordinator");
      expect(coord.tier).toBe(2);
      expect(coord.spawns).toContain("planner");
      expect(coord.spawns).toContain("implementer");
      expect(coord.spawns).toContain("validator");
      expect(coord.commands).not.toContain("orchestrator:run");
      expect(coord.commands).not.toContain("mind:round-open");

      const rawContent = readFileSync(resolveRoleContractPath("coordinator"), "utf-8");
      expect(rawContent).not.toContain("orchestrator:run");
    });

    test("no role contract grants unconditionally throwing commands and all commands exist in registry", () => {
      const unconditionallyThrowing = new Set(["orchestrator:run"]);
      const deprecatedAliases = new Set(["thread:identify", "authority:whoami"]);
      for (const role of AGENT_ROLES) {
        const contract = loadRoleContract(role);
        for (const cmd of contract.commands) {
          if (deprecatedAliases.has(cmd)) continue;
          expect(findCommand(cmd)).toBeDefined();
          expect(unconditionallyThrowing.has(cmd)).toBe(false);
        }
      }
      for (const spec of COMMAND_REGISTRY) {
        expect(spec.name).toMatch(/^[a-z][a-z-]*(?::[a-z][a-z-]*)*$/u);
        expect(typeof spec.handler).toBe("function");
        expect(spec.domain).toBeDefined();
      }
    });
  });

  describe("2. Strict Hierarchical Spawning and Packet Evidence Spine", () => {
    test("strict tier spawning constraints: mind -> orch -> coord -> tier 3 execution roles", () => {
      expect(validateTierSpawn("mind", "orchestrator").ok).toBe(true);
      expect(() => assertTierSpawn("mind", "orchestrator")).not.toThrow();
      for (const role of [
        "coordinator",
        "implementer",
        "validator",
        "planner",
        "repairer",
      ] as const) {
        expect(validateTierSpawn("mind", role).ok).toBe(false);
        expect(() => assertTierSpawn("mind", role)).toThrow(HarnessError);
      }

      expect(validateTierSpawn("orchestrator", "coordinator").ok).toBe(true);
      expect(() => assertTierSpawn("orchestrator", "coordinator")).not.toThrow();
      for (const role of ["mind", "implementer", "validator", "planner", "repairer"] as const) {
        expect(validateTierSpawn("orchestrator", role).ok).toBe(false);
        expect(() => assertTierSpawn("orchestrator", role)).toThrow(HarnessError);
      }

      for (const role of [
        "implementer",
        "validator",
        "planner",
        "repairer",
        "completeness-critic",
      ] as const) {
        expect(validateTierSpawn("coordinator", role).ok).toBe(true);
        expect(() => assertTierSpawn("coordinator", role)).not.toThrow();
      }
      for (const parent of ["mind", "orchestrator"] as const) {
        expect(validateTierSpawn("coordinator", parent).ok).toBe(false);
        expect(() => assertTierSpawn("coordinator", parent)).toThrow(HarnessError);
      }

      for (const role of AGENT_ROLES) {
        expect(validateTierSpawn(role, role).ok).toBe(false);
      }
    });

    test("tier 1 deployment packet builds authoritative evidence spine with 0 model telemetry", () => {
      const mindContract = loadMindContract();
      expect(mindContract.tier).toBe(0);
      expect(mindContract.spawns).toEqual(["orchestrator"]);

      const input: Tier1DeploymentPacketInput = {
        runId: "mind-reg-run",
        agentId: "orch-reg-1",
        candidateStatement: "Repair memory leak in streamer",
        witnessCommandId: "cmd-stream-witness",
        charterGoalIds: ["G1"],
        remainingRoundBudget: 2,
        remainingWallClockBudgetMs: 7_200_000,
        profile: "deliberate",
        prohibitions: DEFAULT_PROHIBITIONS,
      };

      const packet = buildTier1DeploymentPacket(input);
      expect(packet.role).toBe("orchestrator");
      expect(packet.objective.evidence_class).toBe("agent_reported");
      expect(packet.witness_command_id.evidence_class).toBe("harness_observed");
      expect(packet.charter_goal_ids.evidence_class).toBe("harness_observed");
      expect(packet.round_budget.evidence_class).toBe("derived");
      expect(packet.profile.evidence_class).toBe("agent_reported");
      expect(packet.profile.value).toBe("deliberate");
      expect(packet.packet_sha256).toMatch(/^[0-9a-f]{64}$/u);

      const serialized = JSON.stringify(packet);
      expect(serialized).not.toContain('"model"');
      expect(serialized).not.toContain('"model_tier"');
      expect(serialized).not.toContain('"thinking_level"');
      expect(() => assertNoModelTelemetry(packet)).not.toThrow();
    });

    test("createTier1DeployInputFromCandidate enforces admission status and witness command", () => {
      const cand: CandidateRecord = {
        id: "cand-10",
        kind: "defect",
        statement: "Fix lock",
        witness_command_id: "cmd-witness-10",
        charter_goal_ids: ["G1"],
        write_scope: ["src/lock.ts"],
        status: "admitted",
      };
      const charter: ParsedCharter = {
        identity: "Mind",
        goals: [{ id: "G1", statement: "Goal" }],
        goalIds: ["G1"],
        nonGoals: [],
        repoRoots: ["src/"],
        prohibitions: DEFAULT_PROHIBITIONS,
        rawText: "C",
        sha256: "abc",
      };
      const budget: MindBudget = {
        ...DEFAULT_MIND_BUDGET,
        day_key: "2026-08-21",
        pulses_today: 1,
        wall_clock_ms_today: 100_000,
      };

      const deployInput = createTier1DeployInputFromCandidate(
        cand,
        charter,
        budget,
        "run-1",
        "orch-1",
      );
      expect(deployInput.candidateStatement).toBe("Fix lock");
      expect(deployInput.witnessCommandId).toBe("cmd-witness-10");

      expect(() =>
        createTier1DeployInputFromCandidate(
          { ...cand, status: "opened" },
          charter,
          budget,
          "run-1",
          "orch-1",
        ),
      ).toThrow(HarnessError);
    });
  });

  describe("3. Round Lifecycle Integration and Chainer Carryover", () => {
    test("mindRoundOpenCommand opens round, checks budget, and refuses invalid conditions", () => {
      const fixture = createMindTestCapsule(import.meta.path, "open-lifecycle", {
        candidates: [
          { id: "cand-admitted", status: "admitted", statement: "fix parser race condition" },
          { id: "cand-unadmitted", status: "opened", statement: "unadmitted issue" },
        ],
      });

      const res = mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-parser-race",
        candidate: "cand-admitted",
      });
      expect(res.round).toBe(1);
      expect(res.candidate_id).toBe("cand-admitted");
      expect(getAllRounds(loadRun(fixture.run, false).state).length).toBe(1);
      expect(
        getOpenRoundForObjective(loadRun(fixture.run, false).state, "obj-parser-race"),
      ).toBeDefined();

      expect(() =>
        mindRoundOpenCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-unadmitted",
          candidate: "cand-unadmitted",
        }),
      ).toThrow(/is not admitted/);
      expect(() =>
        mindRoundOpenCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-drift",
          candidate: "cand-admitted",
          statement: "drift",
        }),
      ).toThrow(/objective statement drifted/);
      expect(() =>
        mindRoundOpenCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-parser-race",
          candidate: "cand-admitted",
        }),
      ).toThrow(/already open for objective/);

      const priorLeasedPath = createPriorRoundCapsule(fixture.repo, "round-prior-leased", {
        tasks: {
          "task-1": {
            id: "task-1",
            status: "leased",
            lease: { agent: "worker-1", expires_at: new Date(Date.now() + 600_000).toISOString() },
          },
        },
      });
      expect(() =>
        mindRoundOpenCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-chain-lease",
          candidate: "cand-admitted",
          "chain-from": priorLeasedPath,
        }),
      ).toThrow(/has a live lease/);
    });

    test("mindRoundCloseCommand enforces arming rails, result invariants, and updates state", () => {
      const fixture = createMindTestCapsule(import.meta.path, "close-lifecycle");
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-close-test",
        candidate: "cand-1",
      });

      expect(() =>
        mindRoundCloseCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-close-test",
          round: "1",
          result: "converged",
        }),
      ).toThrow(/a round may not close without either an armed successor/);
      expect(() =>
        mindRoundCloseCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-close-test",
          round: "1",
          result: "bad-result",
          "terminal-reason": "done",
        }),
      ).toThrow(/invalid round result/);

      const closeRes = mindRoundCloseCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-close-test",
        round: "1",
        result: "converged",
        "terminal-reason": "resolved defect",
      });
      expect(closeRes.result).toBe("converged");
      expect(closeRes.terminal_reason).toBe("resolved defect");

      const closed = getAllRounds(loadRun(fixture.run, false).state)[0]!;
      expect(closed.status).toBe("closed");
      expect(closed.result).toBe("converged");
    });

    test("carryForwardFindingsAndRequirements carries forward findings and requirements into multi-round reconcile", () => {
      const fixture = createMindTestCapsule(import.meta.path, "chainer-reconcile");
      const r1Path = createPriorRoundCapsule(fixture.repo, "round-chain-r1");
      const targetPath = join(fixture.repo, ".olt", "capsules", "round-chain-r2");
      mkdirSync(targetPath, { recursive: true });

      const manifest = carryForwardFindingsAndRequirements({
        sourceRunId: "round-chain-r1",
        targetRunId: "round-chain-r2",
        sourceCapsulePath: r1Path,
        targetCapsulePath: targetPath,
        roundNumber: 2,
      });
      expect(manifest.carryoverRequirements).toEqual(["req-1"]);
      expect(manifest.unresolvedFindingIds).toEqual(["find-1"]);
      expect(existsSync(join(targetPath, "chain_manifest.json"))).toBe(true);

      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-chain",
        candidate: "cand-1",
        round: "1",
      });
      mindRoundCloseCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-chain",
        round: "1",
        result: "exhausted",
        successor: "round-chain-r2",
      });
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-chain",
        candidate: "cand-1",
        round: "2",
        "chain-from": r1Path,
      });
      mindRoundCloseCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-chain",
        round: "2",
        result: "converged",
        "terminal-reason": "resolved",
      });

      const reconciled = reconcileRoundState(loadRun(fixture.run, false).state, "obj-chain");
      expect(reconciled.totalRoundsCount).toBe(2);
      expect(reconciled.activeRounds.length).toBe(0);
      expect(reconciled.objectives[0]!.status).toBe("converged");
      expect(reconciled.objectives[0]!.current_round).toBe(2);
    });
  });

  describe("4. Abstract Profiles, Host Degradation, and 0 Vendor Models", () => {
    test("canonical role to profile mapping strictly obeys PLAN §10 / PHASE-4 §3.4", () => {
      expect(roleToProfile("mind")).toBe("deliberate");
      expect(roleToProfile("orchestrator")).toBe("deliberate");
      expect(roleToProfile("coordinator")).toBe("default");
      expect(roleToProfile("planner")).toBe("deliberate");
      expect(roleToProfile("implementer")).toBe("default");
      expect(roleToProfile("repairer")).toBe("default");
      expect(roleToProfile("sub-implementer")).toBe("default");
      expect(roleToProfile("validator")).toBe("adversarial");
      expect(roleToProfile("critic")).toBe("adversarial");
      expect(roleToProfile("completeness-critic")).toBe("adversarial");
      expect(roleToProfile("plan-validator")).toBe("adversarial");
      expect(roleToProfile("sub-validator")).toBe("adversarial");
      expect(roleToProfile("sub-investigator")).toBe("cheap_bulk");
    });

    test("abstract profiles validate cleanly and concrete model strings are rejected", () => {
      for (const profile of ABSTRACT_PROFILES) {
        expect(isAbstractProfile(profile)).toBe(true);
        expect(validateAbstractProfile(profile).ok).toBe(true);
      }
      for (const model of ["claude-3-5-sonnet", "gpt-4o", "gemini-2.0-flash", "deepseek-r1"]) {
        expect(isAbstractProfile(model)).toBe(false);
        expect(validateAbstractProfile(model).ok).toBe(false);
        expect(() => assertAbstractProfile(model)).toThrow(HarnessError);
      }
    });

    test("unbound profiles resolve to unknown, and host degrades honestly without per-agent selection", () => {
      const unbound = resolveProfile("deliberate");
      expect(unbound.bound).toBe(false);
      expect(unbound.model).toBe("unknown");
      expect(unbound.model_tier).toBe("unknown");

      expect(formatHostDegradation("antigravity")).toBe(
        "per-agent model selection unavailable on antigravity",
      );
      expect(isPerAgentModelSelectionSupported()).toBe(false);

      const unsupp = resolveAgentProfile("validator", "antigravity");
      expect(unsupp.profile).toBe("adversarial");
      expect(unsupp.supportedOnHost).toBe(false);
      expect(unsupp.limitation).toBe("per-agent model selection unavailable on antigravity");

      const bindings: ProfileBindings = {
        adversarial: { thinking_level: "high", model_tier: "l" },
      };
      const supp = resolveAgentProfile(
        "validator",
        "codex",
        { per_agent_model_selection: evidenced(true, "derived") },
        bindings,
      );
      expect(supp.profile).toBe("adversarial");
      expect(supp.supportedOnHost).toBe(true);
      expect(supp.thinking_level).toEqual(evidenced("high", "agent_reported"));
      expect(supp.model_tier).toEqual(evidenced("l", "agent_reported"));
    });
  });

  describe("5. Deliberate Damage, Mutation Isolation, and Refusal Invariants", () => {
    test("refusals leave capsule event stream and state completely unmutated", () => {
      const fixture = createMindTestCapsule(import.meta.path, "mutation-isolation");
      mindRoundOpenCommand({
        run: fixture.run,
        actor: "orch-1",
        objective: "obj-iso",
        candidate: "cand-1",
      });

      const before = loadRun(fixture.run, false);
      const eventsBefore = before.events.length;
      const headBefore = before.manifest.event_head;

      let openThrew = false;
      try {
        mindRoundOpenCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-iso",
          candidate: "cand-1",
        });
      } catch (err: unknown) {
        openThrew = true;
        expect(String(err)).toContain("already open");
      }
      expect(openThrew).toBe(true);

      let closeThrew = false;
      try {
        mindRoundCloseCommand({
          run: fixture.run,
          actor: "orch-1",
          objective: "obj-iso",
          round: "1",
          result: "converged",
        });
      } catch (err: unknown) {
        closeThrew = true;
        expect(String(err)).toContain("a round may not close without either an armed successor");
      }
      expect(closeThrew).toBe(true);

      const after = loadRun(fixture.run, false);
      expect(after.events.length).toBe(eventsBefore);
      expect(after.manifest.event_head).toBe(headBefore);
    });

    test("unauthorized role attempting round operations leaves state unmutated", () => {
      const fixture = createMindTestCapsule(import.meta.path, "unauth-isolation", {
        registerAgent: false,
      });
      agentRegisterCommand({
        run: fixture.run,
        agent: "impl-bad",
        role: "implementer",
        host: "antigravity",
      });

      const before = loadRun(fixture.run, false);
      let threw = false;
      try {
        mindRoundOpenCommand({
          run: fixture.run,
          actor: "impl-bad",
          objective: "obj-unauth",
          candidate: "cand-1",
        });
      } catch (err: unknown) {
        threw = true;
        expect(String(err)).toContain("role 'orchestrator' or 'mind' is required");
      }
      expect(threw).toBe(true);
      expect(loadRun(fixture.run, false).events.length).toBe(before.events.length);
    });
  });
});
