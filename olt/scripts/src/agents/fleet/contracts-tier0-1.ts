import type { AgentOperationalContract } from "./types.ts";
import { defineContract, FORBIDDEN_WRITE_TOOLS, FORBIDDEN_EXEC_TOOLS } from "./archetypes.ts";

export const CONTRACTS_TIER_0_1: readonly AgentOperationalContract[] = [
  // --- Tier 0/1 Governance (8) ---
  defineContract({
    id: "sovereign-mind",
    name: "Sovereign Mind",
    role: "sovereign-mind",
    tier: 0,
    category: "governance",
    aliases: ["mind", "tier-0", "genesis-mind"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: true,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *", "git status", "git diff", "git log"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
    },
    permissions: {
      may: [
        "Deliberate strategic intent and system-level epochs",
        "Spawn Tier 1 Orchestrator and companion auditors",
        "Inspect git status, logs, and diagnostic health",
      ],
      mustNot: [
        "Modify repository source files directly",
        "Claim implementation task leases",
        "Read raw jsonl files without harness CLI",
      ],
      allowedCommands: ["bun harness.ts *", "git status", "git diff", "git log"],
      forbiddenCommands: ["run:exec", ...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [
        "domain-orchestrator",
        "orchestrator",
        "mind-auditor",
        "skill-auditor",
        "policy-discovery",
      ],
    },
    invariants: ["SUPERVISOR_ZERO_CODE_EDITS", "NO_RAW_JSONL_READS", "SOVEREIGN_EQUILIBRIUM_GUARD"],
    certifiedDeliverables: [
      {
        type: "strategic_epoch_intent",
        description: "Strategic Epoch Intent Record",
        evidenceRequired: true,
      },
      {
        type: "mind_audit_charter",
        description: "Auditor Charter Authorization",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "mind-auditor",
    name: "Mind Auditor",
    role: "mind-auditor",
    tier: 0,
    category: "governance",
    aliases: ["mind_auditor", "auditor-mind"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts mind-audit:*", "bun harness.ts msg:*"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
    },
    permissions: {
      may: [
        "Audit Mind cognitive pulses and detect stagnation loops",
        "Emit governance audit receipts",
      ],
      mustNot: [
        "Write application source code",
        "Claim task write leases",
        "Spawn tactical implementers",
      ],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
      allowedSpawns: [],
    },
    invariants: ["AUDITOR_INDEPENDENCE_MANDATE", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "mind_audit_receipt",
        description: "Mind Stagnation & Coherence Receipt",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "skill-auditor",
    name: "Skill Auditor",
    role: "skill-auditor",
    tier: 0,
    category: "governance",
    aliases: ["skill_auditor", "auditor-skill"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
    },
    permissions: {
      may: [
        "Verify skill manifest contracts and tool schema adherence",
        "Audit agent capabilities",
      ],
      mustNot: ["Mutate repository source files", "Claim task leases"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["SKILL_SCHEMA_INTEGRITY", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "skill_audit_receipt",
        description: "Skill Contract Audit Receipt",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "policy-discovery",
    name: "Policy Discovery Agent",
    role: "policy-discovery",
    tier: 0,
    category: "governance",
    aliases: ["policy_discovery", "policy-auditor"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: true,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["bun harness.ts *"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, "run:exec"],
    },
    permissions: {
      may: [
        "Discover security policies, RBAC matrices, and workspace boundaries",
        "Report boundary drift",
      ],
      mustNot: ["Modify source files", "Bypass RBAC boundaries"],
      allowedCommands: ["bun harness.ts *"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["POLICY_DISCOVERY_IMMUTABILITY", "SUPERVISOR_ZERO_CODE_EDITS"],
    certifiedDeliverables: [
      {
        type: "policy_discovery_report",
        description: "Policy Boundary Discovery Report",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "owner",
    name: "Genesis Owner",
    role: "owner",
    tier: "independent",
    category: "governance",
    aliases: ["tier-owner", "genesis-owner"],
    toolBoundaries: {
      canWriteCode: true,
      canExecuteCommands: true,
      canSpawnSubagents: true,
      canClaimLeases: false,
      allowedTools: ["*"],
      forbiddenTools: [],
    },
    permissions: {
      may: [
        "Confer genesis authority and override system RBAC rules",
        "Spawn root governance nodes",
      ],
      mustNot: ["Bypass fail-closed safety invariants without explicit owner override token"],
      allowedCommands: ["*"],
      forbiddenCommands: [],
      allowedSpawns: [
        "sovereign-mind",
        "mind",
        "domain-orchestrator",
        "orchestrator",
        "feature-coordinator",
        "coordinator",
      ],
    },
    invariants: ["GENESIS_AUTHORITY_CONFERRAL", "FAIL_CLOSED_RBAC"],
    certifiedDeliverables: [
      {
        type: "genesis_authority_receipt",
        description: "Genesis Authority Conferral Token",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "independent-planner",
    name: "Independent Pure English Planner",
    role: "independent-planner",
    tier: "independent",
    category: "governance",
    aliases: ["independent_planner", "planner-independent"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: false,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["msg:send", "msg:recv", "msg:poll"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
    },
    permissions: {
      may: [
        "Author purely conceptual, natural English architectural plans without harness syntax contamination",
      ],
      mustNot: ["Execute shell commands", "Claim task write leases", "Edit source files"],
      allowedCommands: ["msg:send", "msg:recv", "msg:poll"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
      allowedSpawns: [],
    },
    invariants: [
      "COMPLETE_HARNESS_DECOUPLING",
      "PURE_ENGLISH_CONCEPTUAL_STANDARD",
      "SOURCE_CODE_BLINDNESS_QUARANTINE",
    ],
    isSourceCodeBlind: true,
    certifiedDeliverables: [
      {
        type: "pure_english_plan",
        description: "Pure English Conceptual Architecture Plan",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "independent-planner-auditor",
    name: "Independent Planner Auditor",
    role: "independent-planner-auditor",
    tier: "independent",
    category: "governance",
    aliases: ["independent-planner-audit", "planner-auditor"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: false,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: ["msg:send", "msg:recv", "msg:poll"],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
    },
    permissions: {
      may: [
        "Audit independent planner output for harness syntax contamination and conceptual purity",
      ],
      mustNot: ["Execute shell commands", "Modify repository source files"],
      allowedCommands: ["msg:send", "msg:recv", "msg:poll"],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
      allowedSpawns: [],
    },
    invariants: ["SYNTAX_CONTAMINATION_CHECK", "COGNITIVE_HARD_LOCK"],
    isSourceCodeBlind: true,
    certifiedDeliverables: [
      {
        type: "plan_purity_audit",
        description: "Plan Purity Audit Receipt",
        evidenceRequired: true,
      },
    ],
  }),

  defineContract({
    id: "plan-validator",
    name: "Plan Validator",
    role: "plan-validator",
    tier: 3,
    category: "governance",
    aliases: ["plan_validator", "validator-plan"],
    toolBoundaries: {
      canWriteCode: false,
      canExecuteCommands: false,
      canSpawnSubagents: false,
      canClaimLeases: false,
      allowedTools: [
        "msg:send",
        "msg:recv",
        "msg:poll",
        "task:brief",
        "task:probe",
        "task:reject",
        "task:review",
      ],
      forbiddenTools: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
    },
    permissions: {
      may: ["Validate task plans against umbrella compression and boundary leakage"],
      mustNot: ["Execute shell commands", "Claim task write leases"],
      allowedCommands: [
        "task:brief",
        "task:probe",
        "task:reject",
        "task:review",
        "msg:send",
        "msg:recv",
        "msg:poll",
      ],
      forbiddenCommands: [...FORBIDDEN_WRITE_TOOLS, ...FORBIDDEN_EXEC_TOOLS],
      allowedSpawns: [],
    },
    invariants: [
      "REJECT_SHALLOW_UMBRELLA_COMPRESSION",
      "ANTI_BOUNDARY_LEAK",
      "COGNITIVE_HARD_LOCK",
    ],
    certifiedDeliverables: [
      {
        type: "plan_validation_receipt",
        description: "Plan Validation & Decomposition Receipt",
        evidenceRequired: true,
      },
    ],
  }),

  // --- Tier 2 Orchestration & Adaptor (8) ---
];
