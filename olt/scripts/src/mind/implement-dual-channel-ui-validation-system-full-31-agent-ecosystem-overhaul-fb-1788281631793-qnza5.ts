export interface DomElementSnapshot {
  readonly tagName: string;
  readonly id?: string;
  readonly classes: readonly string[];
  readonly visible: boolean;
}

export interface DomChannelVerdict {
  readonly valid: boolean;
  readonly elementCount: number;
  readonly issues: readonly string[];
}

export interface VisualChannelVerdict {
  readonly valid: boolean;
  readonly contrastRatio: number;
  readonly aestheticScore: number;
  readonly layoutShift: number;
  readonly issues: readonly string[];
}

export interface DualChannelValidationVerdict {
  readonly valid: boolean;
  readonly dom: DomChannelVerdict;
  readonly visual: VisualChannelVerdict;
  readonly compositeScore: number;
}

export interface AgentRoleDescriptor {
  readonly role: string;
  readonly tier: number;
  readonly category: "supervisor" | "implementer" | "critic" | "auditor";
}

export const ECOSYSTEM_31_ROLES: readonly string[] = [
  "mind",
  "coordinator",
  "orchestrator",
  "plan-critic",
  "charter-critic",
  "completeness-critic",
  "drift-critic",
  "concurrency-critic",
  "anti-stagnation-critic",
  "pareto-critic",
  "socratic-critic",
  "ui-validator",
  "visual-auditor",
  "dom-auditor",
  "aesthetic-critic",
  "motion-auditor",
  "contrast-auditor",
  "mind-auditor",
  "skill-auditor",
  "telemetry-auditor",
  "test-runner-auditor",
  "coverage-auditor",
  "admission-critic",
  "grant-auditor",
  "evidence-critic",
  "report-critic",
  "worktree-auditor",
  "watchdog",
  "implementer",
  "repairer",
  "synthesizer",
];

export function validateDomChannel(elements: readonly DomElementSnapshot[]): DomChannelVerdict {
  const issues: string[] = [];
  if (elements.length === 0) {
    issues.push("DOM channel received empty element snapshot list");
  }
  const hiddenCount = elements.filter((el) => !el.visible).length;
  if (hiddenCount === elements.length && elements.length > 0) {
    issues.push("All elements in DOM snapshot are hidden");
  }
  return {
    valid: issues.length === 0,
    elementCount: elements.length,
    issues,
  };
}

export function validateVisualChannel(
  contrastRatio: number,
  layoutShift: number,
  aestheticScore: number,
): VisualChannelVerdict {
  const issues: string[] = [];
  if (contrastRatio < 4.5) {
    issues.push("Contrast ratio below WCAG AA requirement 4.5");
  }
  if (layoutShift > 0.1) {
    issues.push("Cumulative layout shift exceeds allowable threshold 0.1");
  }
  if (aestheticScore < 70) {
    issues.push("Visual aesthetic score below threshold 70");
  }
  return {
    valid: issues.length === 0,
    contrastRatio,
    aestheticScore,
    layoutShift,
    issues,
  };
}

export function validateDualChannel(
  elements: readonly DomElementSnapshot[],
  visual: {
    readonly contrastRatio: number;
    readonly layoutShift: number;
    readonly aestheticScore: number;
  },
): DualChannelValidationVerdict {
  const domVerdict = validateDomChannel(elements);
  const visualVerdict = validateVisualChannel(
    visual.contrastRatio,
    visual.layoutShift,
    visual.aestheticScore,
  );
  const valid = domVerdict.valid && visualVerdict.valid;
  const compositeScore = Math.round((domVerdict.valid ? 50 : 0) + visualVerdict.aestheticScore / 2);
  return {
    valid,
    dom: domVerdict,
    visual: visualVerdict,
    compositeScore,
  };
}

export function get31AgentEcosystem(): readonly AgentRoleDescriptor[] {
  return ECOSYSTEM_31_ROLES.map((role, idx) => {
    let tier = 3;
    let category: "supervisor" | "implementer" | "critic" | "auditor" = "implementer";
    if (["mind", "coordinator", "orchestrator"].includes(role)) {
      tier = 1;
      category = "supervisor";
    } else if (role.includes("critic")) {
      tier = 2;
      category = "critic";
    } else if (role.includes("auditor") ? true : role === "watchdog") {
      tier = 2;
      category = "auditor";
    }
    return {
      role,
      tier,
      category,
    };
  });
}
