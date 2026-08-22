import { describe, expect, test } from "bun:test";
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
  type RoleContract,
  type UnifiedAgentModel,
} from "../../../orchestrating-long-tasks/scripts/src/authority/manifest-parser.ts";
import {
  constructSupervisoryPersonaReminder,
  DECISION_PROTOCOLS,
  evaluateSupervisoryState,
  STANDING_CHECKLIST_DEFINITIONS,
  type DecisionProtocolId,
  type SupervisoryPersonaReminder,
  type SupervisoryReminderEvaluationContext,
} from "../../../orchestrating-long-tasks/scripts/src/authority/supervisory-persona-reminder.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";

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
    expect(parsed.quoted_val).toBe("escaped \"quotes\" and \nnewlines");
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
    expect((parsed.literal_block as string)).toContain("Line 1\nLine 2\nLine 3");
    expect(typeof parsed.folded_block).toBe("string");
    expect((parsed.folded_block as string)).toContain("This is a folded sentence.");
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
    expect(valManifest.tools?.enable_write_tools).toBe(false);
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
    const mindChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) => d.targetRoles.includes("mind"));
    expect(mindChecklists.some((c) => c.id === "RESP-MIND-001")).toBe(true);
    expect(mindChecklists.some((c) => c.id === "RESP-MIND-002")).toBe(true);
    expect(mindChecklists.some((c) => c.id === "RESP-MIND-003")).toBe(true);
  });

  test("coordinator checklists include zero-code, anti-batching, gate:prove, and 4-tier viewports", () => {
    const coordChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) => d.targetRoles.includes("coordinator"));
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-001")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-002")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-003")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-004")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-005")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-006")).toBe(true);
    expect(coordChecklists.some((c) => c.id === "RESP-COORD-007")).toBe(true);
  });

  test("implementer checklists enforce strict write scope, zero-any TS, and pre-submission verification", () => {
    const implChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) => d.targetRoles.includes("implementer"));
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-001")).toBe(true);
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-002")).toBe(true);
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-003")).toBe(true);
    expect(implChecklists.some((c) => c.id === "RESP-IMPL-004")).toBe(true);
  });

  test("validator checklists enforce mandatory adversarial probe and dual-channel verification", () => {
    const valChecklists = STANDING_CHECKLIST_DEFINITIONS.filter((d) => d.targetRoles.includes("validator"));
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
        { taskId: "task-1", agentId: "implementer_task-p47-autonomic-watchdog", writeScope: ["src/a.ts"] },
        { taskId: "task-2", agentId: "implementer_task-p48-another-task", writeScope: ["src/b.ts"] },
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
    const violation = evalResult.violations.find((v) => v.code === "SUPERVISOR_ZERO_FILE_EDIT_BREACH");
    expect(violation).toBeDefined();
    expect(violation?.severity).toBe("critical");
    expect(evalResult.correctiveDirectives.some((d) => d.includes("Tier 3 Implementer"))).toBe(true);
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
    const violation = evalResult.violations.find((v) => v.code === "SUPERVISOR_TASK_SELF_EXECUTION_BREACH");
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
    const violation = evalResult.violations.find((v) => v.code === "CROSS_TIER_SPAWN_HIERARCHY_BREACH");
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
    expect(evalResult.correctiveDirectives.some((d) => d.includes("sequential waves"))).toBe(true);
  });

  test("detects queue idling with ready tasks (1:1 anti-batching neglect)", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      queueState: { readyCount: 4, runningCount: 0, blockedCount: 0, totalCount: 4 },
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find((v) => v.code === "QUEUE_IDLE_ANTI_BATCHING_NEGLECT");
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
    const violation = evalResult.violations.find((v) => v.code === "QUALITATIVE_PASS_RUBBER_STAMP_BREACH");
    expect(violation).toBeDefined();
    expect(evalResult.correctiveDirectives.some((d) => d.includes("coordinator:pushback"))).toBe(true);
  });

  test("detects UI tasks missing 4-tier viewport validation", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "coordinator",
      uiTasksMissingViewportValidation: ["task-ui-navbar", "task-ui-modal"],
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find((v) => v.code === "FOUR_TIER_VIEWPORT_MATRIX_BREACH");
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
    const violation = evalResult.violations.find((v) => v.code === "PREMATURE_RUN_COMPLETION_BREACH");
    expect(violation).toBeDefined();
  });

  test("detects validator missing mandatory adversarial probe", () => {
    const context: SupervisoryReminderEvaluationContext = {
      role: "validator",
      adversarialProbeRecorded: false,
    };

    const evalResult = evaluateSupervisoryState(context);
    expect(evalResult.compliant).toBe(false);
    const violation = evalResult.violations.find((v) => v.code === "MANDATORY_ADVERSARIAL_PROBE_OMISSION");
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
    expect(reminder.renderedMarkdown).toContain("### 🛡️ Supervisory Persona & Responsibility Reminder [Tick #1]");
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
      fileModificationsOnSupervisoryThread: ["orchestrating-long-tasks/scripts/src/authority/manifest-parser.ts"],
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
    expect(result.correctiveDirectives.some((d) => d.includes("sequential waves"))).toBe(true);
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

