import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentIdToRole,
  agentIdToTier,
  buildCapabilitiesProfile,
  detectHostApp,
  formatThreadIdentificationBrief,
  identifyExecutionContext,
  isStandardAgentId,
  parseStandardAgentId,
  parseTierValue,
  recommendStandardAgentId,
  recordDefect,
  roleToTier,
  MAIN_THREAD_ADVISORY,
  TIER_NAMES,
  validateAgentNamingConvention,
  validateTierSpawning,
  type DefectRecord,
  type ExecutionTier,
} from "../../olt/scripts/src/authority/thread/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

import { scratchRoot } from "../shared/scratch-root.ts";

function defectFixture(cwd: string, id: string) {
  return {
    id,
    type: "main_thread_direct_execution" as const,
    severity: "critical" as const,
    timestamp: new Date().toISOString(),
    pid: 1234,
    ppid: 1,
    agent_id: "main-user",
    observation: "Direct file modification on main thread",
    remediation: "Dispatch Tier 2 coordinator",
    context: {
      cwd,
      indicators: { TEST: "1" },
    },
  };
}

function expectIntegrityDefectWriteFailure(action: () => void, defectId: string): void {
  try {
    action();
    throw new Error("expected defect write to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessError);
    if (error instanceof HarnessError) {
      expect(error.code).toBe("INTEGRITY");
      expect(error.message).toContain(defectId);
      expect(error.message).toContain("defects.jsonl");
    }
  }
}

describe("Thread Identifier - 4-Tier Authority & Spawning Rules", () => {
  test("TIER_NAMES explicitly defines all 4 execution tiers", () => {
    expect(TIER_NAMES[0]).toContain("Tier 0: Mind Lead");
    expect(TIER_NAMES[1]).toContain("Tier 1: Orchestrator Lead");
    expect(TIER_NAMES[2]).toContain("Tier 2: Coordinator Lead");
    expect(TIER_NAMES[3]).toContain("Tier 3: Implementer / Validator");
  });

  test("parseTierValue parses strings into correct execution tiers", () => {
    // Tier 0
    expect(parseTierValue("0")).toBe(0);
    expect(parseTierValue("tier-0")).toBe(0);
    expect(parseTierValue("tier_0")).toBe(0);
    expect(parseTierValue("tier 0")).toBe(0);
    expect(parseTierValue("mind")).toBe(0);
    expect(parseTierValue("human")).toBe(0);
    expect(parseTierValue("Tier 0: Mind Lead")).toBe(0);

    // Tier 1
    expect(parseTierValue("1")).toBe(1);
    expect(parseTierValue("tier-1")).toBe(1);
    expect(parseTierValue("tier_1")).toBe(1);
    expect(parseTierValue("tier 1")).toBe(1);
    expect(parseTierValue("orchestrator")).toBe(1);
    expect(parseTierValue("orch")).toBe(1);
    expect(parseTierValue("mind-auditor")).toBe(1);
    expect(parseTierValue("auditor")).toBe(1);

    // Tier 2
    expect(parseTierValue("2")).toBe(2);
    expect(parseTierValue("tier-2")).toBe(2);
    expect(parseTierValue("tier_2")).toBe(2);
    expect(parseTierValue("tier 2")).toBe(2);
    expect(parseTierValue("coordinator")).toBe(2);
    expect(parseTierValue("coord")).toBe(2);

    // Tier 3
    expect(parseTierValue("3")).toBe(3);
    expect(parseTierValue("tier-3")).toBe(3);
    expect(parseTierValue("tier_3")).toBe(3);
    expect(parseTierValue("tier 3")).toBe(3);
    expect(parseTierValue("implementer")).toBe(3);
    expect(parseTierValue("validator")).toBe(3);
    expect(parseTierValue("critic")).toBe(3);
    expect(parseTierValue("completeness-critic")).toBe(3);
    expect(parseTierValue("repairer")).toBe(3);
    expect(parseTierValue("planner")).toBe(3);
    expect(parseTierValue("plan-validator")).toBe(3);

    // Null/Invalid
    expect(parseTierValue(undefined)).toBeNull();
    expect(parseTierValue("")).toBeNull();
    expect(parseTierValue("invalid")).toBeNull();
    expect(parseTierValue("unknown-tier")).toBeNull();
  });

  test("roleToTier maps standard roles to tiers", () => {
    expect(roleToTier("mind")).toBe(0);
    expect(roleToTier("human")).toBe(0);
    expect(roleToTier("user")).toBe(0);
    expect(roleToTier("orchestrator")).toBe(1);
    expect(roleToTier("orch-lead")).toBe(1);
    expect(roleToTier("mind-auditor")).toBe(1);
    expect(roleToTier("auditor")).toBe(1);
    expect(roleToTier("coordinator")).toBe(2);
    expect(roleToTier("coord-1")).toBe(2);
    expect(roleToTier("implementer")).toBe(3);
    expect(roleToTier("validator")).toBe(3);
    expect(roleToTier("repairer")).toBe(3);
    expect(roleToTier("random-worker")).toBe(3);
  });

  test("agentIdToTier and agentIdToRole infer tier and role from naming conventions", () => {
    expect(agentIdToTier("mind-0")).toBe(0);
    expect(agentIdToRole("mind-0")).toBe("mind");

    expect(agentIdToTier("mind-audit-1")).toBe(1);
    expect(agentIdToRole("mind-audit-1")).toBe("mind-auditor");

    expect(agentIdToTier("orch-lead")).toBe(1);
    expect(agentIdToRole("orch-lead")).toBe("orchestrator");

    expect(agentIdToTier("coord-alpha")).toBe(2);
    expect(agentIdToRole("coord-alpha")).toBe("coordinator");

    expect(agentIdToTier("impl-task-1")).toBe(3);
    expect(agentIdToRole("impl-task-1")).toBe("implementer");

    expect(agentIdToTier("val-task-1")).toBe(3);
    expect(agentIdToRole("val-task-1")).toBe("validator");

    expect(agentIdToTier("critic-task-1")).toBe(3);
    expect(agentIdToRole("critic-task-1")).toBe("completeness-critic");

    expect(agentIdToTier("repair-task-1")).toBe(3);
    expect(agentIdToRole("repair-task-1")).toBe("repairer");

    expect(agentIdToTier("plan-val-1")).toBe(3);
    expect(agentIdToRole("plan-val-1")).toBe("plan-validator");

    expect(agentIdToTier("plan-1")).toBe(3);
    expect(agentIdToRole("plan-1")).toBe("planner");

    expect(agentIdToTier("unknown-agent")).toBeNull();
    expect(agentIdToRole("unknown-agent")).toBeNull();
  });

  test("validateTierSpawning validates valid and invalid spawning transitions", () => {
    // Valid 4-tier transitions
    expect(validateTierSpawning(0, 1).allowed).toBe(true);
    expect(validateTierSpawning(1, 2).allowed).toBe(true);
    expect(validateTierSpawning(2, 3).allowed).toBe(true);
    expect(validateTierSpawning(3, 3).allowed).toBe(true);

    // Invalid transitions
    expect(validateTierSpawning(0, 0).allowed).toBe(false); // Mind -> Mind
    expect(validateTierSpawning(0, 2).allowed).toBe(false); // Mind -> Coordinator
    expect(validateTierSpawning(0, 3).allowed).toBe(false); // Mind -> Implementer
    expect(validateTierSpawning(1, 0).allowed).toBe(false); // Orchestrator -> Mind
    expect(validateTierSpawning(1, 1).allowed).toBe(false); // Orchestrator -> Orchestrator
    expect(validateTierSpawning(1, 3).allowed).toBe(false); // Orchestrator -> Implementer
    expect(validateTierSpawning(2, 0).allowed).toBe(false); // Coordinator -> Mind
    expect(validateTierSpawning(2, 1).allowed).toBe(false); // Coordinator -> Orchestrator
    expect(validateTierSpawning(2, 2).allowed).toBe(false); // Coordinator -> Coordinator
    expect(validateTierSpawning(3, 0).allowed).toBe(false); // Implementer -> Mind
    expect(validateTierSpawning(3, 1).allowed).toBe(false); // Implementer -> Orchestrator
    expect(validateTierSpawning(3, 2).allowed).toBe(false); // Implementer -> Coordinator
  });

  test("identifyExecutionContext correctly detects Tier 0 (Mind Lead / Interactive Main)", () => {
    // Interactive main thread
    const mainCtx = identifyExecutionContext({
      isInteractiveMainThread: true,
      env: { NODE_ENV: "test" },
    });
    expect(mainCtx.tier).toBe(0);
    expect(mainCtx.is_main_thread).toBe(true);
    expect(mainCtx.compliance_state).toBe("restrained");
    expect(mainCtx.advisory).toContain("MAIN THREAD RESTRAINT ACTIVE");
    expect(mainCtx.defect).toBeNull();

    // Session-based main thread without subagent headers
    const sessionCtx = identifyExecutionContext({
      env: {
        CONVERSATION_ID: "conv-12345",
      },
    });
    expect(sessionCtx.tier).toBe(0);
    expect(sessionCtx.is_main_thread).toBe(true);
    expect(sessionCtx.compliance_state).toBe("restrained");

    // Explicit Tier 0
    const explicitTier0 = identifyExecutionContext({
      tier: 0,
      isInteractiveMainThread: false,
    });
    expect(explicitTier0.tier).toBe(0);
    expect(explicitTier0.role).toBe("mind");
    expect(explicitTier0.is_main_thread).toBe(false);
    expect(explicitTier0.compliance_state).toBe("compliant");
  });

  test("identifyExecutionContext correctly detects Tier 1 (Orchestrator Lead)", () => {
    const orchCtx = identifyExecutionContext({
      role: "orchestrator",
      agentId: "orch-lead-1",
      env: {
        HARNESS_EXECUTION_TIER: "1",
        HARNESS_AGENT_ROLE: "orchestrator",
        HARNESS_AGENT_ID: "orch-lead-1",
      },
    });
    expect(orchCtx.tier).toBe(1);
    expect(orchCtx.role).toBe("orchestrator");
    expect(orchCtx.agent_id).toBe("orch-lead-1");
    expect(orchCtx.is_main_thread).toBe(false);
    expect(orchCtx.compliance_state).toBe("compliant");
    expect(orchCtx.capabilities.command_taxonomy).toContain("Orchestration");
  });

  test("identifyExecutionContext correctly detects Tier 2 (Coordinator Lead)", () => {
    const coordCtx = identifyExecutionContext({
      role: "coordinator",
      agentId: "coord-test",
      env: {
        HARNESS_AGENT_ROLE: "coordinator",
        HARNESS_AGENT_ID: "coord-test",
      },
    });

    expect(coordCtx.tier).toBe(2);
    expect(coordCtx.role).toBe("coordinator");
    expect(coordCtx.agent_id).toBe("coord-test");
    expect(coordCtx.is_main_thread).toBe(false);
    expect(coordCtx.compliance_state).toBe("compliant");
    expect(coordCtx.capabilities.command_taxonomy).toContain("Coordination");
  });

  test("identifyExecutionContext correctly detects Tier 3 (Implementer / Validator / Repairer)", () => {
    const implCtx = identifyExecutionContext({
      agentId: "impl-wave-1",
      env: {
        HARNESS_AGENT_ID: "impl-wave-1",
      },
    });
    expect(implCtx.tier).toBe(3);
    expect(implCtx.role).toBe("implementer");
    expect(implCtx.agent_id).toBe("impl-wave-1");
    expect(implCtx.is_main_thread).toBe(false);
    expect(implCtx.compliance_state).toBe("compliant");
    expect(implCtx.capabilities.command_taxonomy).toContain("Implementation");

    const valCtx = identifyExecutionContext({
      role: "validator",
      agentId: "val-wave-1",
    });
    expect(valCtx.tier).toBe(3);
    expect(valCtx.role).toBe("validator");
    expect(valCtx.agent_id).toBe("val-wave-1");
  });

  test("detectHostApp identifies host applications correctly", () => {
    expect(detectHostApp({ CLAUDE_CODE_VERSION: "1.0.0" })).toBe("Claude Code");
    expect(detectHostApp({ CLAUDE_CLI: "1" })).toBe("Claude Code");
    expect(detectHostApp({ ANTIGRAVITY_CLI: "1" })).toBe("Antigravity/Gemini CLI");
    expect(detectHostApp({ GEMINI_CLI: "1" })).toBe("Antigravity/Gemini CLI");
    expect(detectHostApp({ TERM_PROGRAM: "cursor" })).toBe("Cursor");
    expect(detectHostApp({ CURSOR_VERSION: "0.40.0" })).toBe("Cursor");
    expect(detectHostApp({ OPENCODE_CLI: "1" })).toBe("OpenCode");
    expect(detectHostApp({ CODEX_CLI: "1" })).toBe("Codex");
    expect(detectHostApp({ TERM_PROGRAM: "vscode" })).toBe("VSCode Terminal");
    expect(detectHostApp({})).toBe("Generic Host");
  });

  test("buildCapabilitiesProfile reflects tier sandbox taxonomy and tools", () => {
    const tier0Caps = buildCapabilitiesProfile(0, {
      GRANTED_TOOLS: "bash, read_file, write_file",
      ENVIRONMENT_GRANTS: "root, network",
    });
    expect(tier0Caps.command_taxonomy).toContain("Full Root");
    expect(tier0Caps.tools).toEqual(["bash", "read_file", "write_file"]);
    expect(tier0Caps.environment_grants).toEqual(["root", "network"]);

    const tier1Caps = buildCapabilitiesProfile(1, {});
    expect(tier1Caps.command_taxonomy).toContain("Orchestration");

    const tier2Caps = buildCapabilitiesProfile(2, {});
    expect(tier2Caps.command_taxonomy).toContain("Coordination");

    const tier3Caps = buildCapabilitiesProfile(3, {});
    expect(tier3Caps.command_taxonomy).toContain("Implementation");
  });

  test("formatThreadIdentificationBrief formats markdown summary accurately", () => {
    const context = identifyExecutionContext({
      role: "coordinator",
      agentId: "coord-test",
      env: {
        GRANTED_TOOLS: "task_claim, task_submit",
      },
    });

    const brief = formatThreadIdentificationBrief(context);
    expect(brief).toContain("### Thread Authority Identification (`whoami`)");
    expect(brief).toContain("Tier 2");
    expect(brief).toContain("coord-test");
    expect(brief).toContain("COMPLIANT");
    expect(brief).toContain("task_claim, task_submit");
  });

  test("recordDefect persists defect log into runRoot or capsules dir", () => {
    const dir = scratchRoot(import.meta.path, "defect-log");
    const defectRecord = defectFixture(dir, "defect-test-123");

    recordDefect(defectRecord, { runRoot: dir });
    recordDefect(defectRecord, { runRoot: dir });
    const defectsFile = join(dir, "defects.jsonl");
    expect(existsSync(defectsFile)).toBe(true);
    const content = readFileSync(defectsFile, "utf8");
    expect(content.split("\n").filter(Boolean)).toHaveLength(2);
    expect(content).toContain("defect-test-123");
    expect(content).toContain("main_thread_direct_execution");

    const defaultCwd = scratchRoot(import.meta.path, "defect-log-default-cwd");
    expect(() => recordDefect(defectRecord, { cwd: defaultCwd })).not.toThrow();
    expect(existsSync(join(defaultCwd, ".olt", "defects.jsonl"))).toBeTrue();
  });

  test("recordDefect fails closed when the resolved ledger is a directory", () => {
    const dir = scratchRoot(import.meta.path, "defect-directory");
    const ledger = join(dir, "defects.jsonl");
    mkdirSync(ledger);
    const defectRecord = defectFixture(dir, "defect-directory-123");

    expectIntegrityDefectWriteFailure(
      () => recordDefect(defectRecord, { runRoot: dir }),
      defectRecord.id,
    );
  });

  test("recordDefect rejects final symlinks without changing an external ledger", () => {
    if (process.platform === "win32") return;
    const dir = scratchRoot(import.meta.path, "defect-symlink");
    const external = join(dir, "external-defects.jsonl");
    const ledger = join(dir, "defects.jsonl");
    writeFileSync(external, "external\n");
    symlinkSync(external, ledger);
    const defectRecord = defectFixture(dir, "defect-symlink-123");

    expectIntegrityDefectWriteFailure(
      () => recordDefect(defectRecord, { runRoot: dir }),
      defectRecord.id,
    );
    expect(readFileSync(external, "utf8")).toBe("external\n");
  });

  test("recordDefect wraps cyclic and BigInt serialization failures as INTEGRITY", () => {
    const dir = scratchRoot(import.meta.path, "defect-serialization");
    const cyclic = defectFixture(dir, "defect-cyclic-123") as DefectRecord & { loop?: unknown };
    cyclic.loop = cyclic;
    expectIntegrityDefectWriteFailure(() => recordDefect(cyclic, { runRoot: dir }), cyclic.id);

    const bigint = defectFixture(dir, "defect-bigint-123") as DefectRecord & { sequence?: unknown };
    bigint.sequence = 1n;
    expectIntegrityDefectWriteFailure(() => recordDefect(bigint, { runRoot: dir }), bigint.id);
  });

  test("recordDefect refuses serialization that produces no JSON record", () => {
    const dir = scratchRoot(import.meta.path, "defect-empty-serialization");
    const defect = defectFixture(dir, "defect-empty-123") as DefectRecord & {
      toJSON?: () => undefined;
    };
    defect.toJSON = () => undefined;
    expectIntegrityDefectWriteFailure(() => recordDefect(defect, { runRoot: dir }), defect.id);
    expect(existsSync(join(dir, "defects.jsonl"))).toBeFalse();
  });

  test("recordDefect does not invoke hostile error getters while reporting serialization failure", () => {
    const dir = scratchRoot(import.meta.path, "defect-hostile-error");
    const hostile = Object.create(null) as { message?: unknown };
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("hostile getter must not run");
      },
    });
    const defect = defectFixture(dir, "defect-hostile-123") as DefectRecord & {
      toJSON?: () => never;
    };
    defect.toJSON = () => {
      throw hostile;
    };
    try {
      recordDefect(defect, { runRoot: dir });
      throw new Error("expected hostile serialization to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      if (error instanceof HarnessError) {
        expect(error.code).toBe("INTEGRITY");
        expect(error.message).toContain("unavailable error detail");
      }
    }
  });

  test("identifyExecutionContext propagates durable defect persistence failures without a success result", () => {
    if (process.platform === "win32") return;
    const runRoot = scratchRoot(import.meta.path, "thread-defect-durability-failure");
    const external = join(runRoot, "external-defects.jsonl");
    const ledger = join(runRoot, "defects.jsonl");
    writeFileSync(external, "external\n");
    symlinkSync(external, ledger);
    const moduleUrl = new URL("../../../olt/scripts/src/authority/thread/index.ts", import.meta.url)
      .href;
    const script = `
      import { identifyExecutionContext } from ${JSON.stringify(moduleUrl)};
      try {
        identifyExecutionContext({
          isInteractiveMainThread: true,
          runRoot: ${JSON.stringify(runRoot)},
          agentId: "mind-0",
          argv: ["bun", "harness.ts", "task:submit"],
        });
        process.exit(91);
      } catch (error) {
        process.exit(error && error.code === "INTEGRITY" ? 0 : 92);
      }
    `;
    const child = Bun.spawnSync([process.execPath, "--eval", script], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(child.exitCode).toBe(0);
    expect(readFileSync(external, "utf8")).toBe("external\n");
  });

  test("validateTierSpawning returns detailed rejection reasons across role boundaries", () => {
    const t3to0 = validateTierSpawning(3, 0, "implementer", "mind");
    expect(t3to0.allowed).toBe(false);
    expect(t3to0.reason).toContain(
      "Tier 3 worker cannot spawn Tier 0 (mind) (role escalation violation)",
    );

    const t3to1 = validateTierSpawning(3, 1, "implementer", "orchestrator");
    expect(t3to1.allowed).toBe(false);
    expect(t3to1.reason).toContain(
      "Tier 3 worker cannot spawn Tier 1 (orchestrator) (role escalation violation)",
    );

    const t3to2 = validateTierSpawning(3, 2, "implementer", "coordinator");
    expect(t3to2.allowed).toBe(false);
    expect(t3to2.reason).toContain(
      "Tier 3 worker cannot spawn Tier 2 (coordinator) (role escalation violation)",
    );

    const t0to2 = validateTierSpawning(0, 2, "mind", "coordinator");
    expect(t0to2.allowed).toBe(false);
    expect(t0to2.reason).toContain("Tier 0 Mind Lead cannot directly spawn Tier 2");

    const t1to3 = validateTierSpawning(1, 3, "orchestrator", "implementer");
    expect(t1to3.allowed).toBe(false);
    expect(t1to3.reason).toContain("Tier 1 Orchestrator Lead cannot directly spawn Tier 3");

    const t2to0 = validateTierSpawning(2, 0, "coordinator", "mind");
    expect(t2to0.allowed).toBe(false);
    expect(t2to0.reason).toContain("Tier 2 Coordinator Lead cannot deploy Tier 0");

    const invalidTier = validateTierSpawning(9 as unknown as ExecutionTier, 3);
    expect(invalidTier.allowed).toBe(false);
    expect(invalidTier.reason).toContain("Invalid tier hierarchy transition");
  });

  test("formatThreadIdentificationBrief formats violation and restrained states", () => {
    const restrainedCtx = identifyExecutionContext({
      isInteractiveMainThread: true,
      env: {},
    });
    const restrainedBrief = formatThreadIdentificationBrief(restrainedCtx);
    expect(restrainedBrief).toContain("RESTRAINED");
    expect(restrainedBrief).toContain("Main Interactive Agent Thread");

    const violationCtx = identifyExecutionContext({
      tier: 3,
      role: "implementer",
      agentId: "impl-test",
      env: {
        CONVERSATION_ID: "conv-main-violation",
      },
      isInteractiveMainThread: false,
    });
    const violationBrief = formatThreadIdentificationBrief(violationCtx);
    expect(violationBrief).toContain("Tier 3");
  });
});

describe("Standardized Agent Naming System (AGENT_NAMING_STANDARDS)", () => {
  test("parseStandardAgentId parses standard agent IDs correctly", () => {
    // Mind (Tier 0)
    const mindParsed = parseStandardAgentId("mind_pulse-gen-1");
    expect(mindParsed).not.toBeNull();
    expect(mindParsed?.role).toBe("mind");
    expect(mindParsed?.tier).toBe(0);
    expect(mindParsed?.bindingType).toBe("pulse");
    expect(mindParsed?.contextOrTaskId).toBe("pulse-gen-1");

    // Orchestrator (Tier 1)
    const orchParsed = parseStandardAgentId("orchestrator_wave-2-foundations");
    expect(orchParsed).not.toBeNull();
    expect(orchParsed?.role).toBe("orchestrator");
    expect(orchParsed?.tier).toBe(1);
    expect(orchParsed?.bindingType).toBe("phase");

    // Mind Auditor (Tier 1)
    const auditorParsed = parseStandardAgentId("mind-auditor_audit-gen-1");
    expect(auditorParsed).not.toBeNull();
    expect(auditorParsed?.role).toBe("mind-auditor");
    expect(auditorParsed?.tier).toBe(1);
    expect(auditorParsed?.bindingType).toBe("audit");

    // Coordinator (Tier 2)
    const coordParsed = parseStandardAgentId("coordinator_domain-cli-tools");
    expect(coordParsed).not.toBeNull();
    expect(coordParsed?.role).toBe("coordinator");
    expect(coordParsed?.tier).toBe(2);
    expect(coordParsed?.bindingType).toBe("domain");

    // Implementer (Tier 3)
    const implParsed = parseStandardAgentId("implementer_task-p47-autonomic-watchdog");
    expect(implParsed).not.toBeNull();
    expect(implParsed?.role).toBe("implementer");
    expect(implParsed?.tier).toBe(3);
    expect(implParsed?.bindingType).toBe("task");
    expect(implParsed?.taskId).toBe("task-p47");
    expect(implParsed?.taskSlug).toBe("autonomic-watchdog");

    // Validator (Tier 3)
    const valParsed = parseStandardAgentId("validator_task-p47-autonomic-watchdog");
    expect(valParsed).not.toBeNull();
    expect(valParsed?.role).toBe("validator");
    expect(valParsed?.tier).toBe(3);
    expect(valParsed?.taskId).toBe("task-p47");

    // Repairer (Tier 3)
    const repParsed = parseStandardAgentId("repairer_task-p47");
    expect(repParsed).not.toBeNull();
    expect(repParsed?.role).toBe("repairer");
    expect(repParsed?.tier).toBe(3);
    expect(repParsed?.taskId).toBe("task-p47");

    // Completeness Critic (Tier 3)
    const criticParsed = parseStandardAgentId("completeness-critic_wave-2-foundations");
    expect(criticParsed).not.toBeNull();
    expect(criticParsed?.role).toBe("completeness-critic");

    // Planner (Tier 3)
    const plannerParsed = parseStandardAgentId("planner_phase-1-planning");
    expect(plannerParsed).not.toBeNull();
    expect(plannerParsed?.role).toBe("planner");

    // Plan Validator (Tier 3)
    const planValParsed = parseStandardAgentId("plan-validator_phase-1-planning");
    expect(planValParsed).not.toBeNull();
    expect(planValParsed?.role).toBe("plan-validator");

    // Specialized Validators
    const valCodeParsed = parseStandardAgentId("validator-code-quality_task-p47");
    expect(valCodeParsed).not.toBeNull();
    expect(valCodeParsed?.role).toBe("validator-code-quality");

    const valProdParsed = parseStandardAgentId("validator-product_task-p47");
    expect(valProdParsed).not.toBeNull();
    expect(valProdParsed?.role).toBe("validator-product");

    const valSecParsed = parseStandardAgentId("validator-security_task-p47");
    expect(valSecParsed).not.toBeNull();
    expect(valSecParsed?.role).toBe("validator-security");

    const valSysParsed = parseStandardAgentId("validator-system-design_task-p47");
    expect(valSysParsed).not.toBeNull();
    expect(valSysParsed?.role).toBe("validator-system-design");

    const valUiParsed = parseStandardAgentId("validator-ui-design_task-p47");
    expect(valUiParsed).not.toBeNull();
    expect(valUiParsed?.role).toBe("validator-ui-design");

    // Subagents
    const subImplParsed = parseStandardAgentId("sub-implementer_task-p47-sub1");
    expect(subImplParsed).not.toBeNull();
    expect(subImplParsed?.role).toBe("sub-implementer");

    const subValParsed = parseStandardAgentId("sub-validator_task-p47-val1");
    expect(subValParsed).not.toBeNull();
    expect(subValParsed?.role).toBe("sub-validator");

    const subInvParsed = parseStandardAgentId("sub-investigator_task-p47-inv1");
    expect(subInvParsed).not.toBeNull();
    expect(subInvParsed?.role).toBe("sub-investigator");
  });

  test("parseStandardAgentId and isStandardAgentId reject non-standard agent IDs", () => {
    expect(parseStandardAgentId("no-underscore-here")).toBeNull();
    expect(parseStandardAgentId("_leading-underscore")).toBeNull();
    expect(parseStandardAgentId("trailing-underscore_")).toBeNull();
    expect(parseStandardAgentId("unknown-role_task-1")).toBeNull();
    expect(parseStandardAgentId("implementer_INVALID_UPPERCASE")).toBeNull();
    expect(parseStandardAgentId("")).toBeNull();

    expect(isStandardAgentId("implementer_task-p47-autonomic-watchdog")).toBe(true);
    expect(isStandardAgentId("random-agent-123")).toBe(false);
  });

  test("recommendStandardAgentId constructs canonical agent identifiers", () => {
    expect(recommendStandardAgentId("implementer", "task-p47")).toBe("implementer_task-p47");
    expect(recommendStandardAgentId("implementer", "task-p47", "autonomic-watchdog")).toBe(
      "implementer_task-p47-autonomic-watchdog",
    );
    expect(recommendStandardAgentId("validator", "task-p47")).toBe("validator_task-p47");
    expect(recommendStandardAgentId("coordinator", "domain-cli")).toBe("coordinator_domain-cli");
    expect(recommendStandardAgentId("custom-role", "context-1")).toBe("custom-role_context-1");
  });

  test("validateAgentNamingConvention validates matches, roles, tiers, and task IDs", () => {
    // Valid standard match
    const validRes = validateAgentNamingConvention(
      "implementer_task-p47-autonomic-watchdog",
      "implementer",
      3,
      "task-p47",
    );
    expect(validRes.valid).toBe(true);
    expect(validRes.role).toBe("implementer");
    expect(validRes.tier).toBe(3);
    expect(validRes.reason).toBeNull();

    // Invalid format
    const invalidFormat = validateAgentNamingConvention(
      "custom-agent-name",
      "implementer",
      3,
      "task-p47",
    );
    expect(invalidFormat.valid).toBe(false);
    expect(invalidFormat.reason).toContain("does not match the standardized naming convention");
    expect(invalidFormat.recommendedAgentId).toBe("implementer_task-p47");

    // Role mismatch
    const roleMismatch = validateAgentNamingConvention(
      "validator_task-p47-autonomic-watchdog",
      "implementer",
      3,
      "task-p47",
    );
    expect(roleMismatch.valid).toBe(false);
    expect(roleMismatch.reason).toContain("Role mismatch");
    expect(roleMismatch.recommendedAgentId).toBe("implementer_task-p47");

    // Tier mismatch
    const tierMismatch = validateAgentNamingConvention("coordinator_domain-cli", "coordinator", 3);
    expect(tierMismatch.valid).toBe(false);
    expect(tierMismatch.reason).toContain("Tier mismatch");

    // Task ID mismatch
    const taskIdMismatch = validateAgentNamingConvention(
      "implementer_task-p47-watchdog",
      "implementer",
      3,
      "task-p48",
    );
    expect(taskIdMismatch.valid).toBe(false);
    expect(taskIdMismatch.reason).toContain("Task ID mismatch");
    expect(taskIdMismatch.recommendedAgentId).toBe("implementer_task-p48-watchdog");

    // Inferred role from agent ID prefix when expectedRole is omitted
    const inferredRoleValidation = validateAgentNamingConvention("coord-custom-suffix");
    expect(inferredRoleValidation.valid).toBe(false);
    expect(inferredRoleValidation.recommendedAgentId).toBe("coordinator_task-id");
  });

  test("covers all execution context inference branches, tier env variables, and defect brief rendering", () => {
    // 1. Explicit tier option inference
    const t1 = identifyExecutionContext({ tier: 1 });
    expect(t1.tier).toBe(1);
    expect(t1.role).toBe("orchestrator");

    const t2 = identifyExecutionContext({ tier: 2 });
    expect(t2.tier).toBe(2);
    expect(t2.role).toBe("coordinator");

    const t3 = identifyExecutionContext({ tier: 3 });
    expect(t3.tier).toBe(3);
    expect(t3.role).toBe("implementer");

    // 2. HARNESS_EXECUTION_TIER env variable inference
    for (const [tierStr, expectedRole] of [
      ["0", "mind"],
      ["1", "orchestrator"],
      ["2", "coordinator"],
      ["3", "implementer"],
    ] as const) {
      const ctx = identifyExecutionContext({ env: { HARNESS_EXECUTION_TIER: tierStr } });
      expect(ctx.role).toBe(expectedRole);
    }

    // 3. Fallback when neither tier nor main thread indicator is set
    const fallbackCtx = identifyExecutionContext({ isInteractiveMainThread: false, env: {} });
    expect(fallbackCtx.tier).toBe(3);
    expect(fallbackCtx.compliance_state).toBe("compliant");

    // 4. formatThreadIdentificationBrief with defect and environment_grants
    const briefWithDefect = formatThreadIdentificationBrief({
      pid: 1000,
      ppid: 999,
      tier: 0,
      tier_name: "Tier 0: Mind Lead",
      role: "mind",
      agent_id: "mind-0",
      is_main_thread: true,
      compliance_state: "violation",
      advisory: "Restraint active",
      indicators: {},
      defect: {
        id: "defect-999",
        type: "main_thread_direct_execution",
        severity: "critical",
        timestamp: new Date().toISOString(),
        pid: 1000,
        ppid: 999,
        agent_id: "mind-0",
        observation: "Direct file edit",
        remediation: "Revert and delegate",
        context: { cwd: "/tmp", indicators: {} },
      },
      host_profile: {
        app_id: "Antigravity",
        os_platform: "darwin",
        os_release: "25.0",
        os_arch: "arm64",
        runtime_node: null,
        runtime_bun: "1.3.14",
      },
      capabilities: {
        tools: ["bash"],
        environment_grants: ["root_access"],
        command_taxonomy: "Full Root",
      },
    });

    expect(briefWithDefect).toContain("**Environment Grants**: root_access");
    expect(briefWithDefect).toContain("**Defect Logged**: `defect-999`");
  });

  test("identifyExecutionContext records defect when mutating action is run on main thread in non-test mode", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalBunTest = process.env.BUN_TEST;
    const originalTest = process.env.TEST;

    const testScratch = scratchRoot(import.meta.path, "thread-defect-test");

    try {
      process.env.NODE_ENV = "production";
      delete process.env.BUN_TEST;
      delete process.env.TEST;

      const contextWithDefect = identifyExecutionContext({
        isInteractiveMainThread: true,
        runRoot: testScratch,
        agentId: "mind-0",
        argv: ["bun", "harness.ts", "task:submit"],
      });

      expect(contextWithDefect.defect).not.toBeNull();
      expect(contextWithDefect.defect?.type).toBe("main_thread_direct_execution");
      expect(contextWithDefect.defect?.severity).toBe("critical");
      expect(contextWithDefect.defect?.context.matched_action).toBe("task:submit");
    } finally {
      if (originalNodeEnv !== undefined) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        delete process.env.NODE_ENV;
      }
      if (originalBunTest !== undefined) {
        process.env.BUN_TEST = originalBunTest;
      } else {
        delete process.env.BUN_TEST;
      }
      if (originalTest !== undefined) {
        process.env.TEST = originalTest;
      } else {
        delete process.env.TEST;
      }
    }
  });

  test("identifyExecutionContext keeps passive exact argv on the main thread advisory-only", () => {
    const context = identifyExecutionContext({
      isInteractiveMainThread: true,
      argv: ["bun", "harness.ts", "whoami"],
    });

    expect(context.compliance_state).toBe("restrained");
    expect(context.advisory).toBe(MAIN_THREAD_ADVISORY);
    expect(context.defect).toBeNull();
  });

  test("identifyExecutionContext logs the exact mutating argv action on the main thread", () => {
    const context = identifyExecutionContext({
      isInteractiveMainThread: true,
      argv: ["bun", "harness.ts", "whoami", "task:submit"],
    });

    expect(context.defect?.severity).toBe("critical");
    expect(context.defect?.context.matched_action).toBe("task:submit");
  });
});

describe("Thread Identifier - Invariants & Cleanliness Audit", () => {
  test("zero TypeScript any and zero suppressions across thread-identifier files", () => {
    const sourceFiles = [
      join(__dirname, "../../../olt/scripts/src/authority/thread/index.ts"),
      __filename,
    ];

    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });
});
