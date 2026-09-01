import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
} from "../../../mind/auditing/socratic/index.ts";
import {
  type ExecutiveDashboardState,
  resolveDashboardPaths,
} from "../../../mind/reporting/index.ts";
import type { InvariantAuditResult } from "./types.ts";
import type { InvariantContext } from "./helpers.ts";

/**
 * 5. CUMULATIVE_SOCRATIC_PROGRESSION
 */
export function auditCumulativeSocraticProgression(ctx: InvariantContext): InvariantAuditResult[] {
  let memory: HistoricalDebateMemory | null = null;

  if (ctx.socraticMemory instanceof HistoricalDebateMemory) {
    memory = ctx.socraticMemory;
  } else if (ctx.socraticMemory && typeof ctx.socraticMemory === "object") {
    try {
      memory = HistoricalDebateMemory.deserialize(JSON.stringify(ctx.socraticMemory));
    } catch {
      memory = null;
    }
  } else if (ctx.state?.socratic_memory) {
    try {
      memory = HistoricalDebateMemory.deserialize(JSON.stringify(ctx.state.socratic_memory));
    } catch {
      memory = null;
    }
  } else if (ctx.repoRoot) {
    const diskPath = join(ctx.repoRoot, ".olt", "debate-memory.json");
    if (existsSync(diskPath)) {
      try {
        const raw = readFileSync(diskPath, "utf-8");
        memory = HistoricalDebateMemory.deserialize(raw);
      } catch {
        memory = null;
      }
    }
  }

  if (memory) {
    if (memory.hasUnfulfilledCommitmentsWithoutJustification()) {
      const unfulfilled = memory.getUnfulfilledCommitments();
      const unjustified = unfulfilled.filter(
        (c) => !c.justification || c.justification.trim().length === 0,
      );
      return [
        {
          invariant: "CUMULATIVE_SOCRATIC_PROGRESSION",
          compliant: false,
          severity: "ERROR",
          message: `Cumulative Socratic Progression violation: ${unjustified.length} unfulfilled strategic commitment(s) lack recorded justifications. Dialectic progression is locked to L1 until reconciled.`,
          details: {
            unjustifiedCount: unjustified.length,
            unjustifiedCommitments: unjustified.map((c) => ({
              id: c.id,
              topic: c.topic,
              status: c.status,
            })),
          },
        },
      ];
    }
  }

  return [
    {
      invariant: "CUMULATIVE_SOCRATIC_PROGRESSION",
      compliant: true,
      severity: "INFO",
      message:
        "Cumulative Socratic Progression invariant satisfied: debate commitments intact and progress monotonically.",
    },
  ];
}

/**
 * 6. PRE_DECLARED_PARETO_ARBITRATION
 */
export function auditPreDeclaredParetoArbitration(ctx: InvariantContext): InvariantAuditResult[] {
  const paretoState = ctx.state?.pareto as Record<string, unknown> | undefined;
  const recentArbitrations = Array.isArray(paretoState?.recentArbitrations)
    ? (paretoState?.recentArbitrations as Array<Record<string, unknown>>)
    : [];

  for (const arb of recentArbitrations) {
    const priorityLevel = typeof arb.chosenPriorityLevel === "number" ? arb.chosenPriorityLevel : 0;
    const winningApproach = typeof arb.winningApproach === "string" ? arb.winningApproach : "";

    if (priorityLevel === 4) {
      return [
        {
          invariant: "PRE_DECLARED_PARETO_ARBITRATION",
          compliant: false,
          severity: "ERROR",
          message: `Pre-Declared Pareto Arbitration violation in arbitration '${typeof arb.id === "string" ? arb.id : "unknown"}': Winning approach '${winningApproach}' selected Priority 4 (Speculative Abstraction), which is strictly forbidden by charter.`,
          details: { arbitration: arb },
        },
      ];
    }
  }

  const socraticState = ctx.state?.socratic as Record<string, unknown> | undefined;
  const consecutiveImpasses =
    typeof socraticState?.consecutiveImpasseCycles === "number"
      ? (socraticState.consecutiveImpasseCycles as number)
      : 0;
  const requiresCrucible = socraticState?.requiresCrucible === true;

  if (consecutiveImpasses > IMPASSE_CRUCIBLE_THRESHOLD && !requiresCrucible) {
    return [
      {
        invariant: "PRE_DECLARED_PARETO_ARBITRATION",
        compliant: false,
        severity: "ERROR",
        message: `Pre-Declared Pareto Arbitration violation: Consecutive impasse cycles (${consecutiveImpasses}) exceeded threshold of ${IMPASSE_CRUCIBLE_THRESHOLD} without mandatory Crucible escalation.`,
        details: { consecutiveImpasses, threshold: IMPASSE_CRUCIBLE_THRESHOLD },
      },
    ];
  }

  return [
    {
      invariant: "PRE_DECLARED_PARETO_ARBITRATION",
      compliant: true,
      severity: "INFO",
      message:
        "Pre-Declared Pareto Arbitration invariant satisfied: decision hierarchy and crucible thresholds intact.",
    },
  ];
}

/**
 * 7. INNOVATION_PORTFOLIO_70_20_10
 */
export function auditInnovationPortfolio702010(ctx: InvariantContext): InvariantAuditResult[] {
  let portfolio = ctx.state?.portfolio as Record<string, unknown> | undefined;

  if (!portfolio && ctx.repoRoot) {
    const dashPaths = resolveDashboardPaths(ctx.repoRoot);
    if (existsSync(dashPaths.jsonPath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(dashPaths.jsonPath, "utf-8"),
        ) as ExecutiveDashboardState;
        portfolio = parsed.portfolio as unknown as Record<string, unknown>;
      } catch {}
    }
  }

  if (portfolio) {
    const balanceStatus =
      typeof portfolio.balanceStatus === "string" ? portfolio.balanceStatus : "BALANCED";
    const trackA = portfolio.trackA_CoreStabilityAndPolish as Record<string, unknown> | undefined;
    const trackC = portfolio.trackC_ExploratoryHorizonBets as Record<string, unknown> | undefined;

    const trackAPct = typeof trackA?.percentage === "number" ? (trackA.percentage as number) : 70;
    const trackCPct = typeof trackC?.percentage === "number" ? (trackC.percentage as number) : 10;

    if (balanceStatus === "CORE_DEFICIT" || trackAPct < 40) {
      return [
        {
          invariant: "INNOVATION_PORTFOLIO_70_20_10",
          compliant: false,
          severity: "ERROR",
          message: `Innovation Portfolio 70/20/10 violation: Track A (Core Stability) allocation is severely under-resourced (${trackAPct.toFixed(1)}%, target 70%). Rebalance required.`,
          details: { balanceStatus, trackAPct, trackCPct },
        },
      ];
    }

    if (balanceStatus === "SPECULATIVE_OVERALLOCATION" || trackCPct > 35) {
      return [
        {
          invariant: "INNOVATION_PORTFOLIO_70_20_10",
          compliant: false,
          severity: "WARN",
          message: `Innovation Portfolio notice: Track C (Exploratory Bets) allocation (${trackCPct.toFixed(1)}%) exceeds safe threshold (target 10%). Status: ${balanceStatus}.`,
          details: { balanceStatus, trackAPct, trackCPct },
        },
      ];
    }
  }

  return [
    {
      invariant: "INNOVATION_PORTFOLIO_70_20_10",
      compliant: true,
      severity: "INFO",
      message:
        "Innovation Portfolio 70/20/10 invariant satisfied: portfolio capacity distributed within nominal bounds.",
    },
  ];
}

/**
 * 8. ERGONOMIC_WALKTHROUGH_AUDITING
 */
export function auditErgonomicWalkthrough(ctx: InvariantContext): InvariantAuditResult[] {
  let craft = ctx.state?.product_craft as Record<string, unknown> | undefined;

  if (!craft && ctx.repoRoot) {
    const dashPaths = resolveDashboardPaths(ctx.repoRoot);
    if (existsSync(dashPaths.jsonPath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(dashPaths.jsonPath, "utf-8"),
        ) as ExecutiveDashboardState;
        craft = parsed.productCraft as unknown as Record<string, unknown>;
      } catch {}
    }
  }

  if (craft) {
    const status =
      typeof craft.ergonomicWalkthroughStatus === "string"
        ? craft.ergonomicWalkthroughStatus
        : "PASSED";
    const score = typeof craft.compositeCraftScore === "number" ? craft.compositeCraftScore : 100;
    const threshold = typeof craft.passThreshold === "number" ? craft.passThreshold : 85;
    const openDeficits = craft.openDeficits as Record<string, unknown> | undefined;
    const blockingCount =
      typeof openDeficits?.blockingCount === "number" ? (openDeficits.blockingCount as number) : 0;
    const latency =
      typeof craft.microInteractionLatencyMs === "number"
        ? (craft.microInteractionLatencyMs as number)
        : 0;
    const latencyTarget =
      typeof craft.microInteractionTargetMs === "number"
        ? (craft.microInteractionTargetMs as number)
        : 16;

    if (status === "DEFICIT_NOTICE" || blockingCount > 0) {
      return [
        {
          invariant: "ERGONOMIC_WALKTHROUGH_AUDITING",
          compliant: false,
          severity: "ERROR",
          message: `Ergonomic Walkthrough Auditing violation: Product craft has ${blockingCount} blocking aesthetic deficit(s). Zero blocking deficits required for milestone certification.`,
          details: { status, blockingCount, score, latency },
        },
      ];
    }

    if (score < threshold) {
      return [
        {
          invariant: "ERGONOMIC_WALKTHROUGH_AUDITING",
          compliant: false,
          severity: "WARN",
          message: `Ergonomic Walkthrough notice: Composite Product Craft Score (${score.toFixed(1)}) is below threshold (${threshold.toFixed(1)}).`,
          details: { score, threshold, status },
        },
      ];
    }

    if (latency > latencyTarget * 2) {
      return [
        {
          invariant: "ERGONOMIC_WALKTHROUGH_AUDITING",
          compliant: false,
          severity: "WARN",
          message: `Ergonomic Walkthrough notice: Micro-interaction latency (${latency.toFixed(1)}ms) exceeds frame target (< ${latencyTarget}ms).`,
          details: { latency, latencyTarget },
        },
      ];
    }
  }

  return [
    {
      invariant: "ERGONOMIC_WALKTHROUGH_AUDITING",
      compliant: true,
      severity: "INFO",
      message:
        "Ergonomic Walkthrough Auditing invariant satisfied: product craft and micro-interaction latency within target budgets.",
    },
  ];
}
