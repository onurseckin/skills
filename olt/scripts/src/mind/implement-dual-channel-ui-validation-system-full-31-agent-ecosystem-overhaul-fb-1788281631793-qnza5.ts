export interface DomElementSnapshot {
  readonly tagName: string;
  readonly id?: string;
  readonly classes: readonly string[];
  readonly visible: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly isInteractive?: boolean;
}

export interface DomChannelVerdict {
  readonly valid: boolean;
  readonly elementCount: number;
  readonly visibleCount: number;
  readonly minHitboxSatisfied: boolean;
  readonly issues: readonly string[];
}

export interface VisualChannelVerdict {
  readonly valid: boolean;
  readonly contrastRatio: number;
  readonly layoutShift: number;
  readonly aestheticScore: number;
  readonly heatmapDiff?: number;
  readonly issues: readonly string[];
}

export type VisualChannelInput = Omit<VisualChannelVerdict, "valid" | "issues">;

export interface DualChannelValidationVerdict {
  readonly valid: boolean;
  readonly dom: DomChannelVerdict;
  readonly visual: VisualChannelVerdict;
  readonly compositeScore: number;
}

export interface AgentRoleDescriptor {
  readonly role: string;
  readonly tier: number;
  readonly category: "supervisor" | "implementer" | "critic" | "auditor" | "validator";
}

export type SyntheticUiStateKind = "empty" | "partial" | "loaded" | "error";

export interface SyntheticUiFixture<T> {
  readonly state: SyntheticUiStateKind;
  readonly data: readonly T[];
  readonly isLoading: boolean;
  readonly hasError: boolean;
  readonly errorMessage?: string;
  readonly recordCount: number;
}

export interface SyntheticUiFixtureSuite<T> {
  readonly empty: SyntheticUiFixture<T>;
  readonly partial: SyntheticUiFixture<T>;
  readonly loaded: SyntheticUiFixture<T>;
  readonly error: SyntheticUiFixture<T>;
}

export type ThemePalette = "light" | "dark" | "high-contrast";

export interface ViewportProfile {
  readonly name: "ultrawide" | "desktop" | "tablet" | "mobile";
  readonly width: number;
  readonly height: number;
}

export interface PermutationSurface {
  readonly theme: ThemePalette;
  readonly viewport: ViewportProfile;
  readonly key: string;
}

export interface PermutationVerificationResult {
  readonly surface: PermutationSurface;
  readonly contrastRatio: number;
  readonly valid: boolean;
  readonly issues: readonly string[];
}

export interface MotionKeyframeSnapshot {
  readonly percentage: 0 | 50 | 100;
  readonly visualScore: number;
  readonly settled: boolean;
}

export interface MotionVerificationInput {
  readonly measuredFps: number;
  readonly motionLayoutShift: number;
  readonly keyframes: readonly MotionKeyframeSnapshot[];
}

export interface MotionVerificationVerdict {
  readonly valid: boolean;
  readonly phase1FpsAuditPass: boolean;
  readonly phase2KeyframePass: boolean;
  readonly measuredFps: number;
  readonly issues: readonly string[];
}

const ROLES_STR =
  "mind,coordinator,orchestrator,plan-critic,charter-critic,completeness-critic,drift-critic,concurrency-critic,anti-stagnation-critic,pareto-critic,socratic-critic,ui-validator,visual-auditor,dom-auditor,aesthetic-critic,motion-auditor,contrast-auditor,mind-auditor,skill-auditor,telemetry-auditor,test-runner-auditor,coverage-auditor,admission-critic,grant-auditor,evidence-critic,report-critic,worktree-auditor,watchdog,implementer,repairer,synthesizer";

export const ECOSYSTEM_31_ROLES: readonly string[] = ROLES_STR.split(",");

export const FORBIDDEN_QUARANTINE_TOOLS: readonly string[] =
  "view_file,grep_search,find_by_name,read_file,run_command,bash,exec,terminal".split(",");

export const THEME_PALETTES: readonly ThemePalette[] = ["light", "dark", "high-contrast"];

export const VIEWPORT_PROFILES: readonly ViewportProfile[] = [
  { name: "ultrawide", width: 1920, height: 1080 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

export function isQuarantinedOpticalValidator(role: string): boolean {
  const norm = role.toLowerCase().replace(/[_\s]+/g, "-");
  return norm.includes("visual") || norm.includes("optical") || norm === "aesthetic-critic";
}

export function validateAgentToolAccess(
  role: string,
  toolName: string,
): { readonly permitted: boolean; readonly reason?: string } {
  if (
    isQuarantinedOpticalValidator(role) &&
    FORBIDDEN_QUARANTINE_TOOLS.some((f) => toolName.toLowerCase().includes(f))
  ) {
    return {
      permitted: false,
      reason: `Quarantined optical validator '${role}' is prohibited from tool '${toolName}'`,
    };
  }
  return { permitted: true };
}

export function generateSyntheticUiFixtures<T>(
  items: readonly T[],
  errorMessage = "Controlled synthetic backend failure",
): SyntheticUiFixtureSuite<T> {
  const mid = Math.max(1, Math.min(items.length, Math.ceil(items.length / 2)));
  const make = (
    state: SyntheticUiStateKind,
    data: readonly T[],
    hasError = false,
    msg?: string,
  ): SyntheticUiFixture<T> => {
    const f = { state, data, isLoading: false, hasError, recordCount: data.length };
    return msg !== undefined ? { ...f, errorMessage: msg } : f;
  };
  return {
    empty: make("empty", []),
    partial: make("partial", items.slice(0, mid)),
    loaded: make("loaded", items),
    error: make("error", [], true, errorMessage),
  };
}

export function validateDomChannel(elements: readonly DomElementSnapshot[]): DomChannelVerdict {
  const visible = elements.filter((el) => el.visible);
  const issues: string[] = [];
  if (elements.length === 0) issues.push("DOM channel received empty element snapshot list");
  if (visible.length === 0 && elements.length > 0)
    issues.push("All elements in DOM snapshot are hidden");
  let minHitboxSatisfied = true;
  for (const el of visible) {
    const isAction =
      el.isInteractive === true ||
      ["button", "a", "input", "select", "textarea"].includes(el.tagName.toLowerCase());
    const undersized =
      el.width !== undefined && el.height !== undefined && (el.width < 44 || el.height < 44);
    if (isAction && undersized) {
      minHitboxSatisfied = false;
      issues.push(`Target <${el.tagName}> below minimum 44pt (${el.width}x${el.height})`);
    }
  }
  return {
    valid: issues.length === 0,
    elementCount: elements.length,
    visibleCount: visible.length,
    minHitboxSatisfied,
    issues,
  };
}

export function validateVisualChannel(
  contrastRatio: number,
  layoutShift: number,
  aestheticScore: number,
  heatmapDiff?: number,
): VisualChannelVerdict {
  const issues: string[] = [];
  if (contrastRatio < 4.5) issues.push("Contrast ratio below WCAG AA requirement 4.5");
  if (layoutShift > 0.1) issues.push("Cumulative layout shift exceeds allowable threshold 0.1");
  if (aestheticScore < 70) issues.push("Visual aesthetic score below threshold 70");
  if (heatmapDiff !== undefined && heatmapDiff > 0.05) {
    issues.push(`Perceptual heatmap diff ${heatmapDiff} exceeds 0.05`);
  }
  const valid = issues.length === 0;
  return heatmapDiff !== undefined
    ? { valid, contrastRatio, layoutShift, aestheticScore, heatmapDiff, issues }
    : { valid, contrastRatio, layoutShift, aestheticScore, issues };
}

export function validateDualChannel(
  elements: readonly DomElementSnapshot[],
  visual: VisualChannelInput,
): DualChannelValidationVerdict {
  const dom = validateDomChannel(elements);
  const visualVerdict = validateVisualChannel(
    visual.contrastRatio,
    visual.layoutShift,
    visual.aestheticScore,
    visual.heatmapDiff,
  );
  const compositeScore = Math.round(
    Math.min(100, Math.max(0, (dom.valid ? 50 : 0) + visualVerdict.aestheticScore / 2)),
  );
  return { valid: dom.valid && visualVerdict.valid, dom, visual: visualVerdict, compositeScore };
}

export function get31AgentEcosystem(): readonly AgentRoleDescriptor[] {
  return ECOSYSTEM_31_ROLES.map((role) => {
    if (role === "mind") return { role, tier: 0, category: "supervisor" };
    if (role === "coordinator" || role === "orchestrator")
      return { role, tier: 1, category: "supervisor" };
    if (role.includes("critic")) return { role, tier: 2, category: "critic" };
    const isSpecial = ["visual", "dom", "motion", "contrast"].some((k) => role.includes(k));
    if (role === "watchdog" || (role.includes("auditor") && !isSpecial)) {
      return { role, tier: 2, category: "auditor" };
    }
    return {
      role,
      tier: 3,
      category: role.includes("validator") || isSpecial ? "validator" : "implementer",
    };
  });
}

export function generate12PermutationSurfaces(): readonly PermutationSurface[] {
  return THEME_PALETTES.flatMap((theme) =>
    VIEWPORT_PROFILES.map((vp) => ({
      theme,
      viewport: vp,
      key: `${theme}-${vp.name}-${vp.width}x${vp.height}`,
    })),
  );
}

export function verifyThemePermutations(surfaceContrasts: Readonly<Record<string, number>>): {
  readonly totalSurfaces: number;
  readonly passedCount: number;
  readonly allPass: boolean;
  readonly results: readonly PermutationVerificationResult[];
} {
  const surfaces = generate12PermutationSurfaces();
  const results = surfaces.map((surface) => {
    const contrast = surfaceContrasts[surface.key] ?? surfaceContrasts[surface.theme] ?? 0;
    const min = surface.theme === "high-contrast" ? 7.0 : 4.5;
    const issues = contrast < min ? [`Surface '${surface.key}' contrast ${contrast} < ${min}`] : [];
    return { surface, contrastRatio: contrast, valid: issues.length === 0, issues };
  });
  const passedCount = results.filter((r) => r.valid).length;
  return {
    totalSurfaces: surfaces.length,
    passedCount,
    allPass: passedCount === surfaces.length,
    results,
  };
}

export function verifyDynamicMotion(input: MotionVerificationInput): MotionVerificationVerdict {
  const issues: string[] = [];
  const phase1FpsAuditPass = input.measuredFps >= 60 && input.motionLayoutShift <= 0.05;
  if (input.measuredFps < 60) issues.push(`Motion framerate ${input.measuredFps}fps < 60fps`);
  if (input.motionLayoutShift > 0.05) issues.push(`Layout shift ${input.motionLayoutShift} > 0.05`);
  const stages = [0, 50, 100] as const;
  const allStagesPresent = stages.every((s) => input.keyframes.some((kf) => kf.percentage === s));
  if (!allStagesPresent) {
    issues.push("Keyframe sequence must contain 0%, 50%, and 100% temporal samples");
  }
  const lowScoreKf = input.keyframes.find((kf) => kf.visualScore < 70);
  if (lowScoreKf) {
    issues.push(`Keyframe at ${lowScoreKf.percentage}% scored < 70 (${lowScoreKf.visualScore})`);
  }
  const phase2KeyframePass = allStagesPresent && lowScoreKf === undefined;
  return {
    valid: phase1FpsAuditPass && phase2KeyframePass,
    phase1FpsAuditPass,
    phase2KeyframePass,
    measuredFps: input.measuredFps,
    issues,
  };
}
