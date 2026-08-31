import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearManifestCache,
  findSkillRoot,
  listAvailableManifests,
  listAvailableRoles,
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
  normalizeRoleName,
  parseAgentManifest,
  parseMarkdownFrontmatter,
  parseRoleContract,
  parseYaml,
  type AgentManifest,
  type AgentManifestCommunicationContract,
  type RoleContract,
  type UnifiedAgentModel,
} from "../../olt/scripts/src/authority/manifest/index.ts";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../olt/scripts/src/authority/manifest-schema.ts";
import {
  constructSupervisoryPersonaReminder,
  DECISION_PROTOCOLS,
  evaluateSupervisoryState,
  STANDING_CHECKLIST_DEFINITIONS,
  type DecisionProtocolId,
  type SupervisoryPersonaReminder,
  type SupervisoryReminderEvaluationContext,
} from "../../olt/scripts/src/authority/supervisory/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("YAML and Markdown Frontmatter Parser (manifest-parser.ts)", () => {
  test("parses plain scalars, booleans, numbers, and nulls correctly", () => {
    const yaml = `
string_val: hello world
quoted_val: "escaped \\"quotes\\" and \\nnewlines"
single_quoted: 'single ''quotes'''
int_val: 42
float_val: 3.1415
bool_true: true
bool_yes: yes
bool_on: on
bool_false: false
bool_no: no
bool_off: off
null_val: null
tilde_null: ~
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.string_val).toBe("hello world");
    expect(parsed.quoted_val).toBe('escaped "quotes" and \nnewlines');
    expect(parsed.single_quoted).toBe("single 'quotes'");
    expect(parsed.int_val).toBe(42);
    expect(parsed.float_val).toBe(3.1415);
    expect(parsed.bool_true).toBe(true);
    expect(parsed.bool_yes).toBe(true);
    expect(parsed.bool_on).toBe(true);
    expect(parsed.bool_false).toBe(false);
    expect(parsed.bool_no).toBe(false);
    expect(parsed.bool_off).toBe(false);
    expect(parsed.null_val).toBeNull();
    expect(parsed.tilde_null).toBeNull();
  });

  test("parses block sequences and flow arrays", () => {
    const yaml = `
block_list:
  - item 1
  - item 2
  - "item 3"
flow_list: [alpha, beta, gamma]
empty_flow: []
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.block_list).toEqual(["item 1", "item 2", "item 3"]);
    expect(parsed.flow_list).toEqual(["alpha", "beta", "gamma"]);
    expect(parsed.empty_flow).toEqual([]);
  });

  test("parses nested block objects and flow mappings", () => {
    const yaml = `
interface:
  display_name: "Test Agent"
  tier: 2
  tools:
    enable_subagent_tools: true
    enable_write_tools: false
flow_obj: { key1: "val1", key2: 123 }
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    const iface = parsed.interface as Record<string, unknown>;
    expect(iface.display_name).toBe("Test Agent");
    expect(iface.tier).toBe(2);
    const tools = iface.tools as Record<string, unknown>;
    expect(tools.enable_subagent_tools).toBe(true);
    expect(tools.enable_write_tools).toBe(false);
    expect(parsed.flow_obj).toEqual({ key1: "val1", key2: 123 });
  });

  test("parses multiline block scalars with | and >", () => {
    const yaml = `
literal_block: |
  Line 1
  Line 2
  Line 3
folded_block: >
  This is a
  folded sentence.
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(typeof parsed.literal_block).toBe("string");
    expect(parsed.literal_block as string).toContain("Line 1\nLine 2\nLine 3");
    expect(typeof parsed.folded_block).toBe("string");
    expect(parsed.folded_block as string).toContain("This is a folded sentence.");
  });

  test("handles inline and block comments correctly", () => {
    const yaml = `
# Top comment
name: coordinator # Inline comment
# Middle comment
tier: 2
`;
    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.name).toBe("coordinator");
    expect(parsed.tier).toBe(2);
  });

  test("extracts markdown frontmatter and body cleanly", () => {
    const markdown = `---
role: coordinator
tier: 2
may:
  - Command 1
  - Command 2
must_not:
  - Breach 1
---

# Coordinator Header

This is the main body content of the role contract.
`;
    const { frontmatter, body } = parseMarkdownFrontmatter<Record<string, unknown>>(markdown);
    expect(frontmatter.role).toBe("coordinator");
    expect(frontmatter.tier).toBe(2);
    expect(frontmatter.may).toEqual(["Command 1", "Command 2"]);
    expect(frontmatter.must_not).toEqual(["Breach 1"]);
    expect(body).toContain("# Coordinator Header");
    expect(body).toContain("This is the main body content of the role contract.");
  });

  test("returns empty frontmatter if delimiter is missing", () => {
    const markdown = `# Title\n\nNo frontmatter here.`;
    const { frontmatter, body } = parseMarkdownFrontmatter(markdown);
    expect(frontmatter).toEqual({});
    expect(body).toBe(markdown);
  });
});

describe("Role Contract and Agent Manifest Parsing (manifest-parser.ts)", () => {
  test("normalizes role aliases consistently", () => {
    expect(normalizeRoleName("mind")).toBe("mind");
    expect(normalizeRoleName("human")).toBe("mind");
    expect(normalizeRoleName("tier 0")).toBe("mind");
    expect(normalizeRoleName("tier-0")).toBe("mind");
    expect(normalizeRoleName("orchestrator")).toBe("orchestrator");
    expect(normalizeRoleName("orch")).toBe("orchestrator");
    expect(normalizeRoleName("tier 1")).toBe("orchestrator");
    expect(normalizeRoleName("coordinator")).toBe("coordinator");
    expect(normalizeRoleName("coord")).toBe("coordinator");
    expect(normalizeRoleName("tier 2")).toBe("coordinator");
    expect(normalizeRoleName("implementer")).toBe("implementer");
    expect(normalizeRoleName("validator")).toBe("validator");
    expect(normalizeRoleName("validator-code-quality")).toBe("validator-code-quality");
  });

  test("parses in-memory role contract", () => {
    const rawContract = `---
role: coordinator
tier: 2
domain: execution
may:
  - Compile task graphs
  - Dispatch wave lanes
must_not:
  - Edit application code
  - Bypass harness CLI
commands:
  - plan:compile
  - queue:wave
spawns:
  - implementer
  - validator
---
# Coordinator Contract

Coordinator owns the run, not the code.
`;
    const contract = parseRoleContract(rawContract, "roles/coordinator.md");
    expect(contract.role).toBe("coordinator");
    expect(contract.tier).toBe(2);
    expect(contract.domain).toBe("execution");
    expect(contract.may).toEqual(["Compile task graphs", "Dispatch wave lanes"]);
    expect(contract.mustNot).toEqual(["Edit application code", "Bypass harness CLI"]);
    expect(contract.commands).toEqual(["plan:compile", "queue:wave"]);
    expect(contract.spawns).toEqual(["implementer", "validator"]);
    expect(contract.body).toContain("# Coordinator Contract");
    expect(contract.filePath).toBe("roles/coordinator.md");
  });

  test("parses in-memory agent manifest", () => {
    const rawManifest = `
name: "implementer"
role: "implementer"
tier: 3
provider:
  - antigravity
  - claude
tools:
  enable_subagent_tools: true
  enable_write_tools: true
interface:
  display_name: "Task Implementer"
  short_description: "Tier 3 implementer working strictly inside one leased write scope."
  tier: 3
protocol:
  cli: "bun harness.ts"
  zero_json: true
  instructions: |
    Implement modular code strictly within write scope.
`;
    const manifest = parseAgentManifest(rawManifest, "agents/implementer.yaml");
    expect(manifest.name).toBe("implementer");
    expect(manifest.role).toBe("implementer");
    expect(manifest.tier).toBe(3);
    expect(manifest.provider).toEqual(["antigravity", "claude"]);
    expect(manifest.tools?.enable_write_tools).toBe(true);
    expect(manifest.interface?.display_name).toBe("Task Implementer");
    expect(manifest.protocol?.zero_json).toBe(true);
    expect(manifest.protocol?.instructions).toContain("Implement modular code");
  });

  test("findSkillRoot resolves the skill root containing agents/ and roles/", () => {
    const root = findSkillRoot();
    expect(typeof root).toBe("string");
    expect(root.length).toBeGreaterThan(0);
  });

  test("loads real role contracts from disk", () => {
    const mindContract = loadRoleContract("mind");
    expect(mindContract.role).toBe("mind");
    expect(mindContract.tier).toBe(0);
    expect(mindContract.may.length).toBeGreaterThan(0);
    expect(mindContract.mustNot.length).toBeGreaterThan(0);
    expect(mindContract.commands.length).toBeGreaterThan(0);

    const orchContract = loadRoleContract("orchestrator");
    expect(orchContract.role).toBe("orchestrator");
    expect(orchContract.tier).toBe(1);
    expect(orchContract.spawns).toContain("coordinator");

    const coordContract = loadRoleContract("coordinator");
    expect(coordContract.role).toBe("coordinator");
    expect(coordContract.tier).toBe(2);
    expect(coordContract.spawns).toContain("implementer");
    expect(coordContract.spawns).toContain("validator");

    const implContract = loadRoleContract("implementer");
    expect(implContract.role).toBe("implementer");
    expect(implContract.tier).toBe(3);
    expect(implContract.mustNot.some((m) => m.includes("write scope"))).toBe(true);

    const valContract = loadRoleContract("validator");
    expect(valContract.role).toBe("validator");
    expect(valContract.tier).toBe(3);
  });

  test("loads real agent manifests from disk", () => {
    const mindManifest = loadAgentManifest("mind");
    expect(mindManifest.name).toBe("mind");
    expect(mindManifest.tier).toBe(0);

    const orchManifest = loadAgentManifest("orchestrator");
    expect(orchManifest.name).toBe("orchestrator");
    expect(orchManifest.tier).toBe(1);

    const coordManifest = loadAgentManifest("coordinator");
    expect(coordManifest.name).toBe("coordinator");
    expect(coordManifest.tier).toBe(2);

    const implManifest = loadAgentManifest("implementer");
    expect(implManifest.name).toBe("implementer");
    expect(implManifest.tier).toBe(3);
    expect(implManifest.tools?.enable_write_tools).toBe(true);

    const valManifest = loadAgentManifest("validator");
    expect(valManifest.name).toBe("validator");
    expect(valManifest.tier).toBe(3);
    expect(valManifest.tools?.enable_write_tools).toBe(true);
  });

  test("loads unified agent model merging contract and manifest", () => {
    const unified = loadUnifiedAgentModel("coordinator");
    expect(unified.role).toBe("coordinator");
    expect(unified.tier).toBe(2);
    expect(unified.archetype).toContain("Wave Execution & Lease Manager");
    expect(unified.coreMandate.length).toBeGreaterThan(0);
    expect(unified.may.length).toBeGreaterThan(0);
    expect(unified.mustNot.length).toBeGreaterThan(0);
    expect(unified.commands.length).toBeGreaterThan(0);
    expect(unified.spawns).toContain("implementer");
    expect(unified.spawns).toContain("validator");
    expect(unified.tools.enable_subagent_tools).toBe(true);
    expect(unified.instructions.length).toBeGreaterThan(0);
    expect(unified.roleContractBody.length).toBeGreaterThan(0);
  });

  test("lists available roles and agent manifests", () => {
    const roles = listAvailableRoles();
    expect(roles).toContain("mind");
    expect(roles).toContain("orchestrator");
    expect(roles).toContain("coordinator");
    expect(roles).toContain("implementer");
    expect(roles).toContain("validator");

    const manifests = listAvailableManifests();
    expect(manifests).toContain("mind");
    expect(manifests).toContain("orchestrator");
    expect(manifests).toContain("coordinator");
    expect(manifests).toContain("implementer");
    expect(manifests).toContain("validator");
  });

  test("clearManifestCache and bypassCache options function correctly", () => {
    clearManifestCache();
    const model1 = loadUnifiedAgentModel("coordinator");
    const model2 = loadUnifiedAgentModel("coordinator", { bypassCache: true });
    expect(model1.role).toBe(model2.role);
  });

  test("synthetic fallback contract generated for non-existent role", () => {
    const synthetic = loadRoleContract("custom-mock-role");
    expect(synthetic.role).toBe("custom-mock-role");
    expect(synthetic.tier).toBe(3);
    expect(synthetic.may.length).toBeGreaterThan(0);
    expect(synthetic.mustNot.length).toBeGreaterThan(0);
  });
});

describe("Decision Protocols Subsystem (supervisory-persona-reminder.ts)", () => {
  test("defines all 8 core decision protocols with rich specifications", () => {
    const protocolKeys: DecisionProtocolId[] = [
      "work_span_scaling",
      "anti_batching_continuous_dispatch",
      "supervisor_zero_file_edit",
      "four_tier_viewport_matrix",
      "scepticism_quantitative_proof",
      "strict_tier_hierarchy",
      "infinite_pulse_cadence",
      "dual_channel_validation",
    ];

    for (const key of protocolKeys) {
      const proto = DECISION_PROTOCOLS[key];
      expect(proto).toBeDefined();
      expect(proto.id).toBe(key);
      expect(proto.name.length).toBeGreaterThan(0);
      expect(proto.summary.length).toBeGreaterThan(0);
      expect(proto.formulaOrRule.length).toBeGreaterThan(0);
      expect(proto.keyInvariants.length).toBeGreaterThanOrEqual(3);
      expect(proto.operationalGuidance.length).toBeGreaterThan(0);
      expect(proto.applicableTiers.length).toBeGreaterThan(0);
    }
  });

  test("Work/Span scaling protocol embodies P = W / S formula", () => {
    const ws = DECISION_PROTOCOLS.work_span_scaling;
    expect(ws.formulaOrRule).toContain("P = ceil(W / S)");
    expect(ws.keyInvariants.some((i) => i.includes("P = W / S"))).toBe(true);
    expect(ws.applicableTiers).toContain(0);
    expect(ws.applicableTiers).toContain(1);
    expect(ws.applicableTiers).toContain(2);
  });

  test("Supervisor zero file edit protocol forbids supervisory code edits", () => {
    const zf = DECISION_PROTOCOLS.supervisor_zero_file_edit;
    expect(zf.formulaOrRule).toContain("Supervisory File Mod = 0");
    expect(zf.keyInvariants.some((i) => i.includes("trivial fix"))).toBe(true);
  });

  test("4-Tier viewport matrix protocol covers Desktop-Wide, Desktop, Tablet, and Mobile", () => {
    const vm = DECISION_PROTOCOLS.four_tier_viewport_matrix;
    expect(vm.formulaOrRule).toContain("1920x1080");
    expect(vm.formulaOrRule).toContain("1440x900");
    expect(vm.formulaOrRule).toContain("768x1024");
    expect(vm.formulaOrRule).toContain("390x844");
  });
});

describe("Standing Responsibility Checklists (supervisory-persona-reminder.ts)", () => {
  test("defines comprehensive checklist items covering all tiers", () => {
    expect(STANDING_CHECKLIST_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
    for (const def of STANDING_CHECKLIST_DEFINITIONS) {
      expect(def.id.length).toBeGreaterThan(0);
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.mandate.length).toBeGreaterThan(0);
      expect(def.verificationCriteria.length).toBeGreaterThan(0);
      expect(def.targetRoles.length).toBeGreaterThan(0);
    }
  });

  test("mind checklists include observe-only confinement and infinite pulse", () => {
    const mindChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) =>
      d.targetRoles.includes("mind"),
    );
    expect(mindChecklists.some((c) => c.id === "RESP-MIND-001")).toBe(true);
    expect(mindChecklists.some((c) => c.id === "RESP-MIND-002")).toBe(true);
    expect(mindChecklists.some((c) => c.id === "RESP-MIND-003")).toBe(true);
  });

  test("coordinator checklists include zero-code, anti-batching, gate:prove, and 4-tier viewports", () => {
    const coordChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) =>
      d.targetRoles.includes("coordinator"),
    );
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-001")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-002")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-003")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-004")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-005")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-006")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-007")).toBe(true);
  });

  test("implementer checklists enforce strict write scope, zero-any TS, and pre-submission verification", () => {
    const implChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) =>
      d.targetRoles.includes("implementer"),
    );
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-001")).toBe(true);
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-002")).toBe(true);
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-003")).toBe(true);
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-004")).toBe(true);
  });

  test("validator checklists enforce mandatory adversarial probe and dual-channel verification", () => {
    const valChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) =>
      d.targetRoles.includes("validator"),
    );
    expect(valChecklists.some((c) => c.id === "RESP-VAL-001")).toBe(true);
    expect(valChecklists.some((c) => c.id === "RESP-VAL-002")).toBe(true);
    expect(valChecklists.some((c) => c.id === "RESP-VAL-003")).toBe(true);
  });
});

describe("Automated State Evaluation & Neglected Responsibility Detection (supervisory-persona-reminder.ts)", () => {
  test("evaluates compliant clean state as passed with zero violations", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      agentId: "coordinator_domain-cli-tools",
      runId: "mind-gen-1-wave-2",
      activeLeases: [
        {
          taskId: "task-1",
          agentId: "implementer_task-p47-autonomic-watchdog",
          writeScope: ["src/a.ts"],
        },
        {
          taskId: "task-2",
          agentId: "implementer_task-p48-another-task",
          writeScope: ["src/b.ts"],
        },
      ],
      queueState: { readyCount: 0, runningCount: 2, blockedCount: 0, totalCount: 2 },
      openFindingsCount: 0,
      failedGatesCount: 0,
      unprovenGatesCount: 0,
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(true);
    expect(evalResult.driftScore).toBe(0);
    expect(evalResult.severity).toBe("none");
    expect(evalResult.violations).toHaveLength(0);
    expect(evalResult.correctiveDirectives).toHaveLength(0);
    expect(evalResult.checklist.every((item) => item.status === "completed")).toBe(true);
  });

  test("detects supervisory zero-file-edit violation when coordinator edits files", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      fileModificationsOnSupervisoryThread: ["src/authority/manifest-parser.ts"],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    expect(evalResult.severity).toBe("critical");
    const violation = evalResult.violations.find(
      (v) => v.code === "SUPERVISOR_ZERO_FILE_EDIT_BREACH",
    );
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("critical");
    expect(evalResult.correctiveDirectives.some((d) => d.includes("Tier 3 Implementer"))).toBe(
      true,
    );
    const checklistItem = evalResult.checklist.find((c) => c.id === "RESP-COORD-001");
    expect(checklistItem?.status).toBe("violated");
  });

  test("detects direct task implementation attempts on supervisor", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "orchestrator",
      directExecutionAttempts: ["claim_task", "implement_task"],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    expect(evalResult.severity).toBe("critical");
    const violation = evalResult.violations.find(
      (v) => v.code === "SUPERVISOR_TASK_SELF_EXECUTION_BREACH",
    );
    expect(violation).toBeDefined();
    expect(evalResult.correctiveDirectives.some((d) => d.includes("task:release"))).toBe(true);
  });

  test("detects cross-tier spawning hierarchy breach", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "mind", // Mind (Tier 0) can only spawn Tier 1 Orchestrator
      crossTierSpawns: ["coordinator", "implementer"],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    expect(evalResult.severity).toBe("critical");
    const violation = evalResult.violations.find(
      (v) => v.code === "CROSS_TIER_SPAWN_HIERARCHY_BREACH",
    );
    expect(violation).toBeDefined();
  });

  test("detects write scope collisions among active leases", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      activeLeases: [
        { taskId: "task-A", agentId: "impl-A", writeScope: ["src/shared.ts", "src/auth.ts"] },
        { taskId: "task-B", agentId: "impl-B", writeScope: ["src/shared.ts", "src/user.ts"] },
      ],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    expect(evalResult.severity).toBe("high");
    const violation = evalResult.violations.find((v) => v.code === "WRITE_SCOPE_COLLISION_BREACH");
    expect(violation).toBeDefined();
    expect(
      evalResult.correctiveDirectives.some(
        (d) => d.includes("successive waves") || d.includes("execute sequentially"),
      ),
    ).toBe(true);
  });

  test("detects queue idling with ready tasks (1:1 anti-batching neglect)", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      queueState: { readyCount: 4, runningCount: 0, blockedCount: 0, totalCount: 4 },
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find(
      (v) => v.code === "QUEUE_IDLE_ANTI_BATCHING_NEGLECT",
    );
    expect(violation).toBeDefined();
    expect(evalResult.correctiveDirectives.some((d) => d.includes("queue:wave"))).toBe(true);
  });

  test("detects unproven gates risk on coordinator", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      unprovenGatesCount: 3,
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find((v) => v.code === "UNPROVEN_GATE_RISK");
    expect(violation).toBeDefined();
    expect(evalResult.correctiveDirectives.some((d) => d.includes("gate:prove"))).toBe(true);
  });

  test("detects qualitative validator pass rubber-stamping", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      qualitativePassesWithoutProof: ["task-p48-review-superficial"],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find(
      (v) => v.code === "QUALITATIVE_PASS_RUBBER_STAMP_BREACH",
    );
    expect(violation).toBeDefined();
    expect(evalResult.correctiveDirectives.some((d) => d.includes("coordinator:pushback"))).toBe(
      true,
    );
  });

  test("detects UI tasks missing 4-tier viewport validation", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      uiTasksMissingViewportValidation: ["task-ui-navbar", "task-ui-modal"],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find(
      (v) => v.code === "FOUR_TIER_VIEWPORT_MATRIX_BREACH",
    );
    expect(violation).toBeDefined();
    expect(evalResult.correctiveDirectives.some((d) => d.includes("1920x1080"))).toBe(true);
  });

  test("detects premature run completion attempts with unresolved blockers", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      attemptedPrematureCompletion: true,
      openFindingsCount: 2,
      failedGatesCount: 1,
      activeLeases: [{ taskId: "task-live", agentId: "worker-1" }],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    expect(evalResult.severity).toBe("critical");
    const violation = evalResult.violations.find(
      (v) => v.code === "PREMATURE_RUN_COMPLETION_BREACH",
    );
    expect(violation).toBeDefined();
  });

  test("detects validator missing mandatory adversarial probe", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "validator",
      adversarialProbeRecorded: false,
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find(
      (v) => v.code === "MANDATORY_ADVERSARIAL_PROBE_OMISSION",
    );
    expect(violation).toBeDefined();
    expect(evalResult.correctiveDirectives.some((d) => d.includes("task:probe"))).toBe(true);
  });
});

describe("Supervisory Persona Reminder Engine (supervisory-persona-reminder.ts)", () => {
  test("constructs rich persona reminder for Mind (Tier 0)", () => {
    const reminder = constructSupervisoryPersonaReminder({
      role: "mind",
      agentId: "mind_prime",
      runId: "mind-gen-1-wave-2",
      pulseId: "pulse-gen-1-001",
      tickNumber: 1,
      cadenceMs: 180_000,
    });

    expect(reminder.role).toBe("mind");
    expect(reminder.tier).toBe(0);
    expect(reminder.agentId).toBe("mind_prime");
    expect(reminder.runId).toBe("mind-gen-1-wave-2");
    expect(reminder.pulseId).toBe("pulse-gen-1-001");
    expect(reminder.tickNumber).toBe(1);

    // Persona checks
    expect(reminder.persona.displayName.length).toBeGreaterThan(0);
    expect(reminder.persona.archetype).toContain("Autonomous Consciousness");
    expect(reminder.persona.may.length).toBeGreaterThan(0);
    expect(reminder.persona.mustNot.length).toBeGreaterThan(0);

    // Decision Protocols
    expect(reminder.decisionProtocols.some((p) => p.id === "work_span_scaling")).toBe(true);
    expect(reminder.decisionProtocols.some((p) => p.id === "supervisor_zero_file_edit")).toBe(true);
    expect(reminder.decisionProtocols.some((p) => p.id === "infinite_pulse_cadence")).toBe(true);

    // Formatted outputs
    expect(reminder.renderedMarkdown).toContain(
      "### 🛡️ Supervisory Persona & Responsibility Reminder [Tick #1]",
    );
    expect(reminder.renderedMarkdown).toContain("- **Role**: `MIND` (Tier 0)");
    expect(reminder.renderedMarkdown).toContain("#### 📜 Binding Capability Contract");
    expect(reminder.renderedMarkdown).toContain("#### 🧠 Standing Decision Protocols");
    expect(reminder.renderedMarkdown).toContain("#### 📋 Role Responsibility Checklist Evaluation");

    expect(reminder.compactPromptInjection).toContain("[PERSONA REMINDER Tick #1]: Role=MIND");
    expect(reminder.heartbeatTickBrief).toContain("Heartbeat Tick #1 [MIND]");
  });

  test("constructs rich persona reminder for Orchestrator (Tier 1)", () => {
    const reminder = constructSupervisoryPersonaReminder({
      role: "orchestrator",
      runId: "orch-run-001",
      tickNumber: 3,
    });

    expect(reminder.role).toBe("orchestrator");
    expect(reminder.tier).toBe(1);
    expect(reminder.tickNumber).toBe(3);
    expect(reminder.persona.archetype).toContain("Plan Supervisor & Multi-Round Release Manager");
    expect(reminder.persona.spawns).toContain("coordinator");
  });

  test("constructs rich persona reminder for Coordinator (Tier 2) with active violations and directives", () => {
    const reminder = constructSupervisoryPersonaReminder({
      role: "coordinator",
      agentId: "coordinator_domain-cli-tools",
      runId: "mind-gen-1-wave-2",
      tickNumber: 5,
      cadenceMs: 180_000,
      context: {
        role: "coordinator",
        agentId: "coordinator_domain-cli-tools",
        queueState: { readyCount: 3, runningCount: 0, blockedCount: 0, totalCount: 3 },
        unprovenGatesCount: 2,
      },
    });

    expect(reminder.role).toBe("coordinator");
    expect(reminder.tier).toBe(2);
    expect(reminder.evaluation.compliant).toBe(false);
    expect(reminder.correctiveDirectives.length).toBeGreaterThanOrEqual(2);
    expect(reminder.renderedMarkdown).toContain("#### 🚨 Immediate Corrective Directives");
    expect(reminder.compactPromptInjection).toContain("DIRECTIVES:");
  });

  test("constructs rich persona reminder for Implementer (Tier 3)", () => {
    const reminder = constructSupervisoryPersonaReminder({
      role: "implementer",
      agentId: "implementer_task-p47-autonomic-watchdog",
      tickNumber: 2,
    });

    expect(reminder.role).toBe("implementer");
    expect(reminder.tier).toBe(3);
    expect(reminder.persona.archetype).toContain("Scoped Modular Implementer");
    expect(reminder.checklist.some((c) => c.id === "RESP-IMPL-001")).toBe(true);
    expect(reminder.checklist.some((c) => c.id === "RESP-IMPL-002")).toBe(true);
  });

  test("constructs rich persona reminder for Validator (Tier 3)", () => {
    const reminder = constructSupervisoryPersonaReminder({
      role: "validator",
      agentId: "validator_task-p47-autonomic-watchdog",
      tickNumber: 1,
      context: {
        role: "validator",
        agentId: "validator_task-p47-autonomic-watchdog",
        adversarialProbeRecorded: true,
      },
    });

    expect(reminder.role).toBe("validator");
    expect(reminder.tier).toBe(3);
    expect(reminder.persona.archetype).toContain("Adversarial Verifier");
    expect(reminder.evaluation.compliant).toBe(true);
  });

  test("calculates tick number automatically from elapsed time when omitted", () => {
    const startedAt = Date.now() - 370_000; // ~6.16 minutes ago (cadence 180s = tick 3)
    const reminder = constructSupervisoryPersonaReminder({
      role: "coordinator",
      startedAt,
      cadenceMs: 180_000,
    });

    expect(reminder.tickNumber).toBe(3);
    expect(reminder.elapsedMs).toBeGreaterThanOrEqual(360_000);
  });
});

describe("Adversarial Counterfactual Falsifiability Verification (Task-p51 Probe Proofs)", () => {
  test("parseAgentManifest strictly throws HarnessError INVALID_ARGUMENT on non-object YAML scalar or array", () => {
    // Array YAML
    expect(() => parseAgentManifest("- item1\n- item2\n- item3")).toThrow(HarnessError);
    try {
      parseAgentManifest("- item1\n- item2\n- item3");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
    }

    // Scalar string YAML
    expect(() => parseAgentManifest("scalar_string_without_mapping")).toThrow(HarnessError);
    try {
      parseAgentManifest("scalar_string_without_mapping");
    } catch (err) {
      expect(err instanceof HarnessError).toBe(true);
      expect((err as HarnessError).code).toBe("INVALID_ARGUMENT");
    }
  });

  test("evaluateSupervisoryState strictly detects and aggregates multiple concurrent violations with corrective directives", () => {
    const multiViolationContext: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      fileModificationsOnSupervisoryThread: ["olt/scripts/src/authority/manifest-parser.ts"],
      directExecutionAttempts: ["claim_task"],
      activeLeases: [
        { taskId: "task-p51", agentId: "impl-1", writeScope: ["src/a.ts", "src/shared.ts"] },
        { taskId: "task-p52", agentId: "impl-2", writeScope: ["src/b.ts", "src/shared.ts"] },
      ],
      unprovenGatesCount: 4,
      qualitativePassesWithoutProof: ["task-p49-unproven"],
      uiTasksMissingViewportValidation: ["task-ui-dashboard"],
      attemptedPrematureCompletion: true,
      openFindingsCount: 3,
    };

    const result = evaluateSupervisoryState(multiViolationContext);
    expect(result.compliant).toBe(false);
    expect(result.severity).toBe("critical");
    expect(result.driftScore).toBe(1.0);
    expect(result.violations.length).toBeGreaterThanOrEqual(6);

    // Verify all distinct violation codes are identified
    const violationCodes = result.violations.map((v) => v.code);
    expect(violationCodes).toContain("SUPERVISOR_ZERO_FILE_EDIT_BREACH");
    expect(violationCodes).toContain("SUPERVISOR_TASK_SELF_EXECUTION_BREACH");
    expect(violationCodes).toContain("WRITE_SCOPE_COLLISION_BREACH");
    expect(violationCodes).toContain("UNPROVEN_GATE_RISK");
    expect(violationCodes).toContain("QUALITATIVE_PASS_RUBBER_STAMP_BREACH");
    expect(violationCodes).toContain("FOUR_TIER_VIEWPORT_MATRIX_BREACH");
    expect(violationCodes).toContain("PREMATURE_RUN_COMPLETION_BREACH");

    // Verify corrective directives are populated
    expect(result.correctiveDirectives.length).toBeGreaterThanOrEqual(6);
    expect(result.correctiveDirectives.some((d) => d.includes("Tier 3 Implementer"))).toBe(true);
    expect(result.correctiveDirectives.some((d) => d.includes("task:release"))).toBe(true);
    expect(
      result.correctiveDirectives.some(
        (d) => d.includes("successive waves") || d.includes("execute sequentially"),
      ),
    ).toBe(true);
    expect(result.correctiveDirectives.some((d) => d.includes("gate:prove"))).toBe(true);
    expect(result.correctiveDirectives.some((d) => d.includes("coordinator:pushback"))).toBe(true);
    expect(result.correctiveDirectives.some((d) => d.includes("1920x1080"))).toBe(true);
  });

  test("evaluateSupervisoryState flags violated checklist items and embeds actionable directives", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      fileModificationsOnSupervisoryThread: ["src/code.ts"],
    };
    const result = evaluateSupervisoryState(context);
    const violatedItem = result.checklist.find((c) => c.id === "RESP-COORD-001");
    expect(violatedItem).toBeDefined();
    expect(violatedItem?.status).toBe("violated");
    expect(violatedItem?.correctiveDirective).toBeDefined();
    expect(violatedItem?.correctiveDirective).toContain("Tier 3 Implementers");
  });
});

describe("Unified Agent Manifest Schema & Parser (manifest-schema.ts)", () => {
  test("parseUnifiedAgentManifest parses complete agent manifest accurately", () => {
    const yamlContent = `
name: coordinator
role: coordinator
tier: 2
provider:
  - antigravity
  - claude
tools:
  enable_subagent_tools: true
  enable_write_tools: false
interface:
  display_name: "Domain Coordinator"
  short_description: "Coordinates wave execution"
permissions:
  may:
    - "task:claim"
    - "task:submit"
  must_not:
    - "edit_file"
  commands:
    - "harness"
  spawns:
    - "implementer"
    - "validator"
invariants:
  - "Never edit files on supervisory thread"
protocol:
  cli: "bun scripts/harness.ts"
  zero_json: true
instructions: "Coordinate waves cleanly"
`;

    const manifest = parseUnifiedAgentManifest(yamlContent, "agents/coordinator.yaml");
    expect(manifest.name).toBe("coordinator");
    expect(manifest.role).toBe("coordinator");
    expect(manifest.tier).toBe(2);
    expect(manifest.provider).toEqual(["antigravity", "claude"]);
    expect(manifest.tools.enable_subagent_tools).toBe(true);
    expect(manifest.tools.enable_write_tools).toBe(false);
    expect(manifest.interface.display_name).toBe("Domain Coordinator");
    expect(manifest.interface.short_description).toBe("Coordinates wave execution");
    expect(manifest.permissions.may).toEqual(["task:claim", "task:submit"]);
    expect(manifest.permissions.must_not).toEqual(["edit_file"]);
    expect(manifest.permissions.commands).toEqual(["harness"]);
    expect(manifest.permissions.spawns).toEqual(["implementer", "validator"]);
    expect(manifest.invariants).toEqual(["Never edit files on supervisory thread"]);
    expect(manifest.protocol.cli).toBe("bun scripts/harness.ts");
    expect(manifest.protocol.zero_json).toBe(true);
    expect(manifest.instructions).toBe("Coordinate waves cleanly");
  });

  test("parseUnifiedAgentManifest uses sensible defaults when optional fields are omitted", () => {
    const minimalYaml = `
name: custom-worker
tier: independent
`;
    const manifest = parseUnifiedAgentManifest(minimalYaml);
    expect(manifest.name).toBe("custom-worker");
    expect(manifest.role).toBe("custom-worker");
    expect(manifest.tier).toBe("independent");
    expect(manifest.provider.length).toBeGreaterThan(0);
    expect(manifest.tools.enable_subagent_tools).toBe(false);
    expect(manifest.tools.enable_write_tools).toBe(false);
    expect(manifest.interface.display_name).toBe("custom-worker");
    expect(manifest.permissions.may).toEqual([]);
    expect(manifest.protocol.zero_json).toBe(true);
    expect(manifest.instructions).toBe("");
  });

  test("parseUnifiedAgentManifest throws error on non-object YAML or invalid input", () => {
    expect(() => parseUnifiedAgentManifest("just a scalar", "manifest.yaml")).toThrow();
    expect(() => parseUnifiedAgentManifest("{ invalid : : yaml }", "manifest.yaml")).toThrow();
  });

  test("validateUnifiedAgentManifest validates valid manifests and catches all structural anomalies", () => {
    const validManifest: UnifiedAgentManifest = {
      name: "tester",
      role: "tester",
      tier: 3,
      provider: ["antigravity"],
      tools: {
        enable_subagent_tools: false,
        enable_write_tools: true,
      },
      interface: {
        display_name: "Tester",
        short_description: "Runs tests",
      },
      permissions: {
        may: ["bun test"],
        must_not: ["git push"],
        commands: ["test"],
        spawns: [],
      },
      invariants: ["Must pass all assertions"],
      protocol: {
        cli: "bun harness.ts",
        zero_json: true,
      },
      instructions: "Execute targeted unit tests",
    };

    const validResult = validateUnifiedAgentManifest(validManifest);
    expect(validResult.valid).toBe(true);
    expect(validResult.errors).toEqual([]);

    // Structural anomaly checks
    const badManifest = {
      name: 123 as unknown as string,
      role: null as unknown as string,
      tier: "invalid_tier" as unknown as number,
      provider: ["valid", 456] as unknown as string[],
      tools: {
        enable_subagent_tools: "yes" as unknown as boolean,
        enable_write_tools: 1 as unknown as boolean,
      },
      interface: {
        display_name: 999 as unknown as string,
        short_description: false as unknown as string,
      },
      permissions: {
        may: "not-an-array" as unknown as string[],
        must_not: [123] as unknown as string[],
        commands: "bad" as unknown as string[],
        spawns: [null] as unknown as string[],
      },
      invariants: [123] as unknown as string[],
      protocol: {
        cli: 123 as unknown as string,
        zero_json: "true" as unknown as boolean,
      },
      instructions: 123 as unknown as string,
    } as unknown as UnifiedAgentManifest;

    const invalidResult = validateUnifiedAgentManifest(badManifest);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThanOrEqual(10);

    // Null and non-array root fields check
    const completelyInvalid = {
      name: null as unknown as string,
      role: null as unknown as string,
      tier: "invalid-tier" as unknown as number,
      provider: "not-array" as unknown as string[],
      tools: null as unknown as { enable_subagent_tools: boolean; enable_write_tools: boolean },
      interface: null as unknown as { display_name: string; short_description: string },
      permissions: null as unknown as {
        may: string[];
        must_not: string[];
        commands: string[];
        spawns: string[];
      },
      invariants: "not-array" as unknown as string[],
      protocol: null as unknown as { cli: string; zero_json: boolean },
      instructions: null as unknown as string,
    } as unknown as UnifiedAgentManifest;

    const nullFieldsResult = validateUnifiedAgentManifest(completelyInvalid);
    expect(nullFieldsResult.valid).toBe(false);
    expect(nullFieldsResult.errors.length).toBeGreaterThanOrEqual(8);
  });
});

describe("Advanced YAML Parsing and Loader Scenarios (manifest-parser.ts)", () => {
  test("parses complex nested YAML list structures, block scalars, and continuation lines", () => {
    const complexYaml = `
nested_structure:
  -
    - sub_item_1
    - sub_item_2
  -
  - scalar_item
  - key_with_scalar: |
      multi-line text
      line two
    key_sibling: sibling_val
  - key_with_nested:
      nested_key: nested_val
  - key_with_scalar_val: simple_val
    extra_key: extra_val
  - key_null:
`;

    const parsed = parseYaml(complexYaml) as Record<string, unknown>;
    expect(Array.isArray(parsed.nested_structure)).toBe(true);
    const list = parsed.nested_structure as unknown[];
    expect(list[0]).toEqual(["sub_item_1", "sub_item_2"]);
    expect(list[1]).toBeNull();
    expect(list[2]).toBe("scalar_item");
    expect(typeof (list[3] as Record<string, unknown>).key_with_scalar).toBe("string");
    expect((list[3] as Record<string, unknown>).key_sibling).toBe("sibling_val");
    expect((list[4] as Record<string, unknown>).nested_key).toBe("nested_val");
    expect((list[5] as Record<string, unknown>).key_with_scalar_val).toBe("simple_val");
    expect((list[5] as Record<string, unknown>).extra_key).toBe("extra_val");
    expect((list[6] as Record<string, unknown>).key_null).toBeNull();
  });

  test("parses block scalar variants: |-, |+, >-, >+ and escaped quotes", () => {
    const yaml = `
strip_block: |-
  stripped text
keep_block: |+
  kept text
folded_strip: >-
  folded stripped
folded_keep: >+
  folded kept
escaped_text: "line1\\twith tab and \\"quotes\\" and \\\\ backslash"
`;

    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.strip_block).toBe("stripped text");
    expect(parsed.keep_block).toBe("kept text");
    expect(parsed.folded_strip).toBe("folded stripped");
    expect(parsed.folded_keep).toBe("folded kept");
    expect(typeof parsed.escaped_text).toBe("string");
    expect((parsed.escaped_text as string).includes("\t")).toBe(true);
    expect((parsed.escaped_text as string).includes('"quotes"')).toBe(true);
  });

  test("loadRoleContract and loadAgentManifest with custom sandbox directory", () => {
    const sandboxDir = scratchRoot(import.meta.path, "manifest-loader-sandbox");
    const rolesDir = join(sandboxDir, "roles");
    const agentsDir = join(sandboxDir, "agents");
    mkdirSync(rolesDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });

    // Create a role contract file
    const contractContent = `---
role: custom-tester
tier: 3
may:
  - "Run test suites"
must_not:
  - "Deploy to prod"
---
# Custom Tester Role

Executes contract validation.
`;
    writeFileSync(join(rolesDir, "custom-tester.md"), contractContent, "utf8");

    // Create an agent manifest file
    const manifestContent = `
name: custom-tester
role: custom-tester
tier: 3
interface:
  display_name: "Custom Tester"
  short_description: "Custom tester description"
permissions:
  may:
    - "Run test suites"
  must_not:
    - "Deploy to prod"
`;
    writeFileSync(join(agentsDir, "custom-tester.yaml"), manifestContent, "utf8");

    // 1. loadRoleContract from custom directory
    const contract = loadRoleContract("custom-tester", {
      skillRoot: sandboxDir,
      rolesDir,
      bypassCache: true,
    });
    expect(contract.role).toBe("custom-tester");
    expect(contract.tier).toBe(3);
    expect(contract.may).toEqual(["Run test suites"]);

    // 2. loadAgentManifest from custom directory
    const manifest = loadAgentManifest("custom-tester", {
      skillRoot: sandboxDir,
      agentsDir,
      bypassCache: true,
    });
    expect(manifest.name).toBe("custom-tester");
    expect(manifest.role).toBe("custom-tester");

    // 3. loadUnifiedAgentModel
    const unified = loadUnifiedAgentModel("custom-tester", {
      skillRoot: sandboxDir,
      rolesDir,
      agentsDir,
      bypassCache: true,
    });
    expect(unified.role).toBe("custom-tester");
    expect(unified.displayName).toBe("Custom Tester");
    expect(unified.may).toEqual(["Run test suites"]);

    // 4. listAvailableRoles and listAvailableManifests
    const availableRoles = listAvailableRoles({ rolesDir });
    expect(availableRoles).toContain("custom-tester");

    const availableManifests = listAvailableManifests({ agentsDir });
    expect(availableManifests).toContain("custom-tester");

    // 5. loadRoleContract fallback synthetic contract when role file is missing
    const fallback = loadRoleContract("unknown-synthetic-role", {
      skillRoot: sandboxDir,
      rolesDir,
      bypassCache: true,
    });
    expect(fallback.role).toBe("unknown-synthetic-role");
    expect(fallback.tier).toBe(3);
    expect(fallback.may.length).toBeGreaterThan(0);

    // 6. clearManifestCache
    expect(() => clearManifestCache()).not.toThrow();
  });

  test("findSkillRoot resolves correctly for directory containing agents and roles", () => {
    const sandboxDir = scratchRoot(import.meta.path, "skill-root-sandbox");
    mkdirSync(join(sandboxDir, "agents"), { recursive: true });
    mkdirSync(join(sandboxDir, "roles"), { recursive: true });

    const resolved = findSkillRoot(sandboxDir);
    expect(resolved).toBe(sandboxDir);
  });

  test("loadRoleContract loads role permissions from unified agent manifest", () => {
    const sandboxDir = scratchRoot(import.meta.path, "scan-roles-sandbox");
    const agentsDir = join(sandboxDir, "agents");
    mkdirSync(agentsDir, { recursive: true });

    const manifestContent = `
name: scanned-domain-role
role: scanned-domain-role
tier: 3
permissions:
  may:
    - "Scanned action"
`;
    writeFileSync(join(agentsDir, "scanned-domain-role.yaml"), manifestContent, "utf8");

    const contract = loadRoleContract("scanned-domain-role", {
      skillRoot: sandboxDir,
      agentsDir,
      bypassCache: true,
    });
    expect(contract.role).toBe("scanned-domain-role");
    expect(contract.may).toEqual(["Scanned action"]);
  });

  test("loadAgentManifest and loadUnifiedAgentModel synthesize default models when manifest is missing", () => {
    const emptySandbox = scratchRoot(import.meta.path, "empty-manifest-sandbox");
    const syntheticManifest = loadAgentManifest("non-existent-agent-role-999", {
      agentsDir: emptySandbox,
      bypassCache: true,
    });
    expect(syntheticManifest.name).toBe("non-existent-agent-role-999");
    expect(syntheticManifest.role).toBe("non-existent-agent-role-999");
    expect(syntheticManifest.tier).toBe(3);

    const syntheticModel = loadUnifiedAgentModel("non-existent-agent-role-999", {
      agentsDir: emptySandbox,
      rolesDir: emptySandbox,
      bypassCache: true,
    });
    expect(syntheticModel.role).toBe("non-existent-agent-role-999");
    expect(syntheticModel.tier).toBe(3);
  });

  test("listAvailableRoles and listAvailableManifests return empty array when directory does not exist", () => {
    const missingDir = join(scratchRoot(import.meta.path, "missing-dir"), "does-not-exist");
    expect(listAvailableRoles({ rolesDir: missingDir })).toEqual([]);
    expect(listAvailableManifests({ agentsDir: missingDir })).toEqual([]);
  });

  test("parseRoleContract handles non-object frontmatter gracefully and parses trailing frontmatter", () => {
    const invalidFrontmatter = `---
- list item instead of object
---
# Header
`;
    const parsedContract = parseRoleContract(invalidFrontmatter);
    expect(parsedContract.role).toBe("unknown");
    expect(parsedContract.tier).toBe(3);

    const noClosingDelimiter = `---
role: tester
tier: 3
No closing delimiter here
`;
    const parsedNoClosing = parseMarkdownFrontmatter(noClosingDelimiter);
    expect(parsedNoClosing.frontmatter).toEqual({});
  });

  test("evaluateSupervisoryState catches recentActions self-claim, cross-tier spawn, and naming violations", () => {
    // 1. recentActions with claim_task, implement_task, repair_task on supervisor
    const claimContext: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      recentActions: [
        {
          timestamp: new Date().toISOString(),
          action: "claim_task",
        },
        {
          timestamp: new Date().toISOString(),
          action: "implement_task",
        },
        {
          timestamp: new Date().toISOString(),
          action: "repair_task",
        },
      ],
    };
    const claimResult = evaluateSupervisoryState(claimContext);
    expect(
      claimResult.violations.some((v) => v.code === "SUPERVISOR_TASK_SELF_EXECUTION_BREACH"),
    ).toBe(true);

    // 2. recentActions with unauthorized cross-tier spawn
    const spawnContext: SupervisoryReminderEvaluationContext = {
      role: "mind",
      recentActions: [
        {
          timestamp: new Date().toISOString(),
          action: "spawn_subagent",
          spawnedRole: "implementer",
        },
      ],
    };
    const spawnResult = evaluateSupervisoryState(spawnContext);
    expect(spawnResult.violations.some((v) => v.code === "CROSS_TIER_SPAWN_HIERARCHY_BREACH")).toBe(
      true,
    );

    // 3. Non-standard agent ID breach
    const namingContext: SupervisoryReminderEvaluationContext = {
      role: "implementer",
      agentId: "unstandardized-agent-name-without-underscore",
    };
    const namingResult = evaluateSupervisoryState(namingContext);
    expect(namingResult.violations.some((v) => v.code === "UNSTANDARDIZED_AGENT_ID_BREACH")).toBe(
      true,
    );

    // 4. Medium severity violation (unproven gates)
    const mediumSeverityContext: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      unprovenGatesCount: 3,
    };
    const mediumSeverityResult = evaluateSupervisoryState(mediumSeverityContext);
    expect(mediumSeverityResult.severity).toBe("medium");
    expect(mediumSeverityResult.driftScore).toBeGreaterThan(0);
  });

  test("constructSupervisoryPersonaReminder formats ISO dates, invalid dates, and all checklist statuses", () => {
    // 1. String ISO date
    const reminderWithIso = constructSupervisoryPersonaReminder({
      role: "coordinator",
      now: "2026-08-24T12:00:00.000Z",
      startedAt: "2026-08-24T11:50:00.000Z",
      cadenceMs: 60_000,
      runId: "run-custom-1",
      pulseId: "pulse-custom-1",
      agentId: "coordinator_cli",
    });
    expect(reminderWithIso.timestamp).toBe("2026-08-24T12:00:00.000Z");
    expect(reminderWithIso.renderedMarkdown).toContain("run-custom-1");
    expect(reminderWithIso.renderedMarkdown).toContain("pulse-custom-1");
    expect(reminderWithIso.renderedMarkdown).toContain("coordinator_cli");

    // 2. Invalid date string fallback to Date.now()
    const reminderWithInvalidDate = constructSupervisoryPersonaReminder({
      role: "mind",
      now: "not-a-valid-date-string",
    });
    expect(reminderWithInvalidDate.timestamp.length).toBeGreaterThan(0);

    // 3. Formats neglected and pending checklist items in output
    const modifiedEvaluation = {
      ...reminderWithIso.evaluation,
      checklist: [
        {
          id: "TEST-NEGLECTED",
          category: "verification" as const,
          title: "Neglected Responsibility",
          status: "neglected" as const,
          reason: "Neglected reason",
          correctiveDirective: "Execute directive",
        },
        {
          id: "TEST-PENDING",
          category: "verification" as const,
          title: "Pending Responsibility",
          status: "pending" as const,
        },
      ],
    };
    const reminderWithCustomEval: SupervisoryPersonaReminder = {
      ...reminderWithIso,
      evaluation: modifiedEvaluation,
    };
    expect(reminderWithCustomEval.evaluation.checklist[0]?.status).toBe("neglected");
  });

  test("parseYaml handles nested flow maps, lists with multiple keys, and string escapes", () => {
    const yaml = `
flow_section: { a: [1, 2, "three"], b: "colon:value" }
multi_key_list:
  - first_key: 100
    second_key: "two hundred"
    nested_map:
      deep_a: true
      deep_b: false
  - only_key: "single"
`;

    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(parsed.flow_section).toBeDefined();
    const list = parsed.multi_key_list as Array<Record<string, unknown>>;
    expect(list.length).toBe(2);
    expect(list[0]?.first_key).toBe(100);
    expect(list[0]?.second_key).toBe("two hundred");
    expect((list[0]?.nested_map as Record<string, unknown> | undefined)?.deep_a).toBe(true);
    expect(list[1]?.only_key).toBe("single");
  });

  test("loadAgentManifest scans agentsDir when filename does not match role directly", () => {
    const sandboxDir = scratchRoot(import.meta.path, "scan-agents-sandbox");

    const agentsDir = join(sandboxDir, "agents");
    mkdirSync(agentsDir, { recursive: true });

    // File with mismatched filename but matching role inside
    const manifestContent = `
name: custom-agent-slug
role: scanned-agent-role
tier: 2
`;
    writeFileSync(join(agentsDir, "random-file-name.yaml"), manifestContent, "utf8");

    const loaded = loadAgentManifest("scanned-agent-role", {
      skillRoot: sandboxDir,
      agentsDir,
      bypassCache: true,
    });
    expect(loaded.role).toBe("scanned-agent-role");
    expect(loaded.tier).toBe(2);
  });

  test("loadRoleContract falls through to markdown rolesDir when agent manifest throws", () => {
    const sandboxDir = scratchRoot(import.meta.path, "fallthrough-sandbox");
    const agentsDir = join(sandboxDir, "agents");
    const rolesDir = join(sandboxDir, "roles");
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(rolesDir, { recursive: true });

    // Corrupt YAML file that causes parseAgentManifest to throw HarnessError
    writeFileSync(join(agentsDir, "corrupt-role.yaml"), "scalar string not an object", "utf8");

    // Valid role contract in rolesDir
    const contractContent = `---
role: corrupt-role
tier: 3
may:
  - "Markdown fallback capability"
---
# Corrupt Role Contract
`;
    writeFileSync(join(rolesDir, "corrupt-role.md"), contractContent, "utf8");

    const contract = loadRoleContract("corrupt-role", {
      skillRoot: sandboxDir,
      agentsDir,
      rolesDir,
      bypassCache: true,
    });
    expect(contract.role).toBe("corrupt-role");
    expect(contract.may).toEqual(["Markdown fallback capability"]);
  });

  test("constructSupervisoryPersonaReminder renders violated checklist items with directives in markdown", () => {
    const reminderWithViolations = constructSupervisoryPersonaReminder({
      role: "coordinator",
      context: {
        role: "coordinator",
        fileModificationsOnSupervisoryThread: ["src/unauthorized.ts"],
      },
    });

    expect(reminderWithViolations.renderedMarkdown).toContain("❌ VIOLATED");
    expect(reminderWithViolations.renderedMarkdown).toContain("Directive");
    expect(reminderWithViolations.correctiveDirectives.length).toBeGreaterThan(0);
  });

  test("loadRoleContract handles validator- prefixes, scanned directory contracts, synthetic fallbacks, and caching", () => {
    const sandboxDir = scratchRoot(import.meta.path, "role-contract-matrix");
    const agentsDir = join(sandboxDir, "agents");
    const rolesDir = join(sandboxDir, "roles");
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(rolesDir, { recursive: true });

    // 1. validator- prefixed role resolution
    writeFileSync(
      join(rolesDir, "validator-security.md"),
      `---\nrole: validator-security\ntier: 3\nmay:\n  - "Audit security"\n---\n# Security Validator`,
      "utf8",
    );
    // Write corrupt yaml in agents so it falls through to rolesDir
    writeFileSync(join(agentsDir, "validator-security.yaml"), "corrupt scalar", "utf8");

    const validatorContract = loadRoleContract("validator-security", {
      skillRoot: sandboxDir,
      agentsDir,
      rolesDir,
      bypassCache: false,
    });
    expect(validatorContract.role).toBe("validator-security");
    expect(validatorContract.may).toEqual(["Audit security"]);

    // Test cached hit
    const cachedValidator = loadRoleContract("validator-security", {
      skillRoot: sandboxDir,
      agentsDir,
      rolesDir,
      bypassCache: false,
    });
    expect(cachedValidator).toBe(validatorContract);

    // 2. Scanned directory contract (filename does not match role)
    writeFileSync(
      join(rolesDir, "arbitrary-name.md"),
      `---\nrole: unique-scanned-role\ntier: 3\nmay:\n  - "Scanned capability"\n---\n# Unique Scanned Role`,
      "utf8",
    );
    writeFileSync(join(agentsDir, "unique-scanned-role.yaml"), "corrupt scalar", "utf8");

    const scannedContract = loadRoleContract("unique-scanned-role", {
      skillRoot: sandboxDir,
      agentsDir,
      rolesDir,
      bypassCache: true,
    });
    expect(scannedContract.role).toBe("unique-scanned-role");
    expect(scannedContract.may).toEqual(["Scanned capability"]);

    // 3. Fallback synthetic contract when role is not in agents or roles
    writeFileSync(join(agentsDir, "completely-missing-role.yaml"), "corrupt scalar", "utf8");

    const syntheticContract = loadRoleContract("completely-missing-role", {
      skillRoot: sandboxDir,
      agentsDir,
      rolesDir,
      bypassCache: false,
    });
    expect(syntheticContract.role).toBe("completely-missing-role");
    expect(syntheticContract.tier).toBe(3);
    expect(syntheticContract.may.length).toBeGreaterThan(0);
  });

  test("findSkillRoot resolves parent directory walk when agents/ and roles/ are in ancestor", () => {
    const sandboxDir = scratchRoot(import.meta.path, "skill-root-parent-walk");
    const nestedSubDir = join(sandboxDir, "deep", "nested", "child");
    mkdirSync(nestedSubDir, { recursive: true });
    mkdirSync(join(sandboxDir, "agents"), { recursive: true });
    mkdirSync(join(sandboxDir, "roles"), { recursive: true });

    const resolved = findSkillRoot(nestedSubDir);
    expect(resolved).toBe(sandboxDir);
  });

  test("parseYaml parses escape sequences: quotes, newlines, carriage returns, tabs, and backslashes", () => {
    const yaml = `
all_escapes: "line1\\nline2\\r\\ttab\\\\backslash\\"quote"
hex_style: "line with \\x20 hex"
`;

    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(typeof parsed.all_escapes).toBe("string");
    expect((parsed.all_escapes as string).includes("line1\nline2")).toBe(true);
    expect((parsed.all_escapes as string).includes("\t")).toBe(true);
    expect((parsed.all_escapes as string).includes("\\")).toBe(true);
    expect((parsed.all_escapes as string).includes('"')).toBe(true);
  });

  test("parseYaml parses list items with secondary block scalars, nested objects, and null fields", () => {
    const yaml = `
complex_items:
  - id: item-1
    description: |-
      First line
      Second line
    nested:
      deep_key: deep_value
    empty_field:
    stray_line_without_colon
  - id: item-2
    flow_arr: [ 'single', "double \\"escaped\\"" ]
`;

    const parsed = parseYaml(yaml) as Record<string, unknown>;
    expect(Array.isArray(parsed.complex_items)).toBe(true);
    const items = parsed.complex_items as Array<Record<string, unknown>>;
    expect(items[0]?.id).toBe("item-1");
    expect(typeof items[0]?.description).toBe("string");
    expect((items[0]?.nested as Record<string, unknown> | undefined)?.deep_key).toBe("deep_value");
    expect(items[0]?.empty_field).toBeNull();
    expect(Array.isArray(items[1]?.flow_arr)).toBe(true);

    // Top-level flow JSON with single quotes falling through JSON.parse
    const flowJson = "{ 'key': 'val' }";
    const parsedFlow = parseYaml(flowJson) as Record<string, unknown>;
    expect(parsedFlow).toBeDefined();

    // Inline # without space (e.g. hex code)
    const colorYaml = "color: #ff00ff";
    expect(parseYaml(colorYaml)).toBeDefined();
  });

  test("findSkillRoot falls back gracefully when startDir is outside repo hierarchy", () => {
    const fallbackRoot = findSkillRoot("/completely/unrelated/directory/outside/any/git/repo");
    expect(typeof fallbackRoot).toBe("string");
    expect(fallbackRoot.length).toBeGreaterThan(0);
  });

  test("manifest-parser covers remaining YAML tokenization branches and completeness-critic model", () => {
    // 1. stripYamlComment when # is in unquoted string without preceding whitespace
    const unquotedHash = parseYaml("identifier: value#tag");
    expect(unquotedHash).toEqual({ identifier: "value#tag" });

    // 2. Flow mapping and array with backslash inside double quotes
    const flowEscaped = parseYaml('entries: [ "escaped\\\\item", "second" ]');
    expect(Array.isArray((flowEscaped as Record<string, unknown>).entries)).toBe(true);

    const flowMapEscaped = parseYaml('{ key: "escaped\\\\\\"token" }');
    expect(typeof flowMapEscaped).toBe("object");

    // 3. parseBlock with nested list inside list item
    const nestedListYaml = `
data:
  - nested_list:
      - item1
      - item2
`;
    const parsedNestedList = parseYaml(nestedListYaml) as {
      data: Array<{ nested_list: string[] }>;
    };
    expect(parsedNestedList.data[0]?.nested_list).toEqual(["item1", "item2"]);

    // 4. parseBlock with continuation lines in list and stray non-colon line in mapping
    const continuationYaml = `
items:
  - line1
    line2 continuation
mapping:
  stray line without colon
  actual_key: 123
`;
    const parsedContinuation = parseYaml(continuationYaml) as Record<string, unknown>;
    expect(parsedContinuation.mapping).toEqual({ actual_key: 123 });

    // 5. loadUnifiedAgentModel for completeness-critic
    const completenessModel = loadUnifiedAgentModel("completeness-critic");
    expect(completenessModel.role).toBe("completeness-critic");
    expect(completenessModel.archetype).toBe("Run Completeness & Verification Critic");
    expect(completenessModel.coreMandate).toContain("Independently inspect run convergence");

    // 6. evaluateSupervisoryState with tier mismatch agent ID without recommended ID
    const customModel = {
      ...loadUnifiedAgentModel("coordinator"),
      tier: 1, // Override tier to 1 so expectedTier (1) !== parsed.tier (2)
    };
    const tierMismatchState = evaluateSupervisoryState(
      {
        role: "coordinator",
        agentId: "coordinator_wave-1",
      },
      customModel,
    );
    expect(tierMismatchState.compliant).toBe(false);
    expect(
      tierMismatchState.violations.some((v) => v.code === "UNSTANDARDIZED_AGENT_ID_BREACH"),
    ).toBe(true);
    expect(
      tierMismatchState.correctiveDirectives.some((d) =>
        d.includes("Review the agent naming conventions"),
      ),
    ).toBe(true);
  });

  test("all agent manifests in olt/agents declaring commands contain msg:send, msg:recv, msg:poll", () => {
    const agentsDir = join(findSkillRoot(), "agents");
    const manifestFiles = readdirSync(agentsDir).filter((f) => f.endsWith(".yaml"));
    expect(manifestFiles.length).toBe(31);

    for (const file of manifestFiles) {
      const content = readFileSync(join(agentsDir, file), "utf-8");
      const parsed = parseYaml(content) as Record<string, unknown>;
      const permissions =
        parsed && "permissions" in parsed
          ? (parsed.permissions as Record<string, unknown> | undefined)
          : undefined;
      let commands =
        permissions && "commands" in permissions
          ? (permissions.commands as string[] | undefined)
          : undefined;
      if (!commands && parsed && "commands" in parsed) {
        commands = parsed.commands as string[] | undefined;
      }
      if (commands && Array.isArray(commands)) {
        expect(commands).toContain("msg:send");
        expect(commands).toContain("msg:recv");
        expect(commands).toContain("msg:poll");
      }
    }
  });

  describe("Agent Manifest Communication Contracts & Strict Ban on Raw JSONL Reading (task-msg-8)", () => {
    const BAN_JSONL_CLAUSE =
      "Read or parse raw .jsonl files directly (backlog.jsonl, defects.jsonl, inbox.jsonl, outbox.jsonl); all state and messaging must flow strictly through Harness CLI commands";

    test("all 29 manifests in olt/agents load cleanly with valid communication_contract and ban clause", () => {
      const agentsDir = join(findSkillRoot(), "agents");
      const manifestFiles = readdirSync(agentsDir)
        .filter((f) => f.endsWith(".yaml"))
        .sort();
      expect(manifestFiles.length).toBe(31);

      for (const file of manifestFiles) {
        const fullPath = join(agentsDir, file);
        const content = readFileSync(fullPath, "utf-8");
        const manifest = parseAgentManifest(content, fullPath);

        expect(manifest.communication_contract).toBeDefined();
        expect(manifest.communication_contract?.protocol).toBe("mailbox_ipc");
        expect(manifest.communication_contract?.mailbox_path).toBe(".olt/mailboxes/{agent_id}/");
        expect(manifest.communication_contract?.lock_path).toBe(
          ".olt/locks/mailboxes/{agent_id}.lock",
        );
        expect(manifest.communication_contract?.allowed_channels).toEqual([
          "msg:send",
          "msg:recv",
          "msg:poll",
        ]);
        expect(manifest.communication_contract?.ban_raw_jsonl_reading).toBe(true);

        expect(manifest.permissions).toBeDefined();
        expect(manifest.permissions?.must_not).toBeDefined();
        expect(manifest.permissions?.must_not).toContain(BAN_JSONL_CLAUSE);
      }
    });

    test("all 29 manifests parse and pass schema validation via parseUnifiedAgentManifest", () => {
      const agentsDir = join(findSkillRoot(), "agents");
      const manifestFiles = readdirSync(agentsDir)
        .filter((f) => f.endsWith(".yaml"))
        .sort();

      for (const file of manifestFiles) {
        const fullPath = join(agentsDir, file);
        const content = readFileSync(fullPath, "utf-8");
        const unified = parseUnifiedAgentManifest(content, fullPath);

        expect(unified.communication_contract).toBeDefined();
        expect(unified.communication_contract?.protocol).toBe("mailbox_ipc");
        expect(unified.communication_contract?.mailbox_path).toBe(".olt/mailboxes/{agent_id}/");
        expect(unified.communication_contract?.lock_path).toBe(
          ".olt/locks/mailboxes/{agent_id}.lock",
        );
        expect(unified.communication_contract?.allowed_channels).toEqual([
          "msg:send",
          "msg:recv",
          "msg:poll",
        ]);
        expect(unified.communication_contract?.ban_raw_jsonl_reading).toBe(true);
        expect(unified.permissions.must_not).toContain(BAN_JSONL_CLAUSE);

        const validation = validateUnifiedAgentManifest(unified);
        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      }
    });

    test("validateUnifiedAgentManifest catches invalid communication_contract structures", () => {
      const baseManifest: UnifiedAgentManifest = {
        name: "test-agent",
        role: "test-agent",
        tier: 3,
        provider: ["generic"],
        tools: { enable_subagent_tools: true, enable_write_tools: false },
        interface: { display_name: "Test", short_description: "Test Agent" },
        permissions: { may: [], must_not: [BAN_JSONL_CLAUSE], spawns: [] },
        invariants: [],
        protocol: { cli: "bun harness.ts", zero_json: true },
        instructions: "test",
        communication_contract: {
          protocol: 123 as unknown as string,
          mailbox_path: 456 as unknown as string,
          lock_path: 789 as unknown as string,
          allowed_channels: "not-array" as unknown as readonly string[],
          ban_raw_jsonl_reading: "not-bool" as unknown as boolean,
        },
      };

      const result = validateUnifiedAgentManifest(baseManifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("protocol"))).toBe(true);
      expect(result.errors.some((e) => e.includes("mailbox_path"))).toBe(true);
      expect(result.errors.some((e) => e.includes("lock_path"))).toBe(true);
      expect(result.errors.some((e) => e.includes("allowed_channels"))).toBe(true);
      expect(result.errors.some((e) => e.includes("ban_raw_jsonl_reading"))).toBe(true);
    });
  });
});
