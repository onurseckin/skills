import type { ChecklistItemDefinition } from "./types.ts";

export const STANDING_CHECKLIST_DEFINITIONS: readonly ChecklistItemDefinition[] = [
  // Mind / Tier 0 Checklists
  {
    id: "RESP-MIND-001",
    category: "boundary",
    title: "Observe-Only Supervisory Confinement",
    mandate:
      "Maintain 100% observe-only posture; never edit code, stage files, or execute tasks directly.",
    verificationCriteria:
      "Zero file mutations and zero direct implementation commands on Mind thread.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["mind", "mind-auditor"],
  },
  {
    id: "RESP-MIND-002",
    category: "scaling",
    title: "Infinite Autonomous Pulse & Generational Rotation",
    mandate:
      "Drive perpetual pulse loops (`mind:pulse`) and rotate generational capsules preserving charter pins.",
    verificationCriteria:
      "Mind pulse active, continuous cadence timers armed, no self-termination attempts.",
    protocolKey: "infinite_pulse_cadence",
    targetRoles: ["mind"],
  },
  {
    id: "RESP-MIND-003",
    category: "scaling",
    title: "Dynamic Multi-Orchestrator Scaling & Work/Span Math",
    mandate:
      "Scale concurrent Tier 1 Orchestrators based on Work/Span math (P = W / S) without artificial caps.",
    verificationCriteria:
      "Concurrency scaling evaluated against critical path span length via `dag:view`.",
    protocolKey: "work_span_scaling",
    targetRoles: ["mind"],
  },
  {
    id: "RESP-MIND-004",
    category: "governance",
    title: "Strict Spawning Hierarchy & Domain Isolation",
    mandate:
      "Deploy strictly Tier 1 Orchestrators; never bypass tier hierarchy to spawn coordinators or workers directly.",
    verificationCriteria: "All child spawns belong to Tier 1 (`orchestrator`).",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["mind"],
  },
  {
    id: "RESP-MIND-005",
    category: "governance",
    title: "Quota Freeze Resilience & Zero-Kill Enforcement",
    mandate:
      "Suspend crons on Quota Freeze, never kill active subagents, and resume upon auto-wake sentinel.",
    verificationCriteria: "No subagents are killed during Quota Freeze; crons are suspended.",
    protocolKey: "quota_freeze_zero_kill_resume",
    targetRoles: ["mind", "orchestrator", "coordinator"],
  },

  // Orchestrator / Tier 1 Checklists
  {
    id: "RESP-ORCH-001",
    category: "boundary",
    title: "Plan Supervisor Zero-Code Invariant",
    mandate:
      "Supervise execution rounds and release packages without claiming tasks or modifying code.",
    verificationCriteria: "Zero direct task implementations or file edits on Orchestrator thread.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["orchestrator"],
  },
  {
    id: "RESP-ORCH-002",
    category: "dispatch",
    title: "Autonomous Multi-Round Loop & Domain Coordinator Dispatch",
    mandate:
      "Dispatch dedicated Tier 2 Domain Coordinators across disjoint candidate scopes and chain round lineage.",
    verificationCriteria: "Dispatched coordinators registered with non-overlapping domain scopes.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["orchestrator"],
  },
  {
    id: "RESP-ORCH-003",
    category: "governance",
    title: "Unresolved Finding Synthesis into Next-Round Prompts",
    mandate:
      "Synthesize open coordinator/critic findings into next round prompts rather than reporting raw unresolved text.",
    verificationCriteria: "Open findings triaged and integrated into round synthesis manifests.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["orchestrator"],
  },
  {
    id: "RESP-ORCH-004",
    category: "hygiene",
    title: "Background Thread Finalization Release Confinement",
    mandate:
      "Execute final git commits, git pushes, and global sync strictly on background threads before recycling.",
    verificationCriteria: "No release or git synchronization spillover to main interactive thread.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["orchestrator"],
  },
  {
    id: "RESP-ORCH-005",
    category: "governance",
    title: "Phase/Domain-Bound Standardized Agent Naming",
    mandate:
      "Register and dispatch Tier 2 Coordinators using standardized domain/phase-bound names (coordinator_<domain-slug>).",
    verificationCriteria:
      "Dispatched coordinators use standardized coordinator_<slug> identifiers.",
    protocolKey: "standardized_agent_naming",
    targetRoles: ["orchestrator"],
  },

  // Coordinator / Tier 2 Checklists
  {
    id: "RESP-COORD-001",
    category: "boundary",
    title: "Pure Management & Zero-File-Edit Rule",
    mandate:
      "Own capsule lifecycle, task graph compilation, and dispatch without editing code or test files.",
    verificationCriteria:
      "Zero file mutations on coordinator thread; all code edits delegated to Tier 3 implementers.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-002",
    category: "dispatch",
    title: "Continuous 1:1 Anti-Batching Wave Dispatch",
    mandate:
      "Dispatch claimable tasks continuously as soon as capacity opens without waiting for wave barriers.",
    verificationCriteria:
      "Queue drained continuously; ready tasks dispatched up to Work/Span headroom.",
    protocolKey: "anti_batching_continuous_dispatch",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-003",
    category: "boundary",
    title: "Disjoint Write Scope Exclusivity",
    mandate:
      "Enforce strict disjoint write scopes across active implementer leases with zero file collisions.",
    verificationCriteria: "Active leases have mutually exclusive write scope file lists.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-004",
    category: "verification",
    title: "Disposable Scratch Gate Falsification (`gate:prove`)",
    mandate:
      "Prove compiled task gates can actually fail on disposable scratch copies before trusting them.",
    verificationCriteria: "Gate commands proven with recorded negative failure proof.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-005",
    category: "verification",
    title: "Scepticism Pushback on Qualitative-Only Passes",
    mandate:
      "Reject rubber-stamped passes lacking quantitative evidence via structured `coordinator:pushback`.",
    verificationCriteria: "All accepted verdicts carry quantitative metrics and gate proofs.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-006",
    category: "verification",
    title: "4-Tier Viewport Resolution Matrix Enforcement",
    mandate:
      "Enforce multi-viewport verification (1920x1080, 1440x900, 768x1024, 390x844) on all visual/UI tasks.",
    verificationCriteria:
      "UI tasks verified across Desktop-Wide, Desktop, Tablet, and Mobile captures.",
    protocolKey: "four_tier_viewport_matrix",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-007",
    category: "governance",
    title: "No Premature Run Completion",
    mandate:
      "Never declare run completion with live leases, open findings, unproven gates, or missing critic review.",
    verificationCriteria:
      "All wave lanes closed, 0 open findings, all gates green, completeness critic approved.",
    protocolKey: "anti_batching_continuous_dispatch",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-008",
    category: "governance",
    title: "Task-Bound Standardized Agent Naming & Observability",
    mandate:
      "Dispatch Tier 3 Implementers and Validators using standardized task-bound names (implementer_<task-id>-<slug>, validator_<task-id>-<slug>).",
    verificationCriteria:
      "All dispatched Tier 3 worker IDs follow standardized <role>_<task-id>-<slug> conventions.",
    protocolKey: "standardized_agent_naming",
    targetRoles: ["coordinator"],
  },

  // Implementer / Repairer / Tier 3 Checklists
  {
    id: "RESP-IMPL-001",
    category: "boundary",
    title: "Strict Disjoint Write Scope Confinement",
    mandate:
      "Create, edit, and delete files strictly within assigned leased write scope; never touch out-of-scope paths.",
    verificationCriteria:
      "All modified files fall strictly within the task's declared write_scope.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },
  {
    id: "RESP-IMPL-002",
    category: "hygiene",
    title: "Zero-Any TypeScript & Zero Suppressions",
    mandate:
      "Maintain 100% strict TypeScript types: 0 `any`, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 lint suppressions.",
    verificationCriteria: "Codebase compiles with 0 type errors and 0 type suppressions.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },
  {
    id: "RESP-IMPL-003",
    category: "verification",
    title: "Pre-Submission Verification & Regression Coverage",
    mandate:
      "Run scoped tests, verify negative paths, and add regression tests for repaired defect findings before submitting.",
    verificationCriteria:
      "Verification commands recorded via `run:exec` and cited in submission evidence.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },
  {
    id: "RESP-IMPL-004",
    category: "boundary",
    title: "Independent Validation Invariant",
    mandate:
      "Never validate, review, probe, or sign off own work; submit to independent validator.",
    verificationCriteria: "Implementer never claims validation lease or executes `task:review`.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },
  {
    id: "RESP-IMPL-005",
    category: "governance",
    title: "Task-Bound Standard Implementer Naming",
    mandate:
      "Register and claim leases using standardized task-bound agent ID (implementer_<task-id>-<slug>).",
    verificationCriteria: "Agent ID conforms to standardized implementer_<task-id>-<slug> pattern.",
    protocolKey: "standardized_agent_naming",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },

  // Validator / Tier 3 Checklists
  {
    id: "RESP-VAL-001",
    category: "verification",
    title: "Mandatory Adversarial Probe Round",
    mandate:
      "Record an adversarial probe demanding proof (`task:probe`) before issuing any pass review.",
    verificationCriteria: "Task has recorded at least 1 probe demand before pass verdict.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: [
      "validator",
      "validator-code-quality",
      "validator-product",
      "validator-security",
      "validator-system-design",
      "validator-ui-design",
      "sub-validator",
    ],
  },
  {
    id: "RESP-VAL-002",
    category: "verification",
    title: "Dual-Channel Visual & DOM Verification for UI Tasks",
    mandate:
      "Synthesize computed DOM metrics (`visual-report.json`) and screenshot captures across 4 viewports for UI tasks.",
    verificationCriteria:
      "UI tasks verified with DOM bounds, APCA contrast, and 4-tier screenshots (> 1024B).",
    protocolKey: "four_tier_viewport_matrix",
    targetRoles: ["validator", "validator-ui-design", "sub-validator"],
  },
  {
    id: "RESP-VAL-003",
    category: "boundary",
    title: "Independent Verification & Anti-Anchoring Bias",
    mandate:
      "Inspect repository directly using independent gate proofs; ignore implementer confidence claims.",
    verificationCriteria: "All checks executed independently via `run:exec` on validator thread.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: [
      "validator",
      "validator-code-quality",
      "validator-product",
      "validator-security",
      "validator-system-design",
      "validator-ui-design",
      "sub-validator",
    ],
  },
  {
    id: "RESP-VAL-004",
    category: "governance",
    title: "Task-Bound Standard Validator Naming",
    mandate:
      "Register and perform validation using standardized task-bound agent ID (validator_<task-id>-<slug>).",
    verificationCriteria:
      "Validator agent ID conforms to standardized validator_<task-id>-<slug> pattern.",
    protocolKey: "standardized_agent_naming",
    targetRoles: [
      "validator",
      "validator-code-quality",
      "validator-product",
      "validator-security",
      "validator-system-design",
      "validator-ui-design",
      "sub-validator",
    ],
  },
];
