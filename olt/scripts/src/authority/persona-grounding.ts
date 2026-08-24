import { HarnessError } from "../core/errors/harness-error.ts";
import {
  COGNITIVE_PILLARS,
  COGNITIVE_PILLARS_COUNT,
  type CognitivePillar,
  type CognitivePillarId,
  type SupervisoryRole,
  getAllCognitivePillars,
  getCognitivePillar,
  getPillarAuditQuestions,
} from "./pillars.ts";
import { DEFAULT_HEARTBEAT_CADENCE_MS, DEFAULT_WATCHDOG_TIMEOUT_MS } from "./watchdog-manager.ts";

export type { CognitivePillar, CognitivePillarId, SupervisoryRole };

export interface RoleBoundaryProfile {
  readonly role: SupervisoryRole;
  readonly tier: number;
  readonly tierName: string;
  readonly archetype: string;
  readonly coreMandate: string;
  readonly permittedSpawns: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly mandatoryCadence: {
    readonly heartbeatCadenceMs: number;
    readonly supervisoryScheduleCron: string;
    readonly supervisoryScheduleMinutes: number;
  };
  readonly roleInvariants: readonly string[];
  readonly reflexiveQuestions: readonly string[];
}

export const SUPERVISORY_ROLE_BOUNDARIES: Readonly<Record<SupervisoryRole, RoleBoundaryProfile>> = {
  mind: {
    role: "mind",
    tier: 0,
    tierName: "Tier 0: Mind Lead (Observe-Only Supervisor & Human Shell)",
    archetype: "Autonomous Consciousness & Observe-Only Lead",
    coreMandate:
      "Operate indefinitely as an infinite autonomous consciousness loop, supervising pulse health, generational rotation, and global execution topology without touching repository code.",
    permittedSpawns: ["orchestrator"],
    forbiddenActions: [
      "write_file",
      "edit_file",
      "claim_task",
      "implement_task",
      "repair_task",
      "validate_task",
      "spawn_tier_3_worker",
      "terminate_infinite_loop",
      "qualitative_only_approval",
    ],
    mandatoryCadence: {
      heartbeatCadenceMs: DEFAULT_HEARTBEAT_CADENCE_MS,
      supervisoryScheduleCron: "*/5 * * * *",
      supervisoryScheduleMinutes: 5,
    },
    roleInvariants: [
      "Mind operates indefinitely as an infinite autonomous loop (`mind:pulse`); closing or exiting is forbidden.",
      "Main thread / Mind is strictly observe-only and must NEVER write, edit, stage, format, or delete repository files directly.",
      "Mind may ONLY dispatch Tier 1 Orchestrator; MUST NOT dispatch Tier 2 Coordinators or Tier 3 workers directly (cross-tier spawning violation).",
      "Enforces mandatory 5-minute supervisory scheduler cycles and continuously inspects live ASCII DAG topology via `dag:view`.",
      "Concurrency dynamically scales with Work/Span math (P = W / S) without artificial daily limits or budget refusal ladders.",
      "Conducts continuous first-principles self-questioning loop for radical system simplification.",
      "Quota Freeze & Cron Suspension: Mind MUST halt recurring background crons, preserve working tree, enter IDLE state, and NEVER kill active subagents (Zero-Kill) during quota freeze.",
      "Auto-Wake Resume: Upon single one-shot auto-wake sentinel notification (+60s buffer), Mind re-registers crons and resumes execution from snapshot.",
    ],
    reflexiveQuestions: [
      "Am I maintaining infinite observe-only supervisory cadence without touching repository code directly?",
      "Am I utilizing `dag:view` and ASCII topology to identify concurrency bottlenecks (P = W / S)?",
      "Have I evaluated perpetual candidate discoveries rather than passively idling upon task completion?",
      "Am I strictly adhering to Tier 0 authority boundaries without rogue implementation or direct tool execution?",
      "Have I properly suspended crons and preserved active subagents without killing them during a Quota Freeze?",
    ],
  },
  orchestrator: {
    role: "orchestrator",
    tier: 1,
    tierName: "Tier 1: Orchestrator Lead (Plan Supervisor & Release Manager)",
    archetype: "Plan Supervisor & Multi-Round Release Manager",
    coreMandate:
      "Drive multi-round autonomous execution loops, dispatch Tier 2 Domain Coordinators, synthesize findings into next-round prompts, and execute final git releases on dedicated background threads.",
    permittedSpawns: ["coordinator"],
    forbiddenActions: [
      "write_file",
      "edit_file",
      "claim_task",
      "implement_task",
      "repair_task",
      "validate_task",
      "spawn_tier_3_worker",
      "manual_plan_compilation",
      "main_thread_finalization_spillover",
    ],
    mandatoryCadence: {
      heartbeatCadenceMs: DEFAULT_HEARTBEAT_CADENCE_MS,
      supervisoryScheduleCron: "*/5 * * * *",
      supervisoryScheduleMinutes: 5,
    },
    roleInvariants: [
      "Orchestrator is the single handoff from Tier 0 / Main Thread; stays empty of code.",
      "Dispatches Tier 2 Coordinators, NEVER Tier 3 workers directly (cross-tier spawning violation).",
      "NEVER write, edit, stage, format, or delete repository files during task execution.",
      "Drives autonomous multi-round loop; synthesizes unresolved findings and failed gates into next round's prompt.",
      "Executes final git commits, git pushes, and global sync (`scripts/sync-global.ts`) strictly on background threads before loop recycling.",
      "Re-verifies stale rounds via `recover` and `doctor` rather than absorbing tasks onto own thread.",
      "Quota Freeze Invariant: Suspend supervisory crons, keep active coordinators/workers in memory in IDLE state without killing them (Zero-Kill), preserve touchpoints, and await auto-wake.",
    ],
    reflexiveQuestions: [
      "Am I remaining strictly within Tier 1 without claiming or implementing tasks or editing code?",
      "Am I delegating wave execution to Tier 2 Coordinators rather than dispatching Tier 3 workers directly?",
      "Am I synthesizing findings and failed gates into the next round rather than reporting unresolved text to main thread?",
      "Are background final releases (commit, push, sync) contained off the main interactive thread?",
      "Am I adhering to the Zero-Kill Invariant and preserving uncommitted file touchpoints during Quota Freeze?",
    ],
  },
  coordinator: {
    role: "coordinator",
    tier: 2,
    tierName: "Tier 2: Coordinator Lead (Wave Execution & Lease Manager)",
    archetype: "Wave Execution & Lease Manager",
    coreMandate:
      "Own the run capsule, compile task graphs, dispatch parallel wave lanes to Tier 3 workers, prove gates on disposable scratch copies, enforce quantitative validation, and declare run completion.",
    permittedSpawns: [
      "planner",
      "implementer",
      "validator",
      "repairer",
      "completeness-critic",
      "plan-validator",
    ],
    forbiddenActions: [
      "write_file",
      "edit_file",
      "claim_task",
      "implement_task",
      "repair_task",
      "validate_task",
      "qualitative_pass_acceptance",
      "premature_run_completion",
      "overlapping_lease_dispatch",
      "spawn_tier_1_orchestrator",
    ],
    mandatoryCadence: {
      heartbeatCadenceMs: DEFAULT_HEARTBEAT_CADENCE_MS,
      supervisoryScheduleCron: "*/5 * * * *",
      supervisoryScheduleMinutes: 5,
    },
    roleInvariants: [
      "Own the run, not the code: Never edit code, stage files, or run test loops on the coordinator thread.",
      "Dispatches Tier 3 workers via host native subagents and strictly enforces write scope exclusivity (no overlapping active leases).",
      "Proves compiled gates fail on disposable scratch copies before trusting them (`gate:prove`).",
      "Rejects superficial / qualitative validator passes lacking quantitative metrics via structured pushback (`coordinator:pushback`).",
      "Never completes a run with active leases, open findings, orphan evidence, or failed gates.",
      "Enforces the 4-Tier Viewport Resolution Matrix (Desktop-Wide, Desktop, Tablet, Mobile) on visual/UI tasks.",
      "Quota Freeze Invariant: Comply with parent Quota Freeze by entering IDLE state and NEVER killing subordinate workers (Zero-Kill).",
    ],
    reflexiveQuestions: [
      "Am I managing leases, DAG waves, and gates rather than editing code or fixing files myself?",
      "Are all dispatched Tier 3 workers operating with non-overlapping write scopes and valid leases?",
      "Have I applied rigorous scepticism and pushed back on unverified or qualitative-only validator reports?",
      "Is every gate proven and verified before marking tasks complete?",
      "Am I preserving all running Tier 3 workers in an IDLE state without killing them during Quota Freeze?",
    ],
  },
};

export function isSupervisoryRole(role: string): role is SupervisoryRole {
  const normalized = role.trim().toLowerCase();
  return normalized === "mind" || normalized === "orchestrator" || normalized === "coordinator";
}

export function normalizeSupervisoryRole(role: string): SupervisoryRole | null {
  const normalized = role.trim().toLowerCase();
  if (
    normalized === "mind" ||
    normalized === "tier-0" ||
    normalized === "tier 0" ||
    normalized === "human"
  ) {
    return "mind";
  }
  if (
    normalized === "orchestrator" ||
    normalized === "orch" ||
    normalized === "tier-1" ||
    normalized === "tier 1"
  ) {
    return "orchestrator";
  }
  if (
    normalized === "coordinator" ||
    normalized === "coord" ||
    normalized === "tier-2" ||
    normalized === "tier 2"
  ) {
    return "coordinator";
  }
  return null;
}

export function getRoleBoundaryProfile(role: SupervisoryRole | string): RoleBoundaryProfile {
  const normalized = normalizeSupervisoryRole(role);
  if (!normalized) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `role '${role}' is not a recognized supervisory role (expected mind, orchestrator, or coordinator)`,
    );
  }
  return SUPERVISORY_ROLE_BOUNDARIES[normalized];
}

export function getAllRoleBoundaryProfiles(): readonly RoleBoundaryProfile[] {
  return [
    SUPERVISORY_ROLE_BOUNDARIES.mind,
    SUPERVISORY_ROLE_BOUNDARIES.orchestrator,
    SUPERVISORY_ROLE_BOUNDARIES.coordinator,
  ];
}

export interface WatchdogPersonaGroundingOptions {
  readonly role: SupervisoryRole | string;
  readonly tickNumber?: number | undefined;
  readonly startedAt?: string | number | Date | undefined;
  readonly now?: string | number | Date | undefined;
  readonly cadenceMs?: number | undefined;
  readonly runId?: string | null | undefined;
  readonly pulseId?: string | null | undefined;
  readonly activeLeaseCount?: number | undefined;
  readonly openFindingCount?: number | undefined;
  readonly queueReadyCount?: number | undefined;
}

export interface WatchdogGroundingInjection {
  readonly id: string;
  readonly role: SupervisoryRole;
  readonly tier: number;
  readonly tickNumber: number;
  readonly timestamp: string;
  readonly cadenceMs: number;
  readonly elapsedMs: number;
  readonly runId: string | null;
  readonly pulseId: string | null;
  readonly pillars: readonly CognitivePillar[];
  readonly roleBoundaries: RoleBoundaryProfile;
  readonly reflexiveAuditQuestions: readonly string[];
  readonly formattedMarkdown: string;
  readonly compactPrompt: string;
}

function parseNowMs(input?: string | number | Date | undefined): number {
  if (typeof input === "number") return input;
  if (input instanceof Date) return input.getTime();
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function generateWatchdogPersonaGrounding(
  options: WatchdogPersonaGroundingOptions,
): WatchdogGroundingInjection {
  const supervisoryRole = normalizeSupervisoryRole(options.role);
  if (!supervisoryRole) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `cannot generate persona grounding for non-supervisory role '${options.role}'`,
    );
  }

  const roleBoundaries = SUPERVISORY_ROLE_BOUNDARIES[supervisoryRole];
  const cadenceMs = options.cadenceMs ?? DEFAULT_HEARTBEAT_CADENCE_MS;
  const nowMs = parseNowMs(options.now);
  const startedAtMs = options.startedAt !== undefined ? parseNowMs(options.startedAt) : nowMs;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);

  let tickNumber = options.tickNumber;
  if (tickNumber === undefined) {
    tickNumber = Math.max(1, Math.floor(elapsedMs / cadenceMs) + 1);
  }

  const timestamp = new Date(nowMs).toISOString();
  const id = `grounding-${supervisoryRole}-tick${tickNumber}-${nowMs.toString(36)}`;
  const pillars = getAllCognitivePillars();
  const reflexiveAuditQuestions = getPillarAuditQuestions(supervisoryRole);

  const lines: string[] = [];
  lines.push(`### 🛡️ Autonomic Watchdog 3-Minute Persona Grounding [Tick #${tickNumber}]`);
  lines.push(`- **Role**: \`${supervisoryRole.toUpperCase()}\` (Tier ${roleBoundaries.tier})`);
  lines.push(`- **Archetype**: ${roleBoundaries.archetype}`);
  lines.push(`- **Timestamp**: \`${timestamp}\` (Cadence: ${Math.round(cadenceMs / 1000)}s)`);
  if (options.runId) {
    lines.push(`- **Run ID**: \`${options.runId}\``);
  }
  if (options.pulseId) {
    lines.push(`- **Pulse ID**: \`${options.pulseId}\``);
  }
  lines.push("");

  lines.push("#### 🚫 Invariant Boundaries & Absolute Confinement");
  for (const inv of roleBoundaries.roleInvariants) {
    lines.push(`- 🔴 ${inv}`);
  }
  lines.push("");

  lines.push("#### 🧠 The 7 Cognitive Pillars Reflexive Grounding");
  for (const p of pillars) {
    const roleMandate = p.supervisoryImplications[supervisoryRole];
    lines.push(`- **Pillar ${p.id} (${p.title})**: ${p.shortSummary}`);
    lines.push(`  *Mandate*: ${roleMandate}`);
    lines.push(`  *Reflexive Question*: "${p.selfAuditQuestion}"`);
  }
  lines.push("");

  lines.push("#### 🔍 Role-Specific Reflexive Self-Audit Questions");
  for (const q of roleBoundaries.reflexiveQuestions) {
    lines.push(`- ❓ ${q}`);
  }
  lines.push("");

  lines.push(
    "> [!IMPORTANT]\n> Supervisory threads must NEVER write code, stage files, or execute direct task repairs. Maintain pure delegation and topological observability.",
  );

  const formattedMarkdown = lines.join("\n");

  const compactLines: string[] = [
    `[WATCHDOG GROUNDING Tick #${tickNumber}]: Role=${supervisoryRole.toUpperCase()} (Tier ${roleBoundaries.tier}).`,
    `Mandate: ${roleBoundaries.coreMandate}`,
    `Invariants: (1) Zero direct file edits; (2) Strict tier hierarchy; (3) 5-min schedule & dag:view; (4) Quantitative proof only.`,
    `Reflexive Check: Evaluate progress against role invariants, subordinate fulfillment, and behavioral drift before next action.`,
  ];
  const compactPrompt = compactLines.join(" ");

  return {
    id,
    role: supervisoryRole,
    tier: roleBoundaries.tier,
    tickNumber,
    timestamp,
    cadenceMs,
    elapsedMs,
    runId: options.runId ?? null,
    pulseId: options.pulseId ?? null,
    pillars,
    roleBoundaries,
    reflexiveAuditQuestions,
    formattedMarkdown,
    compactPrompt,
  };
}

export type ReflexiveCheckType = "role_invariants" | "subordinate_fulfillment" | "behavioral_drift";

export type DriftSeverity = "none" | "low" | "medium" | "high" | "critical";

export interface DriftFinding {
  readonly code: string;
  readonly type: ReflexiveCheckType;
  readonly severity: DriftSeverity;
  readonly title: string;
  readonly description: string;
  readonly recommendation: string;
  readonly evidence?: Readonly<Record<string, unknown>> | undefined;
}

export interface ActiveLeaseInfo {
  readonly taskId: string;
  readonly agentId: string;
  readonly writeScope?: readonly string[] | undefined;
  readonly expiresAt?: string | undefined;
  readonly heartbeatAgeMs?: number | undefined;
  readonly isStale?: boolean | undefined;
}

export interface SubordinateAgentInfo {
  readonly agentId: string;
  readonly role: string;
  readonly tier: number;
  readonly status: "active" | "idle" | "stale" | "completed" | "failed";
  readonly taskId?: string | undefined;
  readonly lastHeartbeatAgeMs?: number | undefined;
}

export interface ActionRecord {
  readonly action: string;
  readonly targetFile?: string | undefined;
  readonly spawnedRole?: string | undefined;
  readonly isMainThread?: boolean | undefined;
  readonly timestamp?: string | undefined;
}

export interface SubordinateHealthSummary {
  readonly totalSubordinates: number;
  readonly activeCount: number;
  readonly staleCount: number;
  readonly completedCount: number;
  readonly conflictingScopeCount: number;
  readonly healthy: boolean;
}

export interface ReflexiveAuditContext {
  readonly role: SupervisoryRole | string;
  readonly runId?: string | undefined;
  readonly phase?: string | undefined;
  readonly activeLeases?: readonly ActiveLeaseInfo[] | undefined;
  readonly subordinates?: readonly SubordinateAgentInfo[] | undefined;
  readonly recentActions?: readonly ActionRecord[] | undefined;
  readonly fileModificationsOnSupervisoryThread?: readonly string[] | undefined;
  readonly directExecutionAttempts?: readonly string[] | undefined;
  readonly crossTierSpawns?: readonly string[] | undefined;
  readonly validatorReviewsAcceptedWithoutProof?: number | undefined;
  readonly openFindingsCount?: number | undefined;
  readonly failedGatesCount?: number | undefined;
  readonly unprovenGatesCount?: number | undefined;
  readonly queueReadyCount?: number | undefined;
  readonly queueBlockedCount?: number | undefined;
  readonly isMainThreadExecution?: boolean | undefined;
  readonly attemptedPrematureCompletion?: boolean | undefined;
  readonly rawSourceFileReadsCount?: number | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface ReflexiveAuditEvaluation {
  readonly role: SupervisoryRole;
  readonly tier: number;
  readonly timestamp: string;
  readonly passed: boolean;
  readonly driftScore: number;
  readonly overallSeverity: DriftSeverity;
  readonly findings: readonly DriftFinding[];
  readonly invariantCompliance: Readonly<Record<string, boolean>>;
  readonly subordinateHealth: SubordinateHealthSummary;
  readonly recommendedActions: readonly string[];
  readonly groundingSummary: string;
  readonly markdownReport: string;
}

export interface ScopeOverlapConflict {
  readonly taskA: string;
  readonly taskB: string;
  readonly overlappingFiles: readonly string[];
}

function findOverlappingScopes(
  leases: readonly ActiveLeaseInfo[],
): readonly ScopeOverlapConflict[] {
  const conflicts: { taskA: string; taskB: string; overlappingFiles: string[] }[] = [];

  for (let i = 0; i < leases.length; i++) {
    for (let j = i + 1; j < leases.length; j++) {
      const leaseA = leases[i]!;
      const leaseB = leases[j]!;
      const scopeA = leaseA.writeScope ?? [];
      const scopeB = leaseB.writeScope ?? [];

      const overlaps = scopeA.filter((file) => scopeB.includes(file));
      if (overlaps.length > 0) {
        conflicts.push({
          taskA: leaseA.taskId,
          taskB: leaseB.taskId,
          overlappingFiles: overlaps,
        });
      }
    }
  }

  return conflicts;
}

const SEVERITY_WEIGHTS: Readonly<Record<DriftSeverity, number>> = {
  none: 0,
  low: 0.1,
  medium: 0.25,
  high: 0.5,
  critical: 1.0,
};

export function evaluateReflexiveSelfAudit(
  context: ReflexiveAuditContext,
): ReflexiveAuditEvaluation {
  const supervisoryRole = normalizeSupervisoryRole(context.role);
  if (!supervisoryRole) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `role '${context.role}' is not a valid supervisory role for reflexive self-audit evaluation`,
    );
  }

  const roleBoundaries = SUPERVISORY_ROLE_BOUNDARIES[supervisoryRole];
  const findings: DriftFinding[] = [];
  const recommendedActions: string[] = [];
  const invariantCompliance: Record<string, boolean> = {
    zero_file_mutation: true,
    strict_tier_hierarchy: true,
    delegated_execution_only: true,
    background_finalization_confinement: true,
    write_scope_isolation: true,
    quantitative_proof_enforcement: true,
    active_wave_progression: true,
    no_premature_completion: true,
  };

  const nowMs = parseNowMs(context.now);
  const timestamp = new Date(nowMs).toISOString();

  // 1. Role Invariants Evaluation
  // Invariant 1.1: Zero file mutations on supervisory thread
  const modifiedFiles = [
    ...(context.fileModificationsOnSupervisoryThread ?? []),
    ...(context.recentActions
      ?.filter(
        (a) => a.action === "edit_file" || a.action === "write_file" || a.action === "delete_file",
      )
      .map((a) => a.targetFile ?? "unknown_file") ?? []),
  ];

  if (modifiedFiles.length > 0) {
    invariantCompliance.zero_file_mutation = false;
    findings.push({
      code: "SUPERVISORY_FILE_MUTATION_VIOLATION",
      type: "role_invariants",
      severity: "critical",
      title: "Direct File Mutation on Supervisory Thread",
      description: `The ${supervisoryRole} supervisory thread attempted or executed direct modifications to ${modifiedFiles.length} file(s): ${modifiedFiles.slice(0, 3).join(", ")}${modifiedFiles.length > 3 ? "..." : ""}. Supervisory threads must maintain zero code mutation.`,
      recommendation:
        "Cease all direct file edits immediately. Delegate all file modifications and implementations to Tier 3 Implementers via host subagent dispatch.",
      evidence: { modifiedFiles },
    });
    recommendedActions.push(
      "Revert any direct file modifications made on the supervisory thread and dispatch a Tier 3 Implementer subagent.",
    );
  }

  // Invariant 1.2: Task Self-Implementation Attempts
  const directExecutionAttempts = [
    ...(context.directExecutionAttempts ?? []),
    ...(context.recentActions
      ?.filter(
        (a) =>
          a.action === "claim_task" || a.action === "implement_task" || a.action === "repair_task",
      )
      .map((a) => a.action) ?? []),
  ];

  if (directExecutionAttempts.length > 0) {
    invariantCompliance.delegated_execution_only = false;
    findings.push({
      code: "TASK_SELF_IMPLEMENTATION_VIOLATION",
      type: "role_invariants",
      severity: "critical",
      title: "Task Self-Implementation on Supervisory Role",
      description: `${supervisoryRole.toUpperCase()} attempted self-implementation actions: ${directExecutionAttempts.join(", ")}. Supervisory leads coordinate and supervise; they never claim or implement tasks directly.`,
      recommendation:
        "Release any self-claimed tasks and dispatch dedicated Tier 3 Implementers or Repairers.",
      evidence: { directExecutionAttempts },
    });
    recommendedActions.push(
      "Release self-claimed tasks with `task:release` and reassign to Tier 3 subagents.",
    );
  }

  // Invariant 1.3: Cross-Tier Hierarchy & Spawning
  const invalidSpawns = [
    ...(context.crossTierSpawns ?? []),
    ...(context.recentActions
      ?.filter((a) => {
        if (!a.spawnedRole) return false;
        return !roleBoundaries.permittedSpawns.includes(a.spawnedRole.toLowerCase());
      })
      .map((a) => a.spawnedRole!) ?? []),
  ];

  if (invalidSpawns.length > 0) {
    invariantCompliance.strict_tier_hierarchy = false;
    findings.push({
      code: "CROSS_TIER_SPAWNING_VIOLATION",
      type: "role_invariants",
      severity: "critical",
      title: "Cross-Tier Subagent Spawning Violation",
      description: `${supervisoryRole.toUpperCase()} (Tier ${roleBoundaries.tier}) attempted to spawn unauthorized role(s): ${invalidSpawns.join(", ")}. Permitted spawns are strictly limited to: [${roleBoundaries.permittedSpawns.join(", ")}].`,
      recommendation:
        "Adhere strictly to the 4-Tier spawning hierarchy. Tier 0 Mind spawns Tier 1 Orchestrator; Tier 1 Orchestrator spawns Tier 2 Coordinators; Tier 2 Coordinators spawn Tier 3 Workers.",
      evidence: { invalidSpawns, permittedSpawns: roleBoundaries.permittedSpawns },
    });
    recommendedActions.push(
      `Terminate unauthorized subagent dispatches and route spawning through proper tier hierarchy ([${roleBoundaries.permittedSpawns.join(", ")}]).`,
    );
  }

  // Invariant 1.4: Main-Thread Release Spillover
  if (context.isMainThreadExecution && context.role === "orchestrator") {
    const hasReleaseAction = context.recentActions?.some(
      (a) => a.action === "git_commit" || a.action === "git_push" || a.action === "sync_global",
    );
    if (hasReleaseAction) {
      invariantCompliance.background_finalization_confinement = false;
      findings.push({
        code: "MAIN_THREAD_RELEASE_SPILLOVER_VIOLATION",
        type: "role_invariants",
        severity: "high",
        title: "Main-Thread Release Spillover",
        description:
          "Release operations (git commit, git push, global sync) were executed on the main interactive thread rather than dedicated background worker threads.",
        recommendation:
          "Confine all final release packaging, git commits, and sync scripts to background execution threads.",
      });
      recommendedActions.push(
        "Execute final release commits and sync scripts strictly within background Orchestrator threads.",
      );
    }
  }

  // 2. Subordinate Fulfillment Evaluation
  const leases = context.activeLeases ?? [];
  const subordinates = context.subordinates ?? [];
  const scopeConflicts = findOverlappingScopes(leases);

  if (scopeConflicts.length > 0) {
    invariantCompliance.write_scope_isolation = false;
    findings.push({
      code: "SUBORDINATE_WRITE_SCOPE_CONFLICT",
      type: "subordinate_fulfillment",
      severity: "high",
      title: "Active Subordinate Write Scope Overlap",
      description: `Detected ${scopeConflicts.length} active write scope collision(s) among concurrently executing tasks: ${scopeConflicts.map((c) => `${c.taskA} vs ${c.taskB} on [${c.overlappingFiles.join(", ")}]`).join("; ")}.`,
      recommendation:
        "Enforce write scope exclusivity. Serialise tasks with overlapping write scopes into successive waves.",
      evidence: { scopeConflicts },
    });
    recommendedActions.push(
      "Re-partition wave dispatches so that tasks touching identical files execute in sequential DAG waves.",
    );
  }

  const staleLeases = leases.filter(
    (l) =>
      l.isStale ||
      (l.heartbeatAgeMs !== undefined && l.heartbeatAgeMs > DEFAULT_WATCHDOG_TIMEOUT_MS),
  );
  const staleSubordinates = subordinates.filter(
    (s) =>
      s.status === "stale" ||
      (s.lastHeartbeatAgeMs !== undefined && s.lastHeartbeatAgeMs > DEFAULT_WATCHDOG_TIMEOUT_MS),
  );

  const totalStaleCount = Math.max(staleLeases.length, staleSubordinates.length);
  if (totalStaleCount > 0) {
    findings.push({
      code: "STALE_SUBORDINATE_HEARTBEAT",
      type: "subordinate_fulfillment",
      severity: "medium",
      title: "Stale Subordinate Leases Detected",
      description: `Found ${totalStaleCount} subordinate agent(s) with stale heartbeats exceeding the timeout threshold (${DEFAULT_WATCHDOG_TIMEOUT_MS / 1000}s).`,
      recommendation:
        "Reclaim stale leases with `task:release` or `task:assign-repairer` to prevent pipeline stalls.",
      evidence: {
        staleLeaseTaskIds: staleLeases.map((l) => l.taskId),
        staleAgentIds: staleSubordinates.map((s) => s.agentId),
      },
    });
    recommendedActions.push(
      "Run `doctor` or `task:release` against stale subordinate leases and dispatch fresh replacement workers.",
    );
  }

  const unreviewedFindings = context.openFindingsCount ?? 0;
  if (unreviewedFindings > 5) {
    findings.push({
      code: "ACCUMULATED_UNREVIEWED_FINDINGS",
      type: "subordinate_fulfillment",
      severity: "medium",
      title: "High Unreviewed Findings Accumulation",
      description: `There are ${unreviewedFindings} open/unresolved findings accumulated across subordinate tasks without synthesis or remediation.`,
      recommendation:
        "Synthesize open findings into task repair assignments or incorporate them into next-round planning prompts.",
      evidence: { unreviewedFindings },
    });
    recommendedActions.push(
      "Triage open findings using `critic:remediate` or fold into next round's planning prompt.",
    );
  }

  const subordinateHealth: SubordinateHealthSummary = {
    totalSubordinates: Math.max(leases.length, subordinates.length),
    activeCount: Math.max(
      leases.filter((l) => !staleLeases.includes(l)).length,
      subordinates.filter((s) => s.status === "active").length,
    ),
    staleCount: totalStaleCount,
    completedCount: subordinates.filter((s) => s.status === "completed").length,
    conflictingScopeCount: scopeConflicts.length,
    healthy: totalStaleCount === 0 && scopeConflicts.length === 0,
  };

  // 3. Behavioral Drift Detection
  // Drift 3.1: Complacency / Rubber-Stamping Drift
  const acceptedWithoutProof = context.validatorReviewsAcceptedWithoutProof ?? 0;
  if (acceptedWithoutProof > 0) {
    invariantCompliance.quantitative_proof_enforcement = false;
    findings.push({
      code: "COMPLACENCY_RUBBER_STAMPING_DRIFT",
      type: "behavioral_drift",
      severity: "high",
      title: "Complacent Validator Sign-Off Without Proof",
      description: `Accepted ${acceptedWithoutProof} validator pass(es) that lacked quantitative proof metrics (DOM bounds, APCA contrast, screenshot bytes > 1024B) or gate evidence.`,
      recommendation:
        "Apply coordinator scepticism. Issue `coordinator:pushback` on passes that do not provide rigorous quantitative proof.",
      evidence: { acceptedWithoutProof },
    });
    recommendedActions.push(
      "Execute `coordinator:pushback` on unverified validator claims and require quantitative screenshot/DOM evidence.",
    );
  }

  // Drift 3.2: Idling / Stalling Drift
  const readyCount = context.queueReadyCount ?? 0;
  const activeSubordinatesCount = subordinateHealth.activeCount;
  if (readyCount > 0 && activeSubordinatesCount === 0 && (context.queueBlockedCount ?? 0) === 0) {
    invariantCompliance.active_wave_progression = false;
    findings.push({
      code: "IDLING_STALLING_DRIFT",
      type: "behavioral_drift",
      severity: "medium",
      title: "Execution Idling with Ready Tasks in Queue",
      description: `Execution queue has ${readyCount} ready task(s) available, but 0 active subordinate workers are currently dispatched. Concurrency headroom is underutilized.`,
      recommendation:
        "Dispatch ready tasks immediately using `queue:wave` up to available concurrency slots (P = W / S).",
      evidence: { readyCount, activeSubordinatesCount },
    });
    recommendedActions.push("Dispatch ready tasks in parallel wave lanes using `queue:wave`.");
  }

  // Drift 3.3: Premature Completion Attempt
  if (context.attemptedPrematureCompletion) {
    const hasBlockers =
      subordinateHealth.activeCount > 0 ||
      (context.openFindingsCount ?? 0) > 0 ||
      (context.failedGatesCount ?? 0) > 0 ||
      (context.unprovenGatesCount ?? 0) > 0;

    if (hasBlockers) {
      invariantCompliance.no_premature_completion = false;
      findings.push({
        code: "PREMATURE_COMPLETION_DRIFT",
        type: "behavioral_drift",
        severity: "critical",
        title: "Premature Run Completion Attempt",
        description:
          "Attempted run completion while active subordinate leases, unresolved findings, unproven gates, or failed gates remain active.",
        recommendation:
          "Never declare completion until all wave gates pass, all leases are closed, and completeness critic approves with zero open findings.",
        evidence: {
          activeLeases: subordinateHealth.activeCount,
          openFindings: context.openFindingsCount,
          failedGates: context.failedGatesCount,
        },
      });
      recommendedActions.push(
        "Resolve all open findings and verify all gate proofs before calling `run:complete`.",
      );
    }
  }

  // Drift 3.4: Context Bloat Drift (reading raw source dumps)
  const rawReads = context.rawSourceFileReadsCount ?? 0;
  if (rawReads > 10) {
    findings.push({
      code: "CONTEXT_BLOAT_DRIFT",
      type: "behavioral_drift",
      severity: "low",
      title: "Context Bloat via Excessive Raw Source Reads",
      description: `Detected ${rawReads} raw file reads instead of utilizing high-leverage structured CLI verbs with JSON output.`,
      recommendation:
        "Leverage structured CLI commands (`run:status`, `dag:view`, `queue:list`) rather than dumping full source files into context.",
      evidence: { rawReads },
    });
    recommendedActions.push(
      "Use targeted CLI commands with `--format json` or bounded line limits to conserve context tokens.",
    );
  }

  // Calculate Drift Score & Overall Severity
  let rawScore = 0;
  for (const f of findings) {
    rawScore += SEVERITY_WEIGHTS[f.severity];
  }
  const driftScore = Math.min(1.0, Math.round(rawScore * 100) / 100);

  let overallSeverity: DriftSeverity = "none";
  if (findings.some((f) => f.severity === "critical")) {
    overallSeverity = "critical";
  } else if (findings.some((f) => f.severity === "high")) {
    overallSeverity = "high";
  } else if (findings.some((f) => f.severity === "medium")) {
    overallSeverity = "medium";
  } else if (findings.some((f) => f.severity === "low")) {
    overallSeverity = "low";
  }

  const passed = overallSeverity === "none" || (overallSeverity === "low" && driftScore < 0.2);

  // Summary and Markdown Report Generation
  const statusEmoji = passed
    ? "🟢 PASS"
    : overallSeverity === "critical"
      ? "🔴 CRITICAL DRIFT"
      : "🟡 WARNING";
  const groundingSummary = passed
    ? `Supervisory persona for ${supervisoryRole.toUpperCase()} is fully grounded and compliant with 0 critical drift findings.`
    : `Supervisory persona for ${supervisoryRole.toUpperCase()} exhibits ${overallSeverity.toUpperCase()} behavioral drift (drift score: ${driftScore}). ${findings.length} finding(s) detected.`;

  const reportLines: string[] = [];
  reportLines.push(
    `### 🛡️ Supervisory Reflexive Self-Audit Report: \`${supervisoryRole.toUpperCase()}\``,
  );
  reportLines.push(
    `- **Status**: ${statusEmoji} (Drift Score: \`${driftScore.toFixed(2)}\` / 1.00)`,
  );
  reportLines.push(`- **Tier**: Tier ${roleBoundaries.tier} (${roleBoundaries.tierName})`);
  reportLines.push(`- **Timestamp**: \`${timestamp}\``);
  reportLines.push(
    `- **Subordinate Health**: ${subordinateHealth.healthy ? "Healthy" : "Attention Required"} (${subordinateHealth.activeCount} active, ${subordinateHealth.staleCount} stale, ${subordinateHealth.conflictingScopeCount} conflicting)`,
  );
  reportLines.push("");

  reportLines.push("#### 📋 Invariant Compliance Matrix");
  for (const [invKey, isCompliant] of Object.entries(invariantCompliance)) {
    reportLines.push(
      `- ${isCompliant ? "✅" : "❌"} \`${invKey}\`: ${isCompliant ? "COMPLIANT" : "VIOLATION"}`,
    );
  }
  reportLines.push("");

  if (findings.length > 0) {
    reportLines.push("#### ⚠️ Reflexive Drift & Boundary Findings");
    for (const f of findings) {
      reportLines.push(`##### [${f.severity.toUpperCase()}] ${f.title} (\`${f.code}\`)`);
      reportLines.push(`- **Type**: \`${f.type}\``);
      reportLines.push(`- **Description**: ${f.description}`);
      reportLines.push(`- **Remediation**: ${f.recommendation}`);
      reportLines.push("");
    }
  }

  if (recommendedActions.length > 0) {
    reportLines.push("#### ⚡ Recommended Grounding Actions");
    for (let i = 0; i < recommendedActions.length; i++) {
      reportLines.push(`${i + 1}. ${recommendedActions[i]}`);
    }
    reportLines.push("");
  }

  const markdownReport = reportLines.join("\n").trim();

  return {
    role: supervisoryRole,
    tier: roleBoundaries.tier,
    timestamp,
    passed,
    driftScore,
    overallSeverity,
    findings,
    invariantCompliance,
    subordinateHealth,
    recommendedActions,
    groundingSummary,
    markdownReport,
  };
}

export interface WatchdogAuditPromptOptions {
  readonly tickNumber?: number | undefined;
  readonly runId?: string | undefined;
  readonly activeTaskCount?: number | undefined;
  readonly now?: string | number | Date | undefined;
}

export function buildWatchdogAuditPrompt(
  role: SupervisoryRole | string,
  options?: WatchdogAuditPromptOptions,
): string {
  const supervisoryRole = normalizeSupervisoryRole(role);
  if (!supervisoryRole) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `role '${role}' is not a supervisory role (mind, orchestrator, coordinator)`,
    );
  }

  const grounding = generateWatchdogPersonaGrounding({
    role: supervisoryRole,
    tickNumber: options?.tickNumber,
    runId: options?.runId,
    now: options?.now,
  });

  return grounding.formattedMarkdown;
}

export function formatReflexiveAuditEvaluation(evaluation: ReflexiveAuditEvaluation): string {
  return evaluation.markdownReport;
}

export function createWatchdogTickReminder(
  role: SupervisoryRole | string,
  tickNumber: number,
  context?: ReflexiveAuditContext,
): string {
  const supervisoryRole = normalizeSupervisoryRole(role);
  if (!supervisoryRole) {
    throw new HarnessError("INVALID_ARGUMENT", `role '${role}' is not a supervisory role`);
  }

  const grounding = generateWatchdogPersonaGrounding({
    role: supervisoryRole,
    tickNumber,
    now: context?.now,
    runId: context?.runId,
  });

  const fallbackContext: ReflexiveAuditContext = {
    role: supervisoryRole,
  };
  const evaluation = evaluateReflexiveSelfAudit(context ?? fallbackContext);

  const lines: string[] = [];
  lines.push(grounding.formattedMarkdown);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(evaluation.markdownReport);

  return lines.join("\n");
}

import { clearManifestCache } from "./manifest-parser.ts";

/**
 * Invalidates persona verification caches cleanly when session roles transition.
 */
export function invalidatePersonaVerificationCaches(): void {
  clearManifestCache();
}
