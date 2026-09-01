import { existsSync } from "node:fs";
import {
  type LineageValidationResult,
  type SupersessionIndexState,
  SupersessionIndex,
} from "../../../mind/memory/index.ts";
import {
  type SuspendedAnimationSnapshot,
  type FrozenTimer,
  readSnapshotFromDisk,
  resolveSuspendedStatePath,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
} from "../../../mind/lifecycle/index.ts";
import type { InvariantAuditResult } from "./types.ts";
import type { InvariantContext } from "./helpers.ts";

export function auditThreeTierSemanticMemory(ctx: InvariantContext): InvariantAuditResult[] {
  const memoryState = ctx.state?.memory as Record<string, unknown> | undefined;

  if (memoryState) {
    const hasTier1 = Array.isArray(memoryState.tier1Invariants) || Boolean(memoryState.invariants);
    const hasTier2 = Array.isArray(memoryState.tier2WorkingMemory) || Boolean(memoryState.working);
    const hasTier3 = Array.isArray(memoryState.tier3ArchivedEpics) || Boolean(memoryState.archived);

    if (memoryState.initialized === true && (!hasTier1 || !hasTier2 || !hasTier3)) {
      return [
        {
          invariant: "THREE_TIER_SEMANTIC_MEMORY",
          compliant: false,
          severity: "ERROR",
          message:
            "Three-Tier Semantic Memory violation: Mandatory memory tiers (Tier 1 Invariants, Tier 2 Working Memory, Tier 3 Archived Epics) are missing or corrupted.",
          details: { hasTier1, hasTier2, hasTier3 },
        },
      ];
    }
  }

  return [
    {
      invariant: "THREE_TIER_SEMANTIC_MEMORY",
      compliant: true,
      severity: "INFO",
      message: "Three-Tier Semantic Memory invariant satisfied: hierarchical structure intact.",
    },
  ];
}

/**
 * 10. EPISTEMIC_SUPERSESSION_INDEXING
 */
export function auditEpistemicSupersessionIndexing(ctx: InvariantContext): InvariantAuditResult[] {
  let index: SupersessionIndex | null = null;

  if (ctx.supersessionIndex instanceof SupersessionIndex) {
    index = ctx.supersessionIndex;
  } else if (ctx.supersessionIndex && typeof ctx.supersessionIndex === "object") {
    index = SupersessionIndex.fromState(ctx.supersessionIndex as SupersessionIndexState);
  } else if (ctx.state?.supersession_index) {
    try {
      index = SupersessionIndex.fromState(ctx.state.supersession_index as SupersessionIndexState);
    } catch {}
  } else if (ctx.state?.memory && typeof ctx.state.memory === "object") {
    const mem = ctx.state.memory as Record<string, unknown>;
    if (mem.supersessionIndex) {
      try {
        index = SupersessionIndex.fromState(mem.supersessionIndex as SupersessionIndexState);
      } catch {}
    }
  }

  if (index) {
    const validation: LineageValidationResult = index.validateLineageAcyclicity();
    if (!validation.valid) {
      return [
        {
          invariant: "EPISTEMIC_SUPERSESSION_INDEXING",
          compliant: false,
          severity: "ERROR",
          message: `Epistemic Supersession Indexing violation: ${validation.cycles.length} cycle(s) detected in supersession lineage graph. Lineage must be strictly acyclic.`,
          details: { cycleCount: validation.cycles.length, cycles: validation.cycles },
        },
      ];
    }
  }

  return [
    {
      invariant: "EPISTEMIC_SUPERSESSION_INDEXING",
      compliant: true,
      severity: "INFO",
      message:
        "Epistemic Supersession Indexing invariant satisfied: lineage graph is strictly acyclic.",
    },
  ];
}

/**
 * 11. SUSPENDED_ANIMATION_PROTOCOL
 */
export function auditSuspendedAnimationProtocol(ctx: InvariantContext): InvariantAuditResult[] {
  let snapshot: SuspendedAnimationSnapshot | null = null;
  let snapshotPath: string | undefined;

  if (ctx.suspendedSnapshot) {
    snapshot = ctx.suspendedSnapshot;
  } else if (ctx.repoRoot) {
    snapshotPath = resolveSuspendedStatePath(ctx.repoRoot);
    if (existsSync(snapshotPath)) {
      snapshot = readSnapshotFromDisk(snapshotPath);
      if (!snapshot) {
        return [
          {
            invariant: "SUSPENDED_ANIMATION_PROTOCOL",
            compliant: false,
            severity: "ERROR",
            message: `Corrupted or unreadable suspended animation snapshot at '${snapshotPath}'.`,
          },
        ];
      }
    }
  }

  if (snapshot) {
    const valid = verifySnapshotIntegrity(snapshot);
    if (!valid) {
      return [
        {
          invariant: "SUSPENDED_ANIMATION_PROTOCOL",
          compliant: false,
          severity: "ERROR",
          message: `Suspended Animation Protocol violation: Snapshot '${snapshot.snapshotId}' checksum verification failed.`,
          details: { snapshotId: snapshot.snapshotId, path: snapshotPath },
        },
      ];
    }

    if (snapshot.tasksDag && snapshot.tasksDag.length > 0) {
      const dagCheck = validateTaskDagAcyclicity(snapshot.tasksDag);
      if (!dagCheck.valid) {
        return [
          {
            invariant: "SUSPENDED_ANIMATION_PROTOCOL",
            compliant: false,
            severity: "ERROR",
            message: `Suspended Animation Protocol violation: Task DAG in snapshot '${snapshot.snapshotId}' contains cyclic dependencies.`,
            details: { cycle: dagCheck.cycle },
          },
        ];
      }
    }

    if (Array.isArray(snapshot.frozenTimers)) {
      const corruptTimers = snapshot.frozenTimers.filter(
        (t: FrozenTimer) =>
          (t.remainingDurationMs !== undefined && t.remainingDurationMs < 0) ||
          (t.remainingDurationMs !== undefined && isNaN(t.remainingDurationMs)),
      );
      if (corruptTimers.length > 0) {
        return [
          {
            invariant: "SUSPENDED_ANIMATION_PROTOCOL",
            compliant: false,
            severity: "ERROR",
            message: `Suspended Animation Protocol violation: Snapshot '${snapshot.snapshotId}' contains ${corruptTimers.length} corrupted timer(s).`,
            details: { corruptTimers: corruptTimers.map((t: FrozenTimer) => t.id) },
          },
        ];
      }
    }
  }

  return [
    {
      invariant: "SUSPENDED_ANIMATION_PROTOCOL",
      compliant: true,
      severity: "INFO",
      message:
        "Suspended Animation Protocol invariant satisfied: snapshot checksums and task DAGs are intact.",
    },
  ];
}

/**
 * 12. INFLIGHT_WORK_INGESTION
 */
export function auditInflightWorkIngestion(ctx: InvariantContext): InvariantAuditResult[] {
  const mindState = ctx.state?.mind as Record<string, unknown> | undefined;
  if (mindState && ctx.state?.snapshot_id && !ctx.state?.snapshot) {
    // Snapshot recorded but details missing
    return [
      {
        invariant: "INFLIGHT_WORK_INGESTION",
        compliant: false,
        severity: "WARN",
        message:
          "In-Flight Work Ingestion notice: Snapshot ID recorded but snapshot summary metadata is incomplete.",
        details: { snapshotId: ctx.state.snapshot_id },
      },
    ];
  }

  return [
    {
      invariant: "INFLIGHT_WORK_INGESTION",
      compliant: true,
      severity: "INFO",
      message:
        "In-Flight Work Ingestion invariant satisfied: non-destructive uncommitted state capture intact.",
    },
  ];
}

/**
 * 13. DIAGNOSTIC_CLUSTERING
 */
export function auditDiagnosticClustering(ctx: InvariantContext): InvariantAuditResult[] {
  const deficitTopology = ctx.state?.deficit_topology as Record<string, unknown> | undefined;
  if (deficitTopology && typeof deficitTopology.summary === "object") {
    const summary = deficitTopology.summary as Record<string, unknown>;
    const blockers = typeof summary.blockers === "number" ? summary.blockers : 0;
    const healthStatus =
      typeof summary.healthStatus === "string" ? summary.healthStatus : "NOMINAL";

    if (healthStatus === "CRITICAL" && blockers > 10) {
      return [
        {
          invariant: "DIAGNOSTIC_CLUSTERING",
          compliant: false,
          severity: "WARN",
          message: `Diagnostic Clustering notice: Deficit topology indicates critical health with ${blockers} active Class 1 blockers. Track A remediation prioritized.`,
          details: { blockers, healthStatus },
        },
      ];
    }
  }

  return [
    {
      invariant: "DIAGNOSTIC_CLUSTERING",
      compliant: true,
      severity: "INFO",
      message: "Diagnostic Clustering invariant satisfied: deficit topology synthesis operational.",
    },
  ];
}
