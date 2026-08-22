import { HarnessError } from "../errors/harness-error.ts";
import {
  type AgentManifest,
  type ManifestLoaderOptions,
  type RoleContract,
  type UnifiedAgentModel,
  loadUnifiedAgentModel,
  normalizeRoleName,
} from "./manifest-parser.ts";

export type ChecklistItemStatus =
  | "pending"
  | "completed"
  | "neglected"
  | "violated"
  | "not_applicable";

export type ChecklistCategory =
  | "boundary"
  | "dispatch"
  | "verification"
  | "governance"
  | "scaling"
  | "observability"
  | "hygiene";

export type DecisionProtocolId =
  | "work_span_scaling"
  | "anti_batching_continuous_dispatch"
  | "supervisor_zero_file_edit"
  | "four_tier_viewport_matrix"
  | "scepticism_quantitative_proof"
  | "strict_tier_hierarchy"
  | "infinite_pulse_cadence"
  | "dual_channel_validation";

export interface DecisionProtocolDefinition {
  readonly id: DecisionProtocolId;
  readonly name: string;
  readonly summary: string;
  readonly formulaOrRule: string;
  readonly keyInvariants: readonly string[];
  readonly operationalGuidance: string;
  readonly applicableTiers: readonly number[];
}

export const DECISION_PROTOCOLS: Readonly<Record<DecisionProtocolId, DecisionProtocolDefinition>> = {
  work_span_scaling: {
    id: "work_span_scaling",
    name: "Work/Span Concurrency Scaling (P = W / S)",
    summary:
      "Dynamic parallel occupancy scaling where concurrency P is determined by total work W over critical path span S, without artificial daily limits or budget refusal ladders.",
    formulaOrRule: "P = ceil(W / S)",
    keyInvariants: [
      "Compute algorithmic concurrency headroom (P = W / S) across independent DAG lanes.",
      "Dispatch disjoint independent work units simultaneously up to available worker capacity.",
      "Never impose artificial fixed daily worker caps or pulse exhaustion halts when headroom exists.",
    ],
    operationalGuidance:
      "Continuously inspect live ASCII DAG topology (`dag:view`) to identify critical-path bottlenecks and expand wave parallelism.",
    applicableTiers: [0, 1, 2],
  },
  anti_batching_continuous_dispatch: {
    id: "anti_batching_continuous_dispatch",
    name: "1:1 Anti-Batching & Continuous Eligible-Set Dispatch",
    summary:
      "The instant a slot frees (an agent submits, a lease is released, a dependency clears), dispatch the next claimable task immediately without waiting for sibling tasks.",
    formulaOrRule: "Continuous Dispatch + 1:1 Pairing (Implementer -> Validator)",
    keyInvariants: [
      "Continuous dispatch: Never serialize independent work lanes into sequential loops.",
      "1:1 Anti-batching: Validate an implementer's submission immediately upon arrival; do not wait for wave completion.",
      "Pairing invariant: Implementer + Validator paired dispatch for every task; validator dispatches the moment implementer submits.",
    ],
    operationalGuidance:
      "Keep the eligible set full. Fill freed capacity with the next highest-ranked claimable task instantly.",
    applicableTiers: [1, 2],
  },
  supervisor_zero_file_edit: {
    id: "supervisor_zero_file_edit",
    name: "Supervisor Zero-File-Edit Invariant",
    summary:
      "Supervisory threads (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) are pure observers/managers and must NEVER write, edit, stage, format, or revert application source code or test files.",
    formulaOrRule: "Supervisory File Mod = 0 (Strict Pure Delegation)",
    keyInvariants: [
      "Never succumb to the 'trivial fix' fallacy: even a 1-line syntax fix must be delegated to a Tier 3 implementer.",
      "Main thread and supervisory threads stay empty of implementation code.",
      "Mutate capsule state strictly through recorded harness CLI commands, never hand edits.",
    ],
    operationalGuidance:
      "When a code fix is required, dispatch a Tier 3 Implementer via host native subagents with an exclusive write scope.",
    applicableTiers: [0, 1, 2],
  },
  four_tier_viewport_matrix: {
    id: "four_tier_viewport_matrix",
    name: "4-Tier Viewport Resolution Matrix",
    summary:
      "All UI/visual frontend tasks mandate multi-viewport verification across Desktop-Wide, Desktop, Tablet, and Mobile resolutions.",
    formulaOrRule:
      "Viewport Matrix = [1920x1080 (Desktop-Wide), 1440x900 (Desktop), 768x1024 (Tablet), 390x844 (Mobile)]",
    keyInvariants: [
      "Reject UI/visual submissions lacking multi-viewport rasterized captures across all 4 resolutions.",
      "Synthesize Dual-Channel DOM metrics (`visual-report.json`) and screenshot proofs across all 4 viewports.",
      "Enforce zero 0-byte or stubbed screenshot captures.",
    ],
    operationalGuidance:
      "Run visual regression proofs against all 4 viewport tiers before certifying UI task pass verdicts.",
    applicableTiers: [0, 1, 2, 3],
  },
  scepticism_quantitative_proof: {
    id: "scepticism_quantitative_proof",
    name: "Task Scepticism & Quantitative Proof Enforcement",
    summary:
      "Supervisors must actively push back on unverified, superficial, or qualitative-only validator reports, requiring quantitative metrics and counterfactual gate falsification.",
    formulaOrRule: "Verification = Quantitative Proof + Falsifiable Gate Proof + Adversarial Probe",
    keyInvariants: [
      "Prove compiled gates fail on disposable scratch copies (`gate:prove`) before trusting them.",
      "Reject rubber-stamped passes with `coordinator:pushback`.",
      "Require mandatory adversarial probe (`task:probe`) before any pass verdict is accepted.",
    ],
    operationalGuidance:
      "Require DOM bounding boxes, APCA contrast, screenshot byte proofs (> 1024B), and exact exit codes in evidence.",
    applicableTiers: [1, 2, 3],
  },
  strict_tier_hierarchy: {
    id: "strict_tier_hierarchy",
    name: "Strict 4-Tier Spawning Hierarchy & Disjoint Write Scopes",
    summary:
      "Tier 0 Mind spawns Tier 1 Orchestrator; Tier 1 spawns Tier 2 Coordinators; Tier 2 spawns Tier 3 Workers. Active leases must maintain disjoint write scopes.",
    formulaOrRule: "Tier(N) -> Tier(N+1) Spawning Only + Disjoint Write Scopes",
    keyInvariants: [
      "Cross-tier spawning is strictly forbidden (e.g. Mind or Orchestrator directly spawning Tier 3 workers).",
      "Zero overlapping write scopes among concurrently active leases.",
      "Implementers never validate their own work; validators never hold implementation leases.",
    ],
    operationalGuidance:
      "Verify write scopes are disjoint before dispatching concurrent worker leases.",
    applicableTiers: [0, 1, 2, 3],
  },
  infinite_pulse_cadence: {
    id: "infinite_pulse_cadence",
    name: "Infinite Borderless Cadence & 5-Minute Supervisory Heartbeats",
    summary:
      "Mind operates indefinitely as an autonomous loop (`mind:pulse`); closing or dying is forbidden. Supervisory schedules maintain 5-minute heartbeat cycles.",
    formulaOrRule: "Cadence = Continuous Loop + 5-Min Supervisory Crons + Unified Evidence",
    keyInvariants: [
      "Supervisory heartbeat ticks occur every 3-5 minutes.",
      "Mind pulse never terminates; continuous background timers keep loop active.",
      "All task evidence stored strictly in unified directory `.capsules/<run>/evidence/`.",
    ],
    operationalGuidance:
      "Maintain active heartbeats (`task:heartbeat`, `mind:pulse`) and verify capsule health on every tick.",
    applicableTiers: [0, 1, 2],
  },
  dual_channel_validation: {
    id: "dual_channel_validation",
    name: "Dual-Channel Visual & DOM Validation",
    summary:
      "Synthesize computed DOM metrics (Channel 1) with rasterized visual screenshots (Channel 2) to eliminate virtual rendering blind spots.",
    formulaOrRule: "Channel 1 (DOM JSON) + Channel 2 (PNG Screenshots) = Ground Truth",
    keyInvariants: [
      "Channel 1: Computed DOM metrics (`visual-report.json`) verifying bounding boxes, styles, overflow, and APCA contrast.",
      "Channel 2: High-resolution screenshots (`.png`) verifying authentic browser layout engine rasterization.",
      "Cross-channel gap filling: when one channel is partial, the other corroborates.",
    ],
    operationalGuidance:
      "Mandate both DOM metrics and visual screenshots for every UI/frontend file modification.",
    applicableTiers: [2, 3],
  },
};

// ---------------------------------------------------------------------------
// Responsibility Checklist Item Definitions
// ---------------------------------------------------------------------------

export interface ChecklistItemDefinition {
  readonly id: string;
  readonly category: ChecklistCategory;
  readonly title: string;
  readonly mandate: string;
  readonly verificationCriteria: string;
  readonly protocolKey?: DecisionProtocolId | undefined;
  readonly targetRoles: readonly string[];
}

export const STANDING_CHECKLIST_DEFINITIONS: readonly ChecklistItemDefinition[] = [
  // Mind / Tier 0 Checklists
  {
    id: "RESP-MIND-001",
    category: "boundary",
    title: "Observe-Only Supervisory Confinement",
    mandate: "Maintain 100% observe-only posture; never edit code, stage files, or execute tasks directly.",
    verificationCriteria: "Zero file mutations and zero direct implementation commands on Mind thread.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["mind", "mind-auditor"],
  },
  {
    id: "RESP-MIND-002",
    category: "scaling",
    title: "Infinite Autonomous Pulse & Generational Rotation",
    mandate: "Drive perpetual pulse loops (`mind:pulse`) and rotate generational capsules preserving charter pins.",
    verificationCriteria: "Mind pulse active, continuous cadence timers armed, no self-termination attempts.",
    protocolKey: "infinite_pulse_cadence",
    targetRoles: ["mind"],
  },
  {
    id: "RESP-MIND-003",
    category: "scaling",
    title: "Dynamic Multi-Orchestrator Scaling & Work/Span Math",
    mandate: "Scale concurrent Tier 1 Orchestrators based on Work/Span math (P = W / S) without artificial caps.",
    verificationCriteria: "Concurrency scaling evaluated against critical path span length via `dag:view`.",
    protocolKey: "work_span_scaling",
    targetRoles: ["mind"],
  },
  {
    id: "RESP-MIND-004",
    category: "governance",
    title: "Strict Spawning Hierarchy & Domain Isolation",
    mandate: "Deploy strictly Tier 1 Orchestrators; never bypass tier hierarchy to spawn coordinators or workers directly.",
    verificationCriteria: "All child spawns belong to Tier 1 (`orchestrator`).",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["mind"],
  },

  // Orchestrator / Tier 1 Checklists
  {
    id: "RESP-ORCH-001",
    category: "boundary",
    title: "Plan Supervisor Zero-Code Invariant",
    mandate: "Supervise execution rounds and release packages without claiming tasks or modifying code.",
    verificationCriteria: "Zero direct task implementations or file edits on Orchestrator thread.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["orchestrator"],
  },
  {
    id: "RESP-ORCH-002",
    category: "dispatch",
    title: "Autonomous Multi-Round Loop & Domain Coordinator Dispatch",
    mandate: "Dispatch dedicated Tier 2 Domain Coordinators across disjoint candidate scopes and chain round lineage.",
    verificationCriteria: "Dispatched coordinators registered with non-overlapping domain scopes.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["orchestrator"],
  },
  {
    id: "RESP-ORCH-003",
    category: "governance",
    title: "Unresolved Finding Synthesis into Next-Round Prompts",
    mandate: "Synthesize open coordinator/critic findings into next round prompts rather than reporting raw unresolved text.",
    verificationCriteria: "Open findings triaged and integrated into round synthesis manifests.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["orchestrator"],
  },
  {
    id: "RESP-ORCH-004",
    category: "hygiene",
    title: "Background Thread Finalization Release Confinement",
    mandate: "Execute final git commits, git pushes, and global sync strictly on background threads before recycling.",
    verificationCriteria: "No release or git synchronization spillover to main interactive thread.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["orchestrator"],
  },

  // Coordinator / Tier 2 Checklists
  {
    id: "RESP-COORD-001",
    category: "boundary",
    title: "Pure Management & Zero-File-Edit Rule",
    mandate: "Own capsule lifecycle, task graph compilation, and dispatch without editing code or test files.",
    verificationCriteria: "Zero file mutations on coordinator thread; all code edits delegated to Tier 3 implementers.",
    protocolKey: "supervisor_zero_file_edit",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-002",
    category: "dispatch",
    title: "Continuous 1:1 Anti-Batching Wave Dispatch",
    mandate: "Dispatch claimable tasks continuously as soon as capacity opens without waiting for wave barriers.",
    verificationCriteria: "Queue drained continuously; ready tasks dispatched up to Work/Span headroom.",
    protocolKey: "anti_batching_continuous_dispatch",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-003",
    category: "boundary",
    title: "Disjoint Write Scope Exclusivity",
    mandate: "Enforce strict disjoint write scopes across active implementer leases with zero file collisions.",
    verificationCriteria: "Active leases have mutually exclusive write scope file lists.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-004",
    category: "verification",
    title: "Disposable Scratch Gate Falsification (`gate:prove`)",
    mandate: "Prove compiled task gates can actually fail on disposable scratch copies before trusting them.",
    verificationCriteria: "Gate commands proven with recorded negative failure proof.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-005",
    category: "verification",
    title: "Scepticism Pushback on Qualitative-Only Passes",
    mandate: "Reject rubber-stamped passes lacking quantitative evidence via structured `coordinator:pushback`.",
    verificationCriteria: "All accepted verdicts carry quantitative metrics and gate proofs.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-006",
    category: "verification",
    title: "4-Tier Viewport Resolution Matrix Enforcement",
    mandate: "Enforce multi-viewport verification (1920x1080, 1440x900, 768x1024, 390x844) on all visual/UI tasks.",
    verificationCriteria: "UI tasks verified across Desktop-Wide, Desktop, Tablet, and Mobile captures.",
    protocolKey: "four_tier_viewport_matrix",
    targetRoles: ["coordinator"],
  },
  {
    id: "RESP-COORD-007",
    category: "governance",
    title: "No Premature Run Completion",
    mandate: "Never declare run completion with live leases, open findings, unproven gates, or missing critic review.",
    verificationCriteria: "All wave lanes closed, 0 open findings, all gates green, completeness critic approved.",
    protocolKey: "anti_batching_continuous_dispatch",
    targetRoles: ["coordinator"],
  },

  // Implementer / Repairer / Tier 3 Checklists
  {
    id: "RESP-IMPL-001",
    category: "boundary",
    title: "Strict Disjoint Write Scope Confinement",
    mandate: "Create, edit, and delete files strictly within assigned leased write scope; never touch out-of-scope paths.",
    verificationCriteria: "All modified files fall strictly within the task's declared write_scope.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },
  {
    id: "RESP-IMPL-002",
    category: "hygiene",
    title: "Zero-Any TypeScript & Zero Suppressions",
    mandate: "Maintain 100% strict TypeScript types: 0 `any`, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 lint suppressions.",
    verificationCriteria: "Codebase compiles with 0 type errors and 0 type suppressions.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },
  {
    id: "RESP-IMPL-003",
    category: "verification",
    title: "Pre-Submission Verification & Regression Coverage",
    mandate: "Run scoped tests, verify negative paths, and add regression tests for repaired defect findings before submitting.",
    verificationCriteria: "Verification commands recorded via `run:exec` and cited in submission evidence.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },
  {
    id: "RESP-IMPL-004",
    category: "boundary",
    title: "Independent Validation Invariant",
    mandate: "Never validate, review, probe, or sign off own work; submit to independent validator.",
    verificationCriteria: "Implementer never claims validation lease or executes `task:review`.",
    protocolKey: "strict_tier_hierarchy",
    targetRoles: ["implementer", "repairer", "worker", "sub-implementer"],
  },

  // Validator / Tier 3 Checklists
  {
    id: "RESP-VAL-001",
    category: "verification",
    title: "Mandatory Adversarial Probe Round",
    mandate: "Record an adversarial probe demanding proof (`task:probe`) before issuing any pass review.",
    verificationCriteria: "Task has recorded at least 1 probe demand before pass verdict.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["validator", "validator-code-quality", "validator-product", "validator-security", "validator-system-design", "validator-ui-design", "sub-validator"],
  },
  {
    id: "RESP-VAL-002",
    category: "verification",
    title: "Dual-Channel Visual & DOM Verification for UI Tasks",
    mandate: "Synthesize computed DOM metrics (`visual-report.json`) and screenshot captures across 4 viewports for UI tasks.",
    verificationCriteria: "UI tasks verified with DOM bounds, APCA contrast, and 4-tier screenshots (> 1024B).",
    protocolKey: "four_tier_viewport_matrix",
    targetRoles: ["validator", "validator-ui-design", "sub-validator"],
  },
  {
    id: "RESP-VAL-003",
    category: "boundary",
    title: "Independent Verification & Anti-Anchoring Bias",
    mandate: "Inspect repository directly using independent gate proofs; ignore implementer confidence claims.",
    verificationCriteria: "All checks executed independently via `run:exec` on validator thread.",
    protocolKey: "scepticism_quantitative_proof",
    targetRoles: ["validator", "validator-code-quality", "validator-product", "validator-security", "validator-system-design", "validator-ui-design", "sub-validator"],
  },
];

// ---------------------------------------------------------------------------
// State Evaluation Interfaces & Logic
// ---------------------------------------------------------------------------

export type PersonaViolationSeverity = "none" | "low" | "medium" | "high" | "critical";

export interface PersonaViolation {
  readonly code: string;
  readonly rule: string;
  readonly severity: PersonaViolationSeverity;
  readonly message: string;
  readonly correctiveDirective: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface ChecklistItemEvaluation {
  readonly id: string;
  readonly category: ChecklistCategory;
  readonly title: string;
  readonly status: ChecklistItemStatus;
  readonly evidence?: string | undefined;
  readonly reason?: string | undefined;
  readonly correctiveDirective?: string | undefined;
}

export interface ActiveLeaseContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly role?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
  readonly isStale?: boolean | undefined;
  readonly heartbeatAgeMs?: number | undefined;
}

export interface SubordinateContext {
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly status: "active" | "idle" | "stale" | "completed" | "failed";
  readonly lastHeartbeatAgeMs?: number | undefined;
}

export interface QueueStateContext {
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly runningCount: number;
  readonly totalCount: number;
}

export interface ActionContext {
  readonly action: string;
  readonly targetFile?: string | undefined;
  readonly spawnedRole?: string | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly timestamp?: string | undefined;
}

export interface SupervisoryReminderEvaluationContext {
  readonly role: string;
  readonly agentId?: string | undefined;
  readonly runId?: string | null | undefined;
  readonly pulseId?: string | null | undefined;
  readonly tickNumber?: number | undefined;
  readonly cadenceMs?: number | undefined;
  readonly phase?: string | undefined;
  readonly activeLeases?: readonly ActiveLeaseContext[] | undefined;
  readonly subordinates?: readonly SubordinateContext[] | undefined;
  readonly queueState?: QueueStateContext | undefined;
  readonly openFindingsCount?: number | undefined;
  readonly failedGatesCount?: number | undefined;
  readonly unprovenGatesCount?: number | undefined;
  readonly recentActions?: readonly ActionContext[] | undefined;
  readonly fileModificationsOnSupervisoryThread?: readonly string[] | undefined;
  readonly directExecutionAttempts?: readonly string[] | undefined;
  readonly crossTierSpawns?: readonly string[] | undefined;
  readonly uiTasksMissingViewportValidation?: readonly string[] | undefined;
  readonly qualitativePassesWithoutProof?: readonly string[] | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly attemptedPrematureCompletion?: boolean | undefined;
  readonly adversarialProbeRecorded?: boolean | undefined;
  readonly hasUnresolvedProbeDemands?: boolean | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface SupervisoryStateEvaluation {
  readonly role: string;
  readonly tier: number;
  readonly compliant: boolean;
  readonly driftScore: number;
  readonly severity: PersonaViolationSeverity;
  readonly checklist: readonly ChecklistItemEvaluation[];
  readonly violations: readonly PersonaViolation[];
  readonly correctiveDirectives: readonly string[];
  readonly applicableDecisionProtocols: readonly DecisionProtocolDefinition[];
  readonly summary: string;
}

export interface SupervisoryScopeConflict {
  readonly taskA: string;
  readonly taskB: string;
  readonly overlappingFiles: readonly string[];
}

function computeScopeOverlaps(
  leases: readonly ActiveLeaseContext[],
): readonly SupervisoryScopeConflict[] {
  const collisions: { taskA: string; taskB: string; overlappingFiles: string[] }[] = [];
  for (let i = 0; i < leases.length; i++) {
    for (let j = i + 1; j < leases.length; j++) {
      const a = leases[i]!;
      const b = leases[j]!;
      const scopeA = a.writeScope ?? [];
      const scopeB = b.writeScope ?? [];
      const common = scopeA.filter((f) => scopeB.includes(f));
      if (common.length > 0) {
        collisions.push({
          taskA: a.taskId,
          taskB: b.taskId,
          overlappingFiles: common,
        });
      }
    }
  }
  return collisions;
}

export function evaluateSupervisoryState(
  context: SupervisoryReminderEvaluationContext,
  unifiedModel?: UnifiedAgentModel,
): SupervisoryStateEvaluation {
  const role = normalizeRoleName(context.role);
  const model = unifiedModel ?? loadUnifiedAgentModel(role);
  const tier = model.tier;

  const violations: PersonaViolation[] = [];
  const correctiveDirectives: string[] = [];

  // Filter checklist definitions relevant to this role
  const relevantChecklists = STANDING_CHECKLIST_DEFINITIONS.filter(
    (def) => def.targetRoles.includes(role) || (def.targetRoles.includes("validator") && role.startsWith("validator")),
  );

  const checklistEvaluations: ChecklistItemEvaluation[] = [];

  // 1. Invariant: Supervisor Zero-File-Edit Rule
  const modifiedFiles = [
    ...(context.fileModificationsOnSupervisoryThread ?? []),
    ...(context.recentActions?.filter((a) => a.action === "edit_file" || a.action === "write_file" || a.action === "delete_file").map((a) => a.targetFile ?? "unknown") ?? []),
  ];

  if (tier < 3 && modifiedFiles.length > 0) {
    violations.push({
      code: "SUPERVISOR_ZERO_FILE_EDIT_BREACH",
      rule: "Supervisory threads (Tier 0/1/2) must NEVER modify repository code directly.",
      severity: "critical",
      message: `Supervisory role ${role.toUpperCase()} directly modified ${modifiedFiles.length} file(s): ${modifiedFiles.slice(0, 3).join(", ")}.`,
      correctiveDirective:
        "Cease all direct file edits immediately. Delegate code edits to Tier 3 Implementers via host native subagent dispatch.",
      evidence: { modifiedFiles },
    });
    correctiveDirectives.push(
      "Revert any direct file edits made on supervisory thread and dispatch a Tier 3 Implementer subagent.",
    );
  }

  // 2. Invariant: Direct Task Execution on Supervisor
  const directExecutionAttempts = [
    ...(context.directExecutionAttempts ?? []),
    ...(context.recentActions?.filter((a) => a.action === "claim_task" || a.action === "implement_task" || a.action === "repair_task").map((a) => a.action) ?? []),
  ];

  if (tier < 3 && directExecutionAttempts.length > 0) {
    violations.push({
      code: "SUPERVISOR_TASK_SELF_EXECUTION_BREACH",
      rule: "Supervisors must coordinate and delegate; they never claim or implement tasks.",
      severity: "critical",
      message: `${role.toUpperCase()} attempted self-implementation actions: ${directExecutionAttempts.join(", ")}.`,
      correctiveDirective:
        "Release self-claimed tasks with `task:release` and dispatch dedicated Tier 3 workers.",
      evidence: { directExecutionAttempts },
    });
    correctiveDirectives.push(
      "Release self-claimed tasks using `task:release` and reassign to Tier 3 Implementers.",
    );
  }

  // 3. Invariant: Strict 4-Tier Spawning Hierarchy
  const crossTierSpawns = [
    ...(context.crossTierSpawns ?? []),
    ...(context.recentActions?.filter((a) => {
      if (!a.spawnedRole) return false;
      const spawned = normalizeRoleName(a.spawnedRole);
      return !model.spawns.map(normalizeRoleName).includes(spawned);
    }).map((a) => a.spawnedRole!) ?? []),
  ];

  if (crossTierSpawns.length > 0) {
    violations.push({
      code: "CROSS_TIER_SPAWN_HIERARCHY_BREACH",
      rule: "Subagent spawning must strictly adhere to the 4-Tier hierarchy.",
      severity: "critical",
      message: `${role.toUpperCase()} (Tier ${tier}) attempted unauthorized spawns: ${crossTierSpawns.join(", ")}. Permitted: [${model.spawns.join(", ")}].`,
      correctiveDirective:
        `Terminate invalid subagent dispatches and route spawning through proper tier channels ([${model.spawns.join(", ")}]).`,
      evidence: { crossTierSpawns, permittedSpawns: model.spawns },
    });
    correctiveDirectives.push(
      `Terminate unauthorized subagent dispatches and dispatch only permitted roles ([${model.spawns.join(", ")}]).`,
    );
  }

  // 4. Invariant: Subordinate Write Scope Exclusivity
  const leases = context.activeLeases ?? [];
  const overlaps = computeScopeOverlaps(leases);
  if (overlaps.length > 0) {
    violations.push({
      code: "WRITE_SCOPE_COLLISION_BREACH",
      rule: "Concurrently active task leases must hold mutually exclusive write scopes.",
      severity: "high",
      message: `Detected ${overlaps.length} write scope overlap(s) among active leases: ${overlaps.map((o) => `${o.taskA} vs ${o.taskB}`).join(", ")}.`,
      correctiveDirective:
        "Enforce write scope exclusivity. Re-partition colliding tasks into sequential waves.",
      evidence: { overlaps },
    });
    correctiveDirectives.push(
      "Re-partition colliding tasks so that tasks touching identical files execute in sequential waves.",
    );
  }

  // 5. Invariant: Continuous Dispatch & Queue Headroom (1:1 Anti-Batching & P=W/S)
  const queue = context.queueState;
  if (tier === 2 && queue && queue.readyCount > 0 && queue.runningCount === 0 && queue.blockedCount === 0) {
    violations.push({
      code: "QUEUE_IDLE_ANTI_BATCHING_NEGLECT",
      rule: "Coordinator must dispatch ready tasks continuously the instant capacity frees.",
      severity: "medium",
      message: `Execution queue has ${queue.readyCount} ready task(s), but 0 active workers are dispatched.`,
      correctiveDirective:
        "Dispatch ready tasks immediately via `queue:wave` up to Work/Span concurrency headroom (P = W / S).",
      evidence: { queue },
    });
    correctiveDirectives.push(
      "Dispatch ready tasks in parallel wave lanes immediately via `queue:wave`.",
    );
  }

  // 6. Invariant: Unproven Gates (`gate:prove`)
  const unprovenGatesCount = context.unprovenGatesCount ?? 0;
  if (tier === 2 && unprovenGatesCount > 0) {
    violations.push({
      code: "UNPROVEN_GATE_RISK",
      rule: "Compiled task gates must be proven to fail on disposable scratch copies before trusting them.",
      severity: "medium",
      message: `Found ${unprovenGatesCount} compiled gate(s) that have not been verified via \`gate:prove\`.`,
      correctiveDirective:
        "Execute `gate:prove` on disposable scratch copies to verify gates can fail on negative defects.",
      evidence: { unprovenGatesCount },
    });
    correctiveDirectives.push(
      "Run `gate:prove` on compiled task gates to verify falsifiability before accepting passes.",
    );
  }

  // 7. Invariant: Scepticism Pushback & Qualitative-Only Passes
  const qualitativePasses = context.qualitativePassesWithoutProof ?? [];
  if (tier <= 2 && qualitativePasses.length > 0) {
    violations.push({
      code: "QUALITATIVE_PASS_RUBBER_STAMP_BREACH",
      rule: "Supervisors must reject superficial or qualitative validator passes lacking quantitative metrics.",
      severity: "high",
      message: `Accepted ${qualitativePasses.length} validator pass(es) lacking quantitative proof metrics.`,
      correctiveDirective:
        "Issue `coordinator:pushback` on unverified passes and mandate DOM bounds, APCA contrast, and screenshot proofs.",
      evidence: { qualitativePasses },
    });
    correctiveDirectives.push(
      "Issue `coordinator:pushback` against unverified validator reports and require quantitative DOM/screenshot proof.",
    );
  }

  // 8. Invariant: 4-Tier Viewport Matrix for UI Tasks
  const uiTasksMissingViewports = context.uiTasksMissingViewportValidation ?? [];
  if (uiTasksMissingViewports.length > 0) {
    violations.push({
      code: "FOUR_TIER_VIEWPORT_MATRIX_BREACH",
      rule: "All UI/visual frontend tasks mandate multi-viewport verification (1920x1080, 1440x900, 768x1024, 390x844).",
      severity: "high",
      message: `${uiTasksMissingViewports.length} UI task(s) missing multi-viewport verification: ${uiTasksMissingViewports.join(", ")}.`,
      correctiveDirective:
        "Mandate dual-channel visual validation across Desktop-Wide, Desktop, Tablet, and Mobile viewports.",
      evidence: { uiTasksMissingViewports },
    });
    correctiveDirectives.push(
      "Execute multi-viewport captures across all 4 tiers (1920x1080, 1440x900, 768x1024, 390x844) for UI tasks.",
    );
  }

  // 9. Invariant: Premature Run Completion
  if (context.attemptedPrematureCompletion) {
    const hasBlockers =
      (leases.length > 0) ||
      ((context.openFindingsCount ?? 0) > 0) ||
      ((context.failedGatesCount ?? 0) > 0) ||
      (unprovenGatesCount > 0);

    if (hasBlockers) {
      violations.push({
        code: "PREMATURE_RUN_COMPLETION_BREACH",
        rule: "Never declare run completion with active leases, open findings, or unproven gates.",
        severity: "critical",
        message: "Attempted `run:complete` while active blockers, open findings, or unproven gates remain.",
        correctiveDirective:
          "Halt run completion. Resolve all open findings, verify gates, and obtain completeness critic sign-off.",
        evidence: {
          activeLeasesCount: leases.length,
          openFindingsCount: context.openFindingsCount,
          failedGatesCount: context.failedGatesCount,
        },
      });
      correctiveDirectives.push(
        "Resolve all open findings and verify all wave gates before declaring run completion.",
      );
    }
  }

  // 10. Invariant: Validator Mandatory Adversarial Probe
  if (role.startsWith("validator") && context.adversarialProbeRecorded === false) {
    violations.push({
      code: "MANDATORY_ADVERSARIAL_PROBE_OMISSION",
      rule: "Adversarial validators must record at least 1 probe demand (`task:probe`) before passing.",
      severity: "high",
      message: "Validator attempted or issued a review without recording a mandatory adversarial probe round.",
      correctiveDirective:
        "Execute `task:probe` demanding proof of edge cases or error handling before certifying pass.",
    });
    correctiveDirectives.push(
      "Record an adversarial probe demand with `task:probe` before issuing a pass verdict.",
    );
  }

  // Map violations to checklist items
  for (const def of relevantChecklists) {
    const matchingViolation = violations.find(
      (v) =>
        (def.protocolKey && v.code.toLowerCase().includes(def.protocolKey.toLowerCase())) ||
        v.message.toLowerCase().includes(def.title.toLowerCase()),
    );

    if (matchingViolation) {
      checklistEvaluations.push({
        id: def.id,
        category: def.category,
        title: def.title,
        status: "violated",
        reason: matchingViolation.message,
        correctiveDirective: matchingViolation.correctiveDirective,
      });
    } else {
      checklistEvaluations.push({
        id: def.id,
        category: def.category,
        title: def.title,
        status: "completed",
        evidence: `Compliant with standing mandate: ${def.mandate}`,
      });
    }
  }

  // Compute severity and drift score
  let maxSeverity: PersonaViolationSeverity = "none";
  let driftScore = 0;

  for (const v of violations) {
    if (v.severity === "critical") {
      maxSeverity = "critical";
      driftScore += 0.5;
    } else if (v.severity === "high" && maxSeverity !== "critical") {
      maxSeverity = "high";
      driftScore += 0.3;
    } else if (v.severity === "medium" && maxSeverity !== "critical" && maxSeverity !== "high") {
      maxSeverity = "medium";
      driftScore += 0.15;
    } else if (v.severity === "low" && maxSeverity === "none") {
      maxSeverity = "low";
      driftScore += 0.05;
    }
  }

  driftScore = Math.min(1.0, Math.round(driftScore * 100) / 100);
  const compliant = violations.length === 0;

  // Resolve applicable decision protocols for this role tier
  const applicableProtocols = Object.values(DECISION_PROTOCOLS).filter((proto) =>
    proto.applicableTiers.includes(tier),
  );

  const summary = compliant
    ? `Agent ${role.toUpperCase()} (Tier ${tier}) is fully compliant with 0 boundary violations and all responsibility checklists verified.`
    : `Agent ${role.toUpperCase()} (Tier ${tier}) exhibits ${maxSeverity.toUpperCase()} boundary drift (drift score: ${driftScore}). ${violations.length} violation(s) detected.`;

  return {
    role,
    tier,
    compliant,
    driftScore,
    severity: maxSeverity,
    checklist: checklistEvaluations,
    violations,
    correctiveDirectives,
    applicableDecisionProtocols: applicableProtocols,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Persona Reminder Builder & Markdown Rendering
// ---------------------------------------------------------------------------

export interface SupervisoryPersonaReminderOptions {
  readonly role: string;
  readonly agentId?: string | undefined;
  readonly runId?: string | null | undefined;
  readonly pulseId?: string | null | undefined;
  readonly tickNumber?: number | undefined;
  readonly cadenceMs?: number | undefined;
  readonly startedAt?: string | number | Date | undefined;
  readonly now?: string | number | Date | undefined;
  readonly context?: SupervisoryReminderEvaluationContext | undefined;
  readonly manifestLoaderOptions?: ManifestLoaderOptions | undefined;
}

export interface SupervisoryPersonaReminder {
  readonly id: string;
  readonly role: string;
  readonly tier: number;
  readonly agentId: string | null;
  readonly runId: string | null;
  readonly pulseId: string | null;
  readonly tickNumber: number;
  readonly timestamp: string;
  readonly cadenceMs: number;
  readonly elapsedMs: number;
  readonly persona: {
    readonly name: string;
    readonly displayName: string;
    readonly shortDescription: string;
    readonly archetype: string;
    readonly coreMandate: string;
    readonly may: readonly string[];
    readonly mustNot: readonly string[];
    readonly commands: readonly string[];
    readonly spawns: readonly string[];
    readonly instructions: string;
  };
  readonly decisionProtocols: readonly DecisionProtocolDefinition[];
  readonly checklist: readonly ChecklistItemEvaluation[];
  readonly evaluation: SupervisoryStateEvaluation;
  readonly correctiveDirectives: readonly string[];
  readonly renderedMarkdown: string;
  readonly compactPromptInjection: string;
  readonly heartbeatTickBrief: string;
}

function parseTimeMs(val?: string | number | Date | undefined): number {
  if (typeof val === "number") return val;
  if (val instanceof Date) return val.getTime();
  if (typeof val === "string") {
    const p = Date.parse(val);
    if (Number.isFinite(p)) return p;
  }
  return Date.now();
}

export function constructSupervisoryPersonaReminder(
  options: SupervisoryPersonaReminderOptions,
): SupervisoryPersonaReminder {
  const role = normalizeRoleName(options.role);
  const unifiedModel = loadUnifiedAgentModel(role, options.manifestLoaderOptions);

  const cadenceMs = options.cadenceMs ?? 180_000; // 3 minutes
  const nowMs = parseTimeMs(options.now);
  const startedAtMs = options.startedAt !== undefined ? parseTimeMs(options.startedAt) : nowMs;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);

  let tickNumber = options.tickNumber;
  if (tickNumber === undefined) {
    tickNumber = Math.max(1, Math.floor(elapsedMs / cadenceMs) + 1);
  }

  const timestamp = new Date(nowMs).toISOString();
  const id = `persona-reminder-${role}-tick${tickNumber}-${nowMs.toString(36)}`;

  // Evaluate active state
  const evalContext: SupervisoryReminderEvaluationContext = options.context ?? {
    role,
    agentId: options.agentId,
    runId: options.runId,
    pulseId: options.pulseId,
    tickNumber,
    cadenceMs,
    now: nowMs,
  };

  const evaluation = evaluateSupervisoryState(evalContext, unifiedModel);

  // Markdown Construction
  const lines: string[] = [];
  lines.push(`### 🛡️ Supervisory Persona & Responsibility Reminder [Tick #${tickNumber}]`);
  lines.push(`- **Role**: \`${role.toUpperCase()}\` (Tier ${unifiedModel.tier})`);
  lines.push(`- **Display Name**: ${unifiedModel.displayName}`);
  lines.push(`- **Archetype**: ${unifiedModel.archetype}`);
  lines.push(`- **Timestamp**: \`${timestamp}\` (Cadence: ${Math.round(cadenceMs / 1000)}s)`);
  if (options.runId) lines.push(`- **Run ID**: \`${options.runId}\``);
  if (options.pulseId) lines.push(`- **Pulse ID**: \`${options.pulseId}\``);
  if (options.agentId) lines.push(`- **Agent ID**: \`${options.agentId}\``);
  lines.push("");

  lines.push(`> [!NOTE]\n> **Core Mandate**: ${unifiedModel.coreMandate}\n`);

  // Section 1: Binding Authorities ('may') & Absolute Prohibitions ('must_not')
  lines.push("#### 📜 Binding Capability Contract (`roles/" + role + ".md`)");
  lines.push("**Permitted Authorities (`may`):**");
  for (const m of unifiedModel.may) {
    lines.push(`- 🟢 ${m}`);
  }
  lines.push("");

  lines.push("**Absolute Prohibitions (`must_not`):**");
  for (const mn of unifiedModel.mustNot) {
    lines.push(`- 🔴 ${mn}`);
  }
  lines.push("");

  // Section 2: Core Decision Protocols
  lines.push("#### 🧠 Standing Decision Protocols");
  for (const proto of evaluation.applicableDecisionProtocols) {
    lines.push(`##### 📐 ${proto.name} (\`${proto.formulaOrRule}\`)`);
    lines.push(`*Summary*: ${proto.summary}`);
    lines.push(`*Key Invariants*:`);
    for (const inv of proto.keyInvariants) {
      lines.push(`  - ⚖️ ${inv}`);
    }
    lines.push(`*Guidance*: ${proto.operationalGuidance}`);
    lines.push("");
  }

  // Section 3: Active Responsibility Checklist
  lines.push("#### 📋 Role Responsibility Checklist Evaluation");
  for (const item of evaluation.checklist) {
    const statusEmoji =
      item.status === "completed"
        ? "✅ COMPLETED"
        : item.status === "violated"
          ? "❌ VIOLATED"
          : item.status === "neglected"
            ? "⚠️ NEGLECTED"
            : "⏳ PENDING";
    lines.push(`- **[${statusEmoji}] ${item.title}** (\`${item.id}\` / ${item.category})`);
    if (item.reason) {
      lines.push(`  *Issue*: ${item.reason}`);
    }
    if (item.correctiveDirective) {
      lines.push(`  *Directive*: 🚨 ${item.correctiveDirective}`);
    }
  }
  lines.push("");

  // Section 4: Corrective Directives (if any)
  if (evaluation.correctiveDirectives.length > 0) {
    lines.push("#### 🚨 Immediate Corrective Directives");
    for (let i = 0; i < evaluation.correctiveDirectives.length; i++) {
      lines.push(`${i + 1}. ⚡ ${evaluation.correctiveDirectives[i]}`);
    }
    lines.push("");
  }

  const renderedMarkdown = lines.join("\n");

  // Compact prompt injection string for high-density heartbeat injection
  const compactDirectives = evaluation.correctiveDirectives.length > 0
    ? ` DIRECTIVES: ${evaluation.correctiveDirectives.join(" | ")}`
    : "";
  const compactPromptInjection = `[PERSONA REMINDER Tick #${tickNumber}]: Role=${role.toUpperCase()} (Tier ${unifiedModel.tier}). Mandate: ${unifiedModel.coreMandate}. Invariants: (1) Zero direct file edits on supervisory threads; (2) P=W/S Work/Span continuous wave dispatch; (3) 4-tier multi-viewport validation; (4) Quantitative gate proofs only.${compactDirectives}`;

  const heartbeatTickBrief = `Heartbeat Tick #${tickNumber} [${role.toUpperCase()}]: ${evaluation.summary}`;

  return {
    id,
    role,
    tier: unifiedModel.tier,
    agentId: options.agentId ?? null,
    runId: options.runId ?? null,
    pulseId: options.pulseId ?? null,
    tickNumber,
    timestamp,
    cadenceMs,
    elapsedMs,
    persona: {
      name: unifiedModel.name,
      displayName: unifiedModel.displayName,
      shortDescription: unifiedModel.shortDescription,
      archetype: unifiedModel.archetype,
      coreMandate: unifiedModel.coreMandate,
      may: unifiedModel.may,
      mustNot: unifiedModel.mustNot,
      commands: unifiedModel.commands,
      spawns: unifiedModel.spawns,
      instructions: unifiedModel.instructions,
    },
    decisionProtocols: evaluation.applicableDecisionProtocols,
    checklist: evaluation.checklist,
    evaluation,
    correctiveDirectives: evaluation.correctiveDirectives,
    renderedMarkdown,
    compactPromptInjection,
    heartbeatTickBrief,
  };
}
