import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { findRepoRoot } from "../../../core/index.ts";
import { loadRun } from "../../../engine/store/index.ts";
import {
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  SCALABILITY_THRESHOLD_PERCENT,
  type SerializedDebateMemory,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../mind/auditing/socratic/index.ts";
import {
  type LineageValidationResult,
  type SupersessionIndexState,
  type SupersessionNode,
  SupersessionIndex,
} from "../../../mind/memory/index.ts";
import {
  type SuspendedAnimationSnapshot,
  readSnapshotFromDisk,
  resolveSuspendedStatePath,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
} from "../../../mind/lifecycle/index.ts";
import {
  type ExecutiveDashboardState,
  resolveDashboardPaths,
} from "../../../mind/reporting/index.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding, DoctorSeverity } from "../index.ts";
import {
  MIND_CHARTER_INVARIANTS,
  DEFAULT_MAX_DASHBOARD_STALENESS_MS,
  type MindCharterInvariant,
  type AntiStagnationDoctorOptions,
  type InvariantAuditResult,
  type AntiStagnationAuditReport,
} from "./types.ts";
import {
  normalizeRole,
  isSupervisorRole,
  buildFinding,
  resolveAgentRoleMap,
  inferAgentRole,
  type InvariantContext,
  CODE_EDIT_TOOLS,
  TEST_RUNNER_KEYWORDS,
} from "./helpers.ts";

export function auditLiveExecutiveDashboard(ctx: InvariantContext): InvariantAuditResult[] {
  let dashboard: ExecutiveDashboardState | null = null;
  let dashboardPath: string | undefined;

  if (ctx.repoRoot) {
    const paths = resolveDashboardPaths(ctx.repoRoot);
    if (existsSync(paths.jsonPath)) {
      try {
        dashboard = JSON.parse(readFileSync(paths.jsonPath, "utf-8")) as ExecutiveDashboardState;
        dashboardPath = paths.jsonPath;
      } catch {}
    }
  }

  if (!dashboard && ctx.state?.dashboard) {
    dashboard = ctx.state.dashboard as ExecutiveDashboardState;
  }

  const isMindActive = Boolean(ctx.state?.mind) || Boolean(ctx.state?.pulse);

  if (isMindActive && !dashboard) {
    return [
      {
        invariant: "LIVE_EXECUTIVE_DASHBOARD",
        compliant: false,
        severity: "ERROR",
        message:
          "Live Executive Dashboard violation: Mandatory executive dashboard (.olt/executive-dashboard.md & .olt/dashboard.json) is missing in active Mind capsule.",
        details: { repoRoot: ctx.repoRoot },
      },
    ];
  }

  if (dashboard) {
    // Check mandatory sections
    const hasSec1 = Boolean(dashboard.trajectory);
    const hasSec2 = Boolean(dashboard.portfolio);
    const hasSec3 = Boolean(dashboard.pareto);
    const hasSec4 = Boolean(dashboard.productCraft);
    const hasSec5 = Boolean(dashboard.roadmap);

    if (!hasSec1 || !hasSec2 || !hasSec3 || !hasSec4 || !hasSec5) {
      return [
        {
          invariant: "LIVE_EXECUTIVE_DASHBOARD",
          compliant: false,
          severity: "ERROR",
          message:
            "Live Executive Dashboard violation: One or more of the 5 mandatory dashboard sections are missing.",
          details: { hasSec1, hasSec2, hasSec3, hasSec4, hasSec5 },
        },
      ];
    }

    // Check freshness
    const updatedTimeStr = dashboard.trajectory?.lastUpdated ?? dashboard.generatedAt;
    const updatedMs = Date.parse(updatedTimeStr);
    if (!Number.isNaN(updatedMs)) {
      const latencyMs = Math.max(0, ctx.nowMs - updatedMs);
      if (latencyMs > ctx.maxDashboardStalenessMs && isMindActive) {
        return [
          {
            invariant: "LIVE_EXECUTIVE_DASHBOARD",
            compliant: false,
            severity: "WARN",
            message: `Live Executive Dashboard notice: Dashboard state is stale (${(latencyMs / 1000).toFixed(0)}s old > ${(ctx.maxDashboardStalenessMs / 1000).toFixed(0)}s threshold). Auto-synchronization recommended.`,
            details: {
              latencyMs,
              maxStalenessMs: ctx.maxDashboardStalenessMs,
              lastUpdated: updatedTimeStr,
              dashboardPath,
            },
          },
        ];
      }
    }
  }

  return [
    {
      invariant: "LIVE_EXECUTIVE_DASHBOARD",
      compliant: true,
      severity: "INFO",
      message: "Live Executive Dashboard invariant satisfied: dashboard synchronized and fresh.",
    },
  ];
}

/**
 * 15. MANDATORY_3_ROUND_SOCRATIC_LADDERING
 */
export function auditMandatory3RoundSocraticLaddering(
  ctx: InvariantContext,
): InvariantAuditResult[] {
  let memory: HistoricalDebateMemory | null = null;

  if (ctx.socraticMemory instanceof HistoricalDebateMemory) {
    memory = ctx.socraticMemory;
  } else if (ctx.socraticMemory && typeof ctx.socraticMemory === "object") {
    try {
      memory = HistoricalDebateMemory.deserialize(JSON.stringify(ctx.socraticMemory));
    } catch {}
  } else if (ctx.state?.socratic_memory) {
    try {
      memory = HistoricalDebateMemory.deserialize(JSON.stringify(ctx.state.socratic_memory));
    } catch {}
  }

  const socraticState = ctx.state?.socratic as Record<string, unknown> | undefined;
  if (socraticState && socraticState.consensusReached === true) {
    const history = Array.isArray(socraticState.history)
      ? (socraticState.history as Array<Record<string, unknown>>)
      : [];
    const levelsTraversed = new Set(history.map((h) => h.level));

    const traversedL1 = levelsTraversed.has("L1_TRADE_OFF_VERIFICATION");
    const traversedL2 = levelsTraversed.has("L2_SECOND_ORDER_IMPLICATIONS");
    const traversedL3 = levelsTraversed.has("L3_EMERGENT_PARADIGMS");

    if (history.length > 0 && (!traversedL1 || !traversedL2 || !traversedL3)) {
      return [
        {
          invariant: "MANDATORY_3_ROUND_SOCRATIC_LADDERING",
          compliant: false,
          severity: "ERROR",
          message:
            "Mandatory 3-Round Socratic Laddering violation: Consensus recorded without traversing all 3 mandatory dialectical rounds (L1: Trade-off, L2: Second-Order, L3: Emergent Paradigms).",
          details: { traversedL1, traversedL2, traversedL3, roundsCount: history.length },
        },
      ];
    }
  }

  return [
    {
      invariant: "MANDATORY_3_ROUND_SOCRATIC_LADDERING",
      compliant: true,
      severity: "INFO",
      message:
        "Mandatory 3-Round Socratic Laddering invariant satisfied: dialectical laddering integrity verified.",
    },
  ];
}

/**
 * 16. DIRECT_1_ON_1_CONVERSATIONAL_AUDITS
 */
export function auditDirect1on1ConversationalAudits(
  ctx: InvariantContext,
  roleMap: Map<string, string>,
): InvariantAuditResult[] {
  const violations: Array<{ source: string; target: string; issue: string }> = [];

  // Check grants hierarchy
  const rawGrants = ctx.grants ?? (ctx.state?.grants as readonly unknown[] | undefined);
  if (Array.isArray(rawGrants)) {
    for (const grant of rawGrants) {
      if (grant && typeof grant === "object") {
        const g = grant as Record<string, unknown>;
        const id = typeof g.id === "string" ? g.id : "unknown";
        const role = inferAgentRole(id, typeof g.role === "string" ? g.role : undefined, roleMap);
        const parentId = typeof g.parent_agent_id === "string" ? g.parent_agent_id : undefined;
        const parentRole = inferAgentRole(parentId, undefined, roleMap);

        // Tier 3 implementers/validators must be spawned by Coordinator, not directly by Tier 0 Mind
        if ((role === "implementer" || role === "validator") && parentRole === "mind") {
          violations.push({
            source: parentId ?? "mind",
            target: id,
            issue: `Cross-tier bypass: Tier 0 Mind directly granted Tier 3 '${role}' without Coordinator mediation.`,
          });
        }
      }
    }
  }

  if (violations.length > 0) {
    const summary = violations.map((v) => v.issue).join("; ");
    return [
      {
        invariant: "DIRECT_1_ON_1_CONVERSATIONAL_AUDITS",
        compliant: false,
        severity: "ERROR",
        message: `Direct 1-on-1 Conversational Audits violation: ${summary}`,
        details: { violationsCount: violations.length, violations },
      },
    ];
  }

  return [
    {
      invariant: "DIRECT_1_ON_1_CONVERSATIONAL_AUDITS",
      compliant: true,
      severity: "INFO",
      message:
        "Direct 1-on-1 Conversational Audits invariant satisfied: strict parent-child hierarchical delegation intact.",
    },
  ];
}

// ============================================================================
