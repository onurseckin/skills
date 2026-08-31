import { HarnessError } from "../../../core/errors/index.ts";
import type {
  FeedbackCategory,
  FeedbackItem,
  FeedbackPriority,
} from "../../feedback/queue/types.ts";

export type OpticalDimension =
  | "visual_hierarchy"
  | "optical_spacing"
  | "typography"
  | "clipping_overflow"
  | "contrast_fidelity"
  | "theme_harmony"
  | "z_index_overlay"
  | "touch_targets";

export const OPTICAL_DIMENSIONS: readonly OpticalDimension[] = [
  "visual_hierarchy",
  "optical_spacing",
  "typography",
  "clipping_overflow",
  "contrast_fidelity",
  "theme_harmony",
  "z_index_overlay",
  "touch_targets",
] as const;

export type OpticalViewport = "desktop_wide" | "desktop" | "tablet" | "mobile";

export interface OpticalViewportSpec {
  readonly id: OpticalViewport;
  readonly label: string;
  readonly resolution: string;
  readonly width: number;
  readonly height: number;
}

export const OPTICAL_VIEWPORTS: readonly OpticalViewportSpec[] = [
  { id: "desktop_wide", label: "Desktop-Wide", resolution: "1920x1080", width: 1920, height: 1080 },
  { id: "desktop", label: "Desktop", resolution: "1440x900", width: 1440, height: 900 },
  { id: "tablet", label: "Tablet", resolution: "768x1024", width: 768, height: 1024 },
  { id: "mobile", label: "Mobile", resolution: "390x844", width: 390, height: 844 },
] as const;

export interface CognitiveUiFinding {
  readonly dimension: OpticalDimension;
  readonly viewport?: OpticalViewport | undefined;
  readonly observation: string;
  readonly remediation: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly targetSelectorOrFile?: string | undefined;
}

export interface ParsedUiCritique {
  readonly title: string;
  readonly summary: string;
  readonly rawText: string;
  readonly isHumanGrade: boolean;
  readonly findings: readonly CognitiveUiFinding[];
  readonly dimensionsCovered: readonly OpticalDimension[];
  readonly viewportsEvaluated: readonly OpticalViewport[];
  readonly actionItems: readonly string[];
  readonly parsedAt: string;
}

export interface ActionableDesignIteration {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly acceptanceCriteria: readonly string[];
  readonly targetDimension: OpticalDimension;
  readonly remediationSteps: readonly string[];
}

export interface ParseCritiqueOptions {
  readonly defaultViewport?: OpticalViewport | undefined;
  readonly fallbackSeverity?: "critical" | "high" | "medium" | "low" | undefined;
  readonly now?: string | undefined;
}

export interface DesignIterationOptions {
  readonly baseWriteScope?: readonly string[] | undefined;
  readonly defaultGate?: string | undefined;
  readonly defaultAppPath?: string | undefined;
}

function detectDimensionsInText(text: string): OpticalDimension[] {
  const lower = text.toLowerCase();
  const detected: OpticalDimension[] = [];

  if (
    lower.includes("hierarchy") ||
    lower.includes("layout") ||
    lower.includes("focal") ||
    lower.includes("balance")
  ) {
    detected.push("visual_hierarchy");
  }
  if (
    lower.includes("spacing") ||
    lower.includes("margin") ||
    lower.includes("padding") ||
    lower.includes("rhythm") ||
    lower.includes("alignment")
  ) {
    detected.push("optical_spacing");
  }
  if (
    lower.includes("typography") ||
    lower.includes("font") ||
    lower.includes("line height") ||
    lower.includes("font-size") ||
    lower.includes("tracking")
  ) {
    detected.push("typography");
  }
  if (
    lower.includes("clipping") ||
    lower.includes("overflow") ||
    lower.includes("scroll") ||
    lower.includes("truncat")
  ) {
    detected.push("clipping_overflow");
  }
  if (
    lower.includes("contrast") ||
    lower.includes("apca") ||
    lower.includes("wcag") ||
    lower.includes("lightness") ||
    lower.includes("readability")
  ) {
    detected.push("contrast_fidelity");
  }
  if (
    lower.includes("theme") ||
    lower.includes("dark mode") ||
    lower.includes("light mode") ||
    lower.includes("color palette") ||
    lower.includes("specular")
  ) {
    detected.push("theme_harmony");
  }
  if (
    lower.includes("z-index") ||
    lower.includes("overlay") ||
    lower.includes("modal") ||
    lower.includes("layer") ||
    lower.includes("stacking")
  ) {
    detected.push("z_index_overlay");
  }
  if (
    lower.includes("touch") ||
    lower.includes("target") ||
    lower.includes("44px") ||
    lower.includes("48px") ||
    lower.includes("clickable")
  ) {
    detected.push("touch_targets");
  }

  return detected.length > 0 ? detected : ["visual_hierarchy"];
}

function detectViewportsInText(text: string): OpticalViewport[] {
  const lower = text.toLowerCase();
  const detected: OpticalViewport[] = [];

  if (lower.includes("1920") || lower.includes("wide") || lower.includes("desktop-wide")) {
    detected.push("desktop_wide");
  }
  if (lower.includes("1440") || lower.includes("desktop") || lower.includes("900")) {
    detected.push("desktop");
  }
  if (lower.includes("768") || lower.includes("tablet") || lower.includes("1024")) {
    detected.push("tablet");
  }
  if (
    lower.includes("390") ||
    lower.includes("mobile") ||
    lower.includes("844") ||
    lower.includes("phone")
  ) {
    detected.push("mobile");
  }

  return detected.length > 0 ? detected : ["desktop", "mobile"];
}

export class CognitiveUiCritiqueParser {
  public static parseCritique(
    critiqueInput: string | Record<string, unknown>,
    options: ParseCritiqueOptions = {},
  ): ParsedUiCritique {
    const rawText =
      typeof critiqueInput === "string" ? critiqueInput : JSON.stringify(critiqueInput, null, 2);

    if (!rawText.trim()) {
      throw new HarnessError("INVALID_ARGUMENT", "Critique text cannot be empty.");
    }

    const lines = rawText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const title = lines[0]?.replace(/^[#*-\s]+/, "") ?? "Cognitive UI Aesthetic Critique";
    const nowIso = options.now ?? new Date().toISOString();

    const dimensions = detectDimensionsInText(rawText);
    const viewports = detectViewportsInText(rawText);

    const findings: CognitiveUiFinding[] = [];
    const actionItems: string[] = [];

    // Check for robotic checklist boilerplate vs human-grade review
    const hasRoboticChecks =
      rawText.includes("[x]") ||
      rawText.includes("[ ]") ||
      rawText.toLowerCase().includes("checklist completed");
    const isHumanGrade = !hasRoboticChecks || dimensions.length >= 2;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (
        lower.startsWith("action:") ||
        lower.startsWith("- action:") ||
        lower.startsWith("remediation:") ||
        lower.startsWith("fix:")
      ) {
        const item = line.replace(/^[-*]*\s*(action|remediation|fix):\s*/i, "");
        if (item.length > 0) actionItems.push(item);
      }
    }

    for (const dim of dimensions) {
      const dimLines = lines.filter(
        (l) =>
          l.toLowerCase().includes(dim.replace(/_/g, " ")) ||
          l.toLowerCase().includes(dim.split("_")[0]!),
      );
      const observation =
        dimLines.length > 0
          ? dimLines.join(" ")
          : `Cognitive inspection noted polish opportunity in ${dim.replace(/_/g, " ")}.`;
      const remediation =
        actionItems.find((a) => a.toLowerCase().includes(dim.split("_")[0]!)) ??
        `Refine ${dim.replace(/_/g, " ")} across responsive viewports.`;

      let severity: "critical" | "high" | "medium" | "low" = options.fallbackSeverity ?? "medium";
      if (dim === "contrast_fidelity" || dim === "clipping_overflow") severity = "high";
      if (dim === "touch_targets" && (observation.includes("44") || observation.includes("48")))
        severity = "high";

      findings.push({
        dimension: dim,
        viewport: viewports[0],
        observation,
        remediation,
        severity,
      });
    }

    return {
      title,
      summary: lines.slice(0, 3).join(" "),
      rawText,
      isHumanGrade,
      findings,
      dimensionsCovered: dimensions,
      viewportsEvaluated: viewports,
      actionItems: actionItems.length > 0 ? actionItems : findings.map((f) => f.remediation),
      parsedAt: nowIso,
    };
  }

  public static synthesizeDesignIterations(
    critique: ParsedUiCritique,
    options: DesignIterationOptions = {},
  ): readonly ActionableDesignIteration[] {
    const iterations: ActionableDesignIteration[] = [];
    const appPath = options.defaultAppPath ?? "apps/web";
    const defaultScope = options.baseWriteScope ?? [
      `${appPath}/src/components/`,
      `${appPath}/src/styles/`,
    ];
    const defaultGate = options.defaultGate ?? "bun test tests/unit/ui/ && bun run typecheck";

    for (let i = 0; i < critique.findings.length; i++) {
      const finding = critique.findings[i]!;
      const dimLabel = finding.dimension.replace(/_/g, " ");
      const dimSlug = finding.dimension.replace(/_/g, "-");
      const priorityMap: Record<string, "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"> = {
        critical: "CRITICAL",
        high: "HIGH",
        medium: "MEDIUM",
        low: "LOW",
      };

      iterations.push({
        id: `task-ui-iteration-${i + 1}-${dimSlug}`,
        title: `UI Design Iteration: Refine ${dimLabel}`,
        goal: `Address cognitive optical critique: ${finding.observation}`,
        writeScope: finding.targetSelectorOrFile ? [finding.targetSelectorOrFile] : defaultScope,
        gate: defaultGate,
        priority: priorityMap[finding.severity] ?? "MEDIUM",
        acceptanceCriteria: [
          `Remediate optical finding: ${finding.observation}`,
          `Implement design improvement: ${finding.remediation}`,
          "Verify aesthetic integrity across Desktop (1440px) and Mobile (390px) viewports",
          `Pass verification gate: ${defaultGate}`,
        ],
        targetDimension: finding.dimension,
        remediationSteps: [finding.remediation],
      });
    }

    return iterations;
  }

  public static toFeedbackItems(
    critique: ParsedUiCritique,
    options?: { readonly basePriority?: FeedbackPriority | undefined },
  ): readonly FeedbackItem[] {
    const feedbackItems: FeedbackItem[] = [];
    const priority: FeedbackPriority = options?.basePriority ?? "HIGH_ARCHITECTURAL_FEATURE";

    for (let i = 0; i < critique.findings.length; i++) {
      const finding = critique.findings[i]!;
      const dimLabel = finding.dimension.replace(/_/g, " ");

      feedbackItems.push({
        id: `feedback-ui-critique-${Date.now()}-${i + 1}`,
        timestamp: critique.parsedAt,
        priority,
        status: "PENDING",
        category: "VALIDATION" as FeedbackCategory,
        title: `Cognitive UI Critique: ${dimLabel}`,
        content: `Observation: ${finding.observation}\nRemediation: ${finding.remediation}`,
        metadata: {
          dimension: finding.dimension,
          severity: finding.severity,
          viewport: finding.viewport,
        },
      });
    }

    return feedbackItems;
  }
}
