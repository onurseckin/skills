/**
 * Creative Product Craft, Visual Aesthetics & User Empathy Stewardship.
 *
 * Implements the Five Pillars of Product Craft, mandatory ergonomic walkthrough audits,
 * weighted composite craft scoring, and aesthetic deficit notice gating for user-facing milestones.
 */

/**
 * The Five Pillars of Product Craft.
 */
export type ProductCraftPillar =
  | "VISUAL_HIERARCHY"
  | "LAYOUT_FLUIDITY"
  | "TACTILE_MICRO_INTERACTIONS"
  | "INTUITIVE_ONBOARDING"
  | "EMOTIONAL_RESONANCE";

/**
 * Constant dictionary of all Five Pillars of Product Craft.
 */
export const PRODUCT_CRAFT_PILLARS = {
  VISUAL_HIERARCHY: "VISUAL_HIERARCHY",
  LAYOUT_FLUIDITY: "LAYOUT_FLUIDITY",
  TACTILE_MICRO_INTERACTIONS: "TACTILE_MICRO_INTERACTIONS",
  INTUITIVE_ONBOARDING: "INTUITIVE_ONBOARDING",
  EMOTIONAL_RESONANCE: "EMOTIONAL_RESONANCE",
} as const;

/**
 * Array list of all product craft pillars.
 */
export const PRODUCT_CRAFT_PILLAR_LIST: readonly ProductCraftPillar[] = [
  PRODUCT_CRAFT_PILLARS.VISUAL_HIERARCHY,
  PRODUCT_CRAFT_PILLARS.LAYOUT_FLUIDITY,
  PRODUCT_CRAFT_PILLARS.TACTILE_MICRO_INTERACTIONS,
  PRODUCT_CRAFT_PILLARS.INTUITIVE_ONBOARDING,
  PRODUCT_CRAFT_PILLARS.EMOTIONAL_RESONANCE,
] as const;

/**
 * Detailed specification and empirical criteria for a product craft pillar.
 */
export interface ProductCraftPillarDefinition {
  readonly id: ProductCraftPillar;
  readonly title: string;
  readonly shortDescription: string;
  readonly evaluationCriteria: readonly string[];
  readonly targetMetric: string;
  readonly defaultWeight: number;
}

/**
 * Detailed definitions for each of the Five Pillars of Product Craft.
 */
export const PRODUCT_CRAFT_PILLAR_DEFINITIONS: Readonly<
  Record<ProductCraftPillar, ProductCraftPillarDefinition>
> = {
  VISUAL_HIERARCHY: {
    id: "VISUAL_HIERARCHY",
    title: "Visual Hierarchy & Informational Clarity",
    shortDescription:
      "Informational clarity, readable typographic scale, intentional whitespace, lack of clutter.",
    evaluationCriteria: [
      "Readable, harmonious typographic scale with distinct heading levels and comfortable line-height",
      "Intentional whitespace rhythm maintaining consistent 4px/8px grid alignment across components",
      "Elimination of visual clutter, noisy backgrounds, and low-contrast text (contrast >= 4.5:1)",
      "Unambiguous visual focal points guiding the eye naturally to primary and secondary actions",
    ],
    targetMetric:
      "Zero ambiguous visual groupings; distinct typographic hierarchy with >= 4.5:1 contrast ratio",
    defaultWeight: 0.2,
  },
  LAYOUT_FLUIDITY: {
    id: "LAYOUT_FLUIDITY",
    title: "Layout Fluidity & Responsive Grace",
    shortDescription:
      "Responsive viewport adaptability, smooth loading and empty states, fluid transitions.",
    evaluationCriteria: [
      "Graceful layout reflow across mobile, tablet, desktop, and ultrawide viewports",
      "Zero horizontal scrolling, overlapping text, or broken container overflows",
      "Thoughtfully designed empty states providing immediate guidance and actionable next steps",
      "Skeleton screens and loading placeholders preventing layout shifts (CLS < 0.1)",
    ],
    targetMetric:
      "Seamless viewport reflow; Cumulative Layout Shift (CLS) < 0.1; zero clipped text",
    defaultWeight: 0.2,
  },
  TACTILE_MICRO_INTERACTIONS: {
    id: "TACTILE_MICRO_INTERACTIONS",
    title: "Tactile Micro-Interactions & Responsiveness",
    shortDescription:
      "Perceptual feedback latency (<16ms target), crisp focus rings, interactive states, clear progress feedback.",
    evaluationCriteria: [
      "Perceptual feedback latency under 16ms (60fps animation budget) for all user actions",
      "Crisp, high-visibility focus rings supporting seamless keyboard navigation",
      "Explicit interactive states (default, hover, active, focus-visible, disabled, loading)",
      "Deterministic progress feedback and optimistic updates for asynchronous background work",
    ],
    targetMetric:
      "Perceptual feedback latency < 16ms; 100% interactive elements with distinct hover/focus states",
    defaultWeight: 0.2,
  },
  INTUITIVE_ONBOARDING: {
    id: "INTUITIVE_ONBOARDING",
    title: "Intuitive Onboarding & Zero-Doc Usability",
    shortDescription:
      "Self-explanatory user journeys requiring zero documentation to understand basic workflows, cognitive friction reduction.",
    evaluationCriteria: [
      "Self-evident workflows requiring zero external documentation for core actions",
      "Immediate visual feedback loops and clear, non-punitive error recovery paths",
      "Contextual inline affordances and gentle progressive disclosure",
      "Radical reduction of cognitive friction and decision paralysis",
    ],
    targetMetric: "Zero-documentation core workflow completion; cognitive friction index < 0.15",
    defaultWeight: 0.2,
  },
  EMOTIONAL_RESONANCE: {
    id: "EMOTIONAL_RESONANCE",
    title: "Emotional Resonance & Aesthetic Delight",
    shortDescription:
      "Consistent color semantics, aesthetic delight, visual polish, conveying care and quality.",
    evaluationCriteria: [
      "Harmonious, semantically consistent color palette (danger, warning, success, neutral, brand)",
      "Subtle micro-delight animations and cohesive, pixel-perfect iconography",
      "Visual polish conveying extreme care, craftsmanship, intentionality, and trust",
      "Unified design language across all modal dialogs, cards, buttons, and notifications",
    ],
    targetMetric:
      "100% color semantic consistency; cohesive design system tokens applied universally",
    defaultWeight: 0.2,
  },
};

/**
 * Standard passing composite score threshold for ergonomic walkthrough audits.
 */
export const CRAFT_PASS_THRESHOLD = 85;

/**
 * Target perceptual latency budget in milliseconds (16ms = 60fps frame budget).
 */
export const PERCEPTUAL_LATENCY_TARGET_MS = 16;

/**
 * Default pillar weights summing to 1.0 (20% each).
 */
export const DEFAULT_PILLAR_WEIGHTS: Readonly<Record<ProductCraftPillar, number>> = {
  VISUAL_HIERARCHY: 0.2,
  LAYOUT_FLUIDITY: 0.2,
  TACTILE_MICRO_INTERACTIONS: 0.2,
  INTUITIVE_ONBOARDING: 0.2,
  EMOTIONAL_RESONANCE: 0.2,
};

/**
 * Severity levels for aesthetic deficits.
 */
export type DeficitSeverity = "BLOCKING" | "MAJOR" | "MINOR";

/**
 * Constant map of deficit severity levels.
 */
export const DEFICIT_SEVERITIES = {
  BLOCKING: "BLOCKING",
  MAJOR: "MAJOR",
  MINOR: "MINOR",
} as const;

/**
 * A single step within an audited user journey.
 */
export interface UserJourneyStep {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly targetPillars?: readonly ProductCraftPillar[] | undefined;
  readonly expectedOutcome?: string | undefined;
  readonly viewport?: string | undefined;
  readonly interactiveElements?: readonly string[] | undefined;
  readonly notes?: string | undefined;
}

/**
 * A user journey representing an end-to-end walkthrough path through a user-facing milestone.
 */
export interface UserJourney {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly milestoneId?: string | undefined;
  readonly steps: readonly UserJourneyStep[];
  readonly targetAudience?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * An Aesthetic Deficit Notice generated during ergonomic walkthrough audits.
 * Blocks milestone sign-off while unresolved BLOCKING or MAJOR notices exist.
 */
export interface AestheticDeficitNotice {
  readonly id: string;
  readonly milestoneId: string;
  readonly pillar: ProductCraftPillar;
  readonly severity: DeficitSeverity;
  readonly stepId?: string | undefined;
  readonly visualDefectDescription: string;
  readonly remediationGuidance: string;
  readonly resolved: boolean;
  readonly resolvedAt?: string | undefined;
  readonly resolutionSummary?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Input payload for creating or registering an Aesthetic Deficit Notice.
 */
export interface CreateDeficitNoticeInput {
  readonly id?: string | undefined;
  readonly milestoneId: string;
  readonly pillar: ProductCraftPillar;
  readonly severity: DeficitSeverity;
  readonly stepId?: string | undefined;
  readonly visualDefectDescription: string;
  readonly remediationGuidance: string;
  readonly resolved?: boolean | undefined;
  readonly resolvedAt?: string | undefined;
  readonly resolutionSummary?: string | undefined;
  readonly createdAt?: string | undefined;
}

/**
 * Input for an explicit deficit identified during milestone walkthrough.
 */
export interface DeficitInput {
  readonly pillar: ProductCraftPillar;
  readonly severity: DeficitSeverity;
  readonly stepId?: string | undefined;
  readonly visualDefectDescription: string;
  readonly remediationGuidance: string;
}

/**
 * Detailed score input for an individual pillar.
 */
export interface PillarScoreInput {
  readonly score: number;
  readonly observations?: readonly string[] | undefined;
  readonly deficits?: readonly DeficitInput[] | undefined;
}

/**
 * Input options for conducting a milestone ergonomic walkthrough audit.
 */
export interface MilestoneAuditOptions {
  readonly milestoneId: string;
  readonly milestoneTitle?: string | undefined;
  readonly isUserFacing?: boolean | undefined;
  readonly userJourneys?: readonly UserJourney[] | undefined;
  readonly passThreshold?: number | undefined;
  readonly pillarWeights?: Partial<Record<ProductCraftPillar, number>> | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Evaluation details for an individual product craft pillar.
 */
export interface PillarEvaluation {
  readonly pillar: ProductCraftPillar;
  readonly score: number;
  readonly weight: number;
  readonly weightedScore: number;
  readonly passed: boolean;
  readonly deficits: readonly AestheticDeficitNotice[];
  readonly observations: readonly string[];
}

/**
 * Comprehensive result of an Ergonomic Walkthrough Audit.
 */
export interface ErgonomicAuditResult {
  readonly id: string;
  readonly milestoneId: string;
  readonly milestoneTitle?: string | undefined;
  readonly isUserFacing: boolean;
  readonly evaluatedAt: string;
  readonly pillarScores: Readonly<Record<ProductCraftPillar, PillarEvaluation>>;
  readonly compositeScore: number;
  readonly passThreshold: number;
  readonly passed: boolean;
  readonly activeDeficitNotices: readonly AestheticDeficitNotice[];
  readonly blockingDeficitsCount: number;
  readonly majorDeficitsCount: number;
  readonly minorDeficitsCount: number;
  readonly isMilestoneSignOffBlocked: boolean;
  readonly summary: string;
  readonly remediationPlan: readonly string[];
}

/**
 * Milestone sign-off gate status.
 */
export interface MilestoneSignOffStatus {
  readonly milestoneId: string;
  readonly isUserFacing: boolean;
  readonly canSignOff: boolean;
  readonly signedOff: boolean;
  readonly signedOffAt?: string | undefined;
  readonly signer?: string | undefined;
  readonly blockingReasons: readonly string[];
  readonly unresolvedDeficitNotices: readonly AestheticDeficitNotice[];
  readonly lastAuditResult?: ErgonomicAuditResult | undefined;
}

/**
 * Configuration options for the ErgonomicWalkthroughAuditor.
 */
export interface ErgonomicWalkthroughAuditorOptions {
  readonly passThreshold?: number | undefined;
  readonly pillarWeights?: Partial<Record<ProductCraftPillar, number>> | undefined;
  readonly autoGenerateDeficitsOnLowScore?: boolean | undefined;
}

/**
 * Generates a unique Aesthetic Deficit Notice with validated fields.
 */
export function generateAestheticDeficitNotice(
  input: CreateDeficitNoticeInput,
): AestheticDeficitNotice {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const id =
    input.id ??
    `deficit-${input.milestoneId}-${input.pillar.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    milestoneId: input.milestoneId,
    pillar: input.pillar,
    severity: input.severity,
    ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
    visualDefectDescription: input.visualDefectDescription,
    remediationGuidance: input.remediationGuidance,
    resolved: input.resolved ?? false,
    ...(input.resolvedAt !== undefined ? { resolvedAt: input.resolvedAt } : {}),
    ...(input.resolutionSummary !== undefined
      ? { resolutionSummary: input.resolutionSummary }
      : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Computes the normalized weighted composite craft score across the 5 pillars.
 */
export function calculateCompositeCraftScore(
  pillarScores: Record<ProductCraftPillar, number>,
  customWeights?: Partial<Record<ProductCraftPillar, number>> | undefined,
): number {
  const weights: Record<ProductCraftPillar, number> = {
    ...DEFAULT_PILLAR_WEIGHTS,
    ...(customWeights ?? {}),
  };

  const totalWeight = PRODUCT_CRAFT_PILLAR_LIST.reduce(
    (sum, pillar) => sum + (weights[pillar] ?? 0.2),
    0,
  );

  const normalizedWeights: Record<ProductCraftPillar, number> =
    totalWeight > 0
      ? {
          VISUAL_HIERARCHY: (weights.VISUAL_HIERARCHY ?? 0.2) / totalWeight,
          LAYOUT_FLUIDITY: (weights.LAYOUT_FLUIDITY ?? 0.2) / totalWeight,
          TACTILE_MICRO_INTERACTIONS: (weights.TACTILE_MICRO_INTERACTIONS ?? 0.2) / totalWeight,
          INTUITIVE_ONBOARDING: (weights.INTUITIVE_ONBOARDING ?? 0.2) / totalWeight,
          EMOTIONAL_RESONANCE: (weights.EMOTIONAL_RESONANCE ?? 0.2) / totalWeight,
        }
      : DEFAULT_PILLAR_WEIGHTS;

  let composite = 0;
  for (const pillar of PRODUCT_CRAFT_PILLAR_LIST) {
    const rawScore = pillarScores[pillar] ?? 0;
    const clampedScore = Math.max(0, Math.min(100, rawScore));
    composite += clampedScore * (normalizedWeights[pillar] ?? 0.2);
  }

  return Math.round(composite * 100) / 100;
}

/**
 * Formats an Ergonomic Audit Result into rich GitHub-flavored Markdown.
 */
export function formatProductCraftAuditMarkdown(result: ErgonomicAuditResult): string {
  const statusIcon = result.passed ? "✅ PASS" : "❌ DEFICIT DETECTED";
  const lines: string[] = [
    `# Product Craft & Ergonomic Walkthrough Audit: \`${result.milestoneId}\``,
    "",
    `**Status:** ${statusIcon} | **Composite Craft Score:** \`${result.compositeScore}/100\` (Threshold: >= ${result.passThreshold})`,
    `**Evaluated At:** ${result.evaluatedAt} | **User Facing:** ${result.isUserFacing ? "Yes" : "No"} | **Sign-off Blocked:** ${result.isMilestoneSignOffBlocked ? "YES" : "NO"}`,
    "",
    "### Five Pillars of Product Craft Evaluation",
    "",
    "| Pillar | Score | Weight | Weighted | Status | Deficits |",
    "| :--- | :---: | :---: | :---: | :---: | :---: |",
  ];

  for (const pillar of PRODUCT_CRAFT_PILLAR_LIST) {
    const evalData = result.pillarScores[pillar];
    const def = PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar];
    const pStatus = evalData.passed ? "PASS" : "DEFICIT";
    const defCount = evalData.deficits.length;
    lines.push(
      `| **${def.title}** | \`${evalData.score.toFixed(1)}\` | \`${(evalData.weight * 100).toFixed(0)}%\` | \`${evalData.weightedScore.toFixed(1)}\` | ${pStatus} | ${defCount} |`,
    );
  }

  lines.push("");

  if (result.activeDeficitNotices.length > 0) {
    lines.push("### Aesthetic Deficit Notices");
    lines.push("");
    for (const notice of result.activeDeficitNotices) {
      const sevBadge =
        notice.severity === "BLOCKING"
          ? "🚨 BLOCKING"
          : notice.severity === "MAJOR"
            ? "⚠️ MAJOR"
            : "ℹ️ MINOR";
      const resolvedBadge = notice.resolved ? "[RESOLVED]" : "[OPEN]";
      lines.push(
        `- **${sevBadge}** ${resolvedBadge} \`${notice.id}\` (*${notice.pillar}*${notice.stepId !== undefined ? ` at step \`${notice.stepId}\`` : ""})`,
      );
      lines.push(`  - **Defect:** ${notice.visualDefectDescription}`);
      lines.push(`  - **Remediation:** ${notice.remediationGuidance}`);
      if (notice.resolved && notice.resolutionSummary !== undefined) {
        lines.push(`  - **Resolution:** ${notice.resolutionSummary}`);
      }
    }
    lines.push("");
  }

  if (result.remediationPlan.length > 0) {
    lines.push("### Remediation Action Plan");
    lines.push("");
    for (const action of result.remediationPlan) {
      lines.push(`1. ${action}`);
    }
    lines.push("");
  }

  lines.push(`> **Summary:** ${result.summary}`);

  return lines.join("\n");
}

/**
 * Renders an ASCII table summary of the Product Craft evaluation.
 */
export function renderProductCraftAsciiTable(result: ErgonomicAuditResult): string {
  const rows: string[] = [
    "+---------------------------------------+-------+--------+----------+---------+",
    "| Pillar                                | Score | Weight | Weighted | Status  |",
    "+---------------------------------------+-------+--------+----------+---------+",
  ];

  for (const pillar of PRODUCT_CRAFT_PILLAR_LIST) {
    const evalData = result.pillarScores[pillar];
    const def = PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar];
    const shortName = def.title.padEnd(37).slice(0, 37);
    const scoreStr = evalData.score.toFixed(1).padStart(5);
    const weightStr = `${(evalData.weight * 100).toFixed(0)}%`.padStart(6);
    const weightedStr = evalData.weightedScore.toFixed(1).padStart(8);
    const statusStr = evalData.passed ? " PASS  " : "DEFICIT";
    rows.push(`| ${shortName} | ${scoreStr} | ${weightStr} | ${weightedStr} | ${statusStr} |`);
  }

  rows.push(
    "+---------------------------------------+-------+--------+----------+---------+",
    `| COMPOSITE SCORE: ${result.compositeScore.toFixed(1).padStart(5)} / 100 (Threshold: >= ${result.passThreshold}) | Status: ${result.passed ? "PASS   " : "FAILED "} |`,
    "+-----------------------------------------------------------------------------+",
  );

  return rows.join("\n");
}

/**
 * ErgonomicWalkthroughAuditor conducts mandatory audits across the Five Pillars of Product Craft,
 * computes weighted composite scores, manages Aesthetic Deficit Notices, and gates user-facing milestone sign-offs.
 */
export class ErgonomicWalkthroughAuditor {
  private readonly passThreshold: number;
  private readonly pillarWeights: Partial<Record<ProductCraftPillar, number>>;
  private readonly autoGenerateDeficits: boolean;
  private readonly deficitNotices: Map<string, AestheticDeficitNotice> = new Map();
  private readonly auditHistory: Map<string, ErgonomicAuditResult[]> = new Map();
  private readonly signOffs: Map<string, { signedOffAt: string; signer?: string | undefined }> =
    new Map();

  public constructor(options?: ErgonomicWalkthroughAuditorOptions) {
    this.passThreshold = options?.passThreshold ?? CRAFT_PASS_THRESHOLD;
    this.pillarWeights = options?.pillarWeights ?? {};
    this.autoGenerateDeficits = options?.autoGenerateDeficitsOnLowScore ?? true;
  }

  /**
   * Conducts a mandatory ergonomic walkthrough audit on a milestone across the Five Pillars.
   */
  public auditMilestoneErgonomics(
    milestone: string | MilestoneAuditOptions | UserJourney,
    rubricScores: Record<ProductCraftPillar, number | PillarScoreInput>,
    explicitDeficits?: readonly DeficitInput[] | undefined,
  ): ErgonomicAuditResult {
    const auditOptions: MilestoneAuditOptions =
      typeof milestone === "string"
        ? { milestoneId: milestone, isUserFacing: true }
        : "steps" in milestone
          ? {
              milestoneId: milestone.milestoneId ?? milestone.id,
              milestoneTitle: milestone.title,
              isUserFacing: true,
              userJourneys: [milestone as UserJourney],
            }
          : (milestone as MilestoneAuditOptions);

    const milestoneId = auditOptions.milestoneId;
    const isUserFacing = auditOptions.isUserFacing ?? true;
    const threshold = auditOptions.passThreshold ?? this.passThreshold;
    const customWeights = auditOptions.pillarWeights ?? this.pillarWeights;
    const evaluatedAt = new Date().toISOString();

    const normalizedWeights: Record<ProductCraftPillar, number> = {
      ...DEFAULT_PILLAR_WEIGHTS,
      ...customWeights,
    };
    const totalWeight = PRODUCT_CRAFT_PILLAR_LIST.reduce(
      (sum, p) => sum + (normalizedWeights[p] ?? 0.2),
      0,
    );
    for (const pillar of PRODUCT_CRAFT_PILLAR_LIST) {
      normalizedWeights[pillar] =
        totalWeight > 0 ? (normalizedWeights[pillar] ?? 0.2) / totalWeight : 0.2;
    }

    const pillarEvaluations: Record<ProductCraftPillar, PillarEvaluation> = {
      VISUAL_HIERARCHY: {
        pillar: "VISUAL_HIERARCHY",
        score: 0,
        weight: normalizedWeights.VISUAL_HIERARCHY ?? 0.2,
        weightedScore: 0,
        passed: false,
        deficits: [],
        observations: [],
      },
      LAYOUT_FLUIDITY: {
        pillar: "LAYOUT_FLUIDITY",
        score: 0,
        weight: normalizedWeights.LAYOUT_FLUIDITY ?? 0.2,
        weightedScore: 0,
        passed: false,
        deficits: [],
        observations: [],
      },
      TACTILE_MICRO_INTERACTIONS: {
        pillar: "TACTILE_MICRO_INTERACTIONS",
        score: 0,
        weight: normalizedWeights.TACTILE_MICRO_INTERACTIONS ?? 0.2,
        weightedScore: 0,
        passed: false,
        deficits: [],
        observations: [],
      },
      INTUITIVE_ONBOARDING: {
        pillar: "INTUITIVE_ONBOARDING",
        score: 0,
        weight: normalizedWeights.INTUITIVE_ONBOARDING ?? 0.2,
        weightedScore: 0,
        passed: false,
        deficits: [],
        observations: [],
      },
      EMOTIONAL_RESONANCE: {
        pillar: "EMOTIONAL_RESONANCE",
        score: 0,
        weight: normalizedWeights.EMOTIONAL_RESONANCE ?? 0.2,
        weightedScore: 0,
        passed: false,
        deficits: [],
        observations: [],
      },
    };

    const newDeficitNotices: AestheticDeficitNotice[] = [];
    let compositeScore = 0;

    for (const pillar of PRODUCT_CRAFT_PILLAR_LIST) {
      const rawInput = rubricScores[pillar];
      let score = 0;
      let observations: readonly string[] = [];
      const pillarDeficits: DeficitInput[] = [];

      if (typeof rawInput === "number") {
        score = Math.max(0, Math.min(100, rawInput));
      } else if (rawInput !== undefined && typeof rawInput === "object") {
        score = Math.max(0, Math.min(100, rawInput.score));
        observations = rawInput.observations ?? [];
        if (rawInput.deficits !== undefined) {
          pillarDeficits.push(...rawInput.deficits);
        }
      }

      if (explicitDeficits !== undefined) {
        for (const def of explicitDeficits) {
          if (def.pillar === pillar) {
            pillarDeficits.push(def);
          }
        }
      }

      if (this.autoGenerateDeficits && pillarDeficits.length === 0) {
        if (score < 50) {
          pillarDeficits.push({
            pillar,
            severity: "BLOCKING",
            visualDefectDescription: `Critical deficit in ${PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar].title} (score: ${score}/100)`,
            remediationGuidance: `Address core requirements for ${PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar].title}: ${PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar].shortDescription}`,
          });
        } else if (score < 70) {
          pillarDeficits.push({
            pillar,
            severity: "MAJOR",
            visualDefectDescription: `Major craft deficit in ${PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar].title} (score: ${score}/100)`,
            remediationGuidance: `Remediate layout/interaction fidelity to meet target metric: ${PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar].targetMetric}`,
          });
        } else if (score < threshold) {
          pillarDeficits.push({
            pillar,
            severity: "MINOR",
            visualDefectDescription: `Minor polish gap in ${PRODUCT_CRAFT_PILLAR_DEFINITIONS[pillar].title} (score: ${score}/100)`,
            remediationGuidance: `Refine visual polish to achieve >= ${threshold} threshold.`,
          });
        }
      }

      const generatedNoticesForPillar: AestheticDeficitNotice[] = [];
      for (const defInput of pillarDeficits) {
        const notice = generateAestheticDeficitNotice({
          milestoneId,
          pillar: defInput.pillar,
          severity: defInput.severity,
          ...(defInput.stepId !== undefined ? { stepId: defInput.stepId } : {}),
          visualDefectDescription: defInput.visualDefectDescription,
          remediationGuidance: defInput.remediationGuidance,
          createdAt: evaluatedAt,
        });
        this.registerDeficitNotice(notice);
        generatedNoticesForPillar.push(notice);
        newDeficitNotices.push(notice);
      }

      const weight = normalizedWeights[pillar] ?? 0.2;
      const weightedScore = Math.round(score * weight * 100) / 100;
      compositeScore += weightedScore;

      const hasBlockingPillarDeficits = generatedNoticesForPillar.some(
        (n) => n.severity === "BLOCKING" && !n.resolved,
      );
      const passedPillar = score >= threshold && !hasBlockingPillarDeficits;

      pillarEvaluations[pillar] = {
        pillar,
        score,
        weight,
        weightedScore,
        passed: passedPillar,
        deficits: generatedNoticesForPillar,
        observations,
      };
    }

    compositeScore = Math.round(compositeScore * 100) / 100;

    const allMilestoneNotices = this.getDeficitNotices(milestoneId);
    const unresolvedBlockingNotices = allMilestoneNotices.filter(
      (n) => n.severity === "BLOCKING" && !n.resolved,
    );
    const unresolvedMajorNotices = allMilestoneNotices.filter(
      (n) => n.severity === "MAJOR" && !n.resolved,
    );
    const unresolvedMinorNotices = allMilestoneNotices.filter(
      (n) => n.severity === "MINOR" && !n.resolved,
    );

    const passed = compositeScore >= threshold && unresolvedBlockingNotices.length === 0;

    const isMilestoneSignOffBlocked =
      isUserFacing &&
      (!passed || unresolvedBlockingNotices.length > 0 || unresolvedMajorNotices.length > 0);

    const remediationPlan: string[] = [];
    for (const notice of allMilestoneNotices.filter((n) => !n.resolved)) {
      remediationPlan.push(`[${notice.severity}] ${notice.pillar}: ${notice.remediationGuidance}`);
    }
    if (compositeScore < threshold) {
      remediationPlan.push(
        `Elevate composite craft score from ${compositeScore.toFixed(1)} to at least ${threshold.toFixed(1)} across failing pillars.`,
      );
    }

    let summary: string;
    if (passed && !isMilestoneSignOffBlocked) {
      summary = `Ergonomic walkthrough audit PASSED with composite score ${compositeScore.toFixed(1)}/100 (threshold >= ${threshold}). All Five Pillars of Product Craft meet quality benchmarks.`;
    } else {
      summary = `Ergonomic walkthrough audit FAILED with composite score ${compositeScore.toFixed(1)}/100 (threshold >= ${threshold}). Found ${unresolvedBlockingNotices.length} blocking, ${unresolvedMajorNotices.length} major, and ${unresolvedMinorNotices.length} minor aesthetic deficits. Milestone sign-off is BLOCKED until resolved.`;
    }

    const auditResult: ErgonomicAuditResult = {
      id: `audit-${milestoneId}-${Date.now()}`,
      milestoneId,
      ...(auditOptions.milestoneTitle !== undefined
        ? { milestoneTitle: auditOptions.milestoneTitle }
        : {}),
      isUserFacing,
      evaluatedAt,
      pillarScores: pillarEvaluations,
      compositeScore,
      passThreshold: threshold,
      passed,
      activeDeficitNotices: allMilestoneNotices.filter((n) => !n.resolved),
      blockingDeficitsCount: unresolvedBlockingNotices.length,
      majorDeficitsCount: unresolvedMajorNotices.length,
      minorDeficitsCount: unresolvedMinorNotices.length,
      isMilestoneSignOffBlocked,
      summary,
      remediationPlan,
    };

    const history = this.auditHistory.get(milestoneId) ?? [];
    history.push(auditResult);
    this.auditHistory.set(milestoneId, history);

    return auditResult;
  }

  /**
   * Generates and registers an Aesthetic Deficit Notice.
   */
  public generateDeficitNotice(input: CreateDeficitNoticeInput): AestheticDeficitNotice {
    const notice = generateAestheticDeficitNotice(input);
    this.registerDeficitNotice(notice);
    return notice;
  }

  /**
   * Registers a deficit notice into the auditor's tracking store.
   */
  public registerDeficitNotice(notice: AestheticDeficitNotice): AestheticDeficitNotice {
    this.deficitNotices.set(notice.id, notice);
    return notice;
  }

  /**
   * Resolves an Aesthetic Deficit Notice with a verified remediation summary.
   * Unblocks milestone sign-off if all blocking and major notices are resolved.
   */
  public resolveDeficitNotice(noticeId: string, resolutionSummary: string): AestheticDeficitNotice {
    const existing = this.deficitNotices.get(noticeId);
    if (existing === undefined) {
      throw new Error(`Aesthetic Deficit Notice with id '${noticeId}' not found.`);
    }

    const updated: AestheticDeficitNotice = {
      ...existing,
      resolved: true,
      resolvedAt: new Date().toISOString(),
      resolutionSummary,
      updatedAt: new Date().toISOString(),
    };

    this.deficitNotices.set(noticeId, updated);
    return updated;
  }

  /**
   * Returns all deficit notices, optionally filtered by milestone ID.
   */
  public getDeficitNotices(milestoneId?: string): readonly AestheticDeficitNotice[] {
    const all = Array.from(this.deficitNotices.values());
    if (milestoneId === undefined) {
      return all;
    }
    return all.filter((n) => n.milestoneId === milestoneId);
  }

  /**
   * Returns all unresolved deficit notices, optionally filtered by milestone ID.
   */
  public getUnresolvedDeficits(milestoneId?: string): readonly AestheticDeficitNotice[] {
    return this.getDeficitNotices(milestoneId).filter((n) => !n.resolved);
  }

  /**
   * Returns unresolved BLOCKING deficit notices.
   */
  public getBlockingDeficits(milestoneId?: string): readonly AestheticDeficitNotice[] {
    return this.getUnresolvedDeficits(milestoneId).filter((n) => n.severity === "BLOCKING");
  }

  /**
   * Returns unresolved MAJOR deficit notices.
   */
  public getMajorDeficits(milestoneId?: string): readonly AestheticDeficitNotice[] {
    return this.getUnresolvedDeficits(milestoneId).filter((n) => n.severity === "MAJOR");
  }

  /**
   * Checks whether a milestone can be signed off, detailing any blocking aesthetic reasons.
   */
  public canSignOffMilestone(milestoneId: string): MilestoneSignOffStatus {
    const history = this.auditHistory.get(milestoneId);
    const lastAuditResult =
      history !== undefined && history.length > 0 ? history[history.length - 1] : undefined;

    const signOffRecord = this.signOffs.get(milestoneId);
    const isSignedOff = signOffRecord !== undefined;
    const unresolvedNotices = this.getUnresolvedDeficits(milestoneId);
    const blockingNotices = unresolvedNotices.filter((n) => n.severity === "BLOCKING");
    const majorNotices = unresolvedNotices.filter((n) => n.severity === "MAJOR");

    const blockingReasons: string[] = [];
    const isUserFacing = lastAuditResult?.isUserFacing ?? true;

    if (lastAuditResult === undefined) {
      blockingReasons.push(
        `Milestone '${milestoneId}' has not undergone a mandatory ergonomic walkthrough audit.`,
      );
    } else {
      if (lastAuditResult.compositeScore < lastAuditResult.passThreshold) {
        blockingReasons.push(
          `Composite craft score (${lastAuditResult.compositeScore.toFixed(1)}/100) is below the required pass threshold (${lastAuditResult.passThreshold}).`,
        );
      }
    }

    if (blockingNotices.length > 0) {
      blockingReasons.push(
        `${blockingNotices.length} unresolved BLOCKING aesthetic deficit notice(s) remain active.`,
      );
    }

    if (isUserFacing && majorNotices.length > 0) {
      blockingReasons.push(
        `${majorNotices.length} unresolved MAJOR aesthetic deficit notice(s) remain active on user-facing milestone.`,
      );
    }

    const canSignOff = blockingReasons.length === 0;

    return {
      milestoneId,
      isUserFacing,
      canSignOff,
      signedOff: isSignedOff,
      ...(signOffRecord?.signedOffAt !== undefined
        ? { signedOffAt: signOffRecord.signedOffAt }
        : {}),
      ...(signOffRecord?.signer !== undefined ? { signer: signOffRecord.signer } : {}),
      blockingReasons,
      unresolvedDeficitNotices: unresolvedNotices,
      ...(lastAuditResult !== undefined ? { lastAuditResult } : {}),
    };
  }

  /**
   * Executes sign-off for a milestone if all ergonomic craft gates are satisfied.
   */
  public signOffMilestone(
    milestoneId: string,
    signer?: string | undefined,
  ): MilestoneSignOffStatus {
    const status = this.canSignOffMilestone(milestoneId);
    if (!status.canSignOff) {
      return status;
    }

    const signedOffAt = new Date().toISOString();
    this.signOffs.set(milestoneId, { signedOffAt, signer });

    return {
      ...status,
      signedOff: true,
      signedOffAt,
      ...(signer !== undefined ? { signer } : {}),
    };
  }

  /**
   * Retrieves full audit history for a milestone or across all milestones.
   */
  public getAuditHistory(milestoneId?: string): readonly ErgonomicAuditResult[] {
    if (milestoneId !== undefined) {
      return this.auditHistory.get(milestoneId) ?? [];
    }
    const all: ErgonomicAuditResult[] = [];
    for (const results of this.auditHistory.values()) {
      all.push(...results);
    }
    return all;
  }

  /**
   * Clears in-memory audit results, notices, and sign-offs.
   */
  public reset(): void {
    this.deficitNotices.clear();
    this.auditHistory.clear();
    this.signOffs.clear();
  }
}

/**
 * Factory helper for creating an ErgonomicWalkthroughAuditor.
 */
export function createErgonomicWalkthroughAuditor(
  options?: ErgonomicWalkthroughAuditorOptions,
): ErgonomicWalkthroughAuditor {
  return new ErgonomicWalkthroughAuditor(options);
}
