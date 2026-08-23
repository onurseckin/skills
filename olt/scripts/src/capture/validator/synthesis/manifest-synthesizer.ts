import type {
  CodeRemediation,
  CompanionManifestV2,
  EvaluatedCriterion,
  PillarValidationResult,
  ValidationContext,
  ValidationDefect,
  ValidationPillar,
  ValidationVerdict,
} from "../types.ts";
import { validateMechanical } from "../mechanical/index.ts";
import { evaluateCognitiveQuestions, validateCognitive } from "../cognitive/index.ts";
import { validateCustom } from "../custom/index.ts";

function buildEvaluatedCriteria(
  ctx: ValidationContext,
  mechanicalResult: PillarValidationResult,
  cognitiveResult: PillarValidationResult,
  customResult: PillarValidationResult,
): EvaluatedCriterion[] {
  const criteria: EvaluatedCriterion[] = [];
  const elCount = ctx.elements.length;

  const defMech = (cat: string) => mechanicalResult.defects.filter((d) => d.category === cat);
  const defCogn = (cat: string) => cognitiveResult.defects.filter((d) => d.category === cat);
  const defCust = (cat: string) => customResult.defects.filter((d) => d.category === cat);

  const makeCrit = (
    id: string,
    pillar: ValidationPillar,
    name: string,
    defects: ValidationDefect[],
    specDescription: string,
  ): EvaluatedCriterion => {
    const passed = defects.length === 0;
    const details = passed
      ? `Criterion passed: ${specDescription} (${elCount} elements evaluated).`
      : `Criterion failed: ${defects.map((d) => d.message).join("; ")}`;
    const evidence = passed
      ? `Evaluated ${elCount} element snapshots in viewport '${ctx.viewport}' with 0 violations.`
      : `Detected ${defects.length} violation(s): ${defects.map((d) => `[${d.severity}] ${d.elementSelector ? d.elementSelector : "element"}: ${d.message}`).join("; ")}`;
    return { id, pillar, name, passed, details, evidence };
  };

  // 1. Mechanical Criteria (CRIT-MECH-*)
  criteria.push(
    makeCrit(
      "CRIT-MECH-APCA",
      "mechanical",
      "APCA Perceived Contrast Compliance",
      defMech("apca-contrast"),
      "All text elements meet APCA Lc lightness contrast thresholds based on font size and weight",
    ),
    makeCrit(
      "CRIT-MECH-TOUCH-TARGET",
      "mechanical",
      "Touch Target Dimensions & Clearance",
      defMech("touch-target"),
      "Interactive targets maintain minimum 44x44px dimensions and 24px circular clearance",
    ),
    makeCrit(
      "CRIT-MECH-CONCENTRIC-RADIUS",
      "mechanical",
      "Concentric Corner Radii Alignment",
      defMech("concentric-radius"),
      "Nested elements maintain concentric outer/inner radius alignment (R_outer = R_inner + padding)",
    ),
    makeCrit(
      "CRIT-MECH-SUBPIXEL",
      "mechanical",
      "Subpixel Grid Snapping",
      defMech("subpixel-snapping"),
      "Layout elements align cleanly to integer physical device pixels without fractional subpixel blur",
    ),
    makeCrit(
      "CRIT-MECH-CLS",
      "mechanical",
      "Cumulative Layout Shift Space Reservation",
      defMech("cls-reservation"),
      "Images, videos, and media reserve explicit width/height dimensions or aspect-ratio boxes",
    ),
    makeCrit(
      "CRIT-MECH-SIDEBAR",
      "mechanical",
      "Sidebar Layout & Zero-Navbar Topology",
      defMech("sidebar-layout"),
      "Sidebar conforms to specified top-left/bottom-left geometry and eliminates duplicate top navbars",
    ),
  );

  // 2. Cognitive Criteria (CRIT-COGN-*)
  criteria.push(
    makeCrit(
      "CRIT-COGN-COWAN",
      "cognitive",
      "Cowan Working Memory 4±1 Chunking",
      defCogn("cowan-chunking"),
      "Information architecture groups related items within Nelson Cowan's 4±1 working memory capacity",
    ),
    makeCrit(
      "CRIT-COGN-FITTS",
      "cognitive",
      "Fitts's Law Index of Difficulty Bounds",
      defCogn("fitts-law"),
      "Primary call-to-action targets maintain low Index of Difficulty ID = log2(2D/W) <= 5.5",
    ),
    makeCrit(
      "CRIT-COGN-HICK",
      "cognitive",
      "Hick-Hyman Decision Entropy",
      defCogn("hick-hyman"),
      "Decision branching depth and choice lists avoid excessive cognitive decision fatigue",
    ),
    makeCrit(
      "CRIT-COGN-NORMAN",
      "cognitive",
      "Don Norman Error Recovery Grace Periods",
      defCogn("norman-recovery"),
      "Destructive actions provide confirmation dialogs, undo grace periods, or safe recovery paths",
    ),
    makeCrit(
      "CRIT-COGN-STATES",
      "cognitive",
      "Interactive UI States FSM Completeness",
      defCogn("ui-states-fsm"),
      "Interactive controls define default, hover, active, focus, and disabled/loading visual states",
    ),
  );

  // 3. Product Heuristics (CRIT-PROD-* / CRIT-CUST-*)
  criteria.push(
    makeCrit(
      "CRIT-PROD-GEIST-TOKENS",
      "product",
      "Design System Token Conformance",
      defCust("geist-tokens"),
      "Typography, spacing, borders, and shadows adhere to design system token scales",
    ),
    makeCrit(
      "CRIT-PROD-OPTICAL-TRACKING",
      "product",
      "Optical Tracking & Typography Curves",
      defCust("apple-optical-tracking"),
      "Font letter-spacing dynamically tightens for large display headers per optical tracking curves",
    ),
  );

  // 4. UX Ergonomics (CRIT-UX-*)
  criteria.push(
    makeCrit(
      "CRIT-UX-FOCUS-TRAP",
      "ux",
      "WAI-ARIA Focus Trap & Roving Tabindex",
      defCust("wai-aria-focus-trap"),
      "Modal dialogs and menus constrain keyboard focus cycling and support roving tabindex",
    ),
    makeCrit(
      "CRIT-UX-FLOATING-COLLISION",
      "ux",
      "Floating UI Collision & Boundary Containment",
      defCust("floating-ui-collision"),
      "Dropdowns, tooltips, and popovers maintain collision clearance within viewport boundaries",
    ),
    makeCrit(
      "CRIT-UX-STATE-LAYERS",
      "ux",
      "Material Interactive State Layers",
      defCust("material-state-layers"),
      "Interactive surface feedback uses calibrated opacity state layer overlays",
    ),
  );

  return criteria;
}

export function synthesizeCompanionManifest(ctx: ValidationContext): CompanionManifestV2 {
  const mechanicalResult = validateMechanical(ctx);
  const cognitiveResult = validateCognitive(ctx);
  const customResult = validateCustom(ctx);

  const prodDefects = [
    ...customResult.defects.filter((d) => d.category === "geist-tokens"),
    ...customResult.defects.filter((d) => d.category === "apple-optical-tracking"),
  ];
  const uxDefects = [
    ...customResult.defects.filter((d) => d.category === "wai-aria-focus-trap"),
    ...customResult.defects.filter((d) => d.category === "floating-ui-collision"),
    ...customResult.defects.filter((d) => d.category === "material-state-layers"),
  ];

  const productResult: PillarValidationResult = {
    pillar: "product",
    passed: prodDefects.length === 0,
    defects: prodDefects,
    evaluatedCount: ctx.elements.length,
  };

  const uxResult: PillarValidationResult = {
    pillar: "ux",
    passed: uxDefects.length === 0,
    defects: uxDefects,
    evaluatedCount: ctx.elements.length,
  };

  const allDefects: readonly ValidationDefect[] = [
    ...mechanicalResult.defects,
    ...cognitiveResult.defects,
    ...customResult.defects,
  ];

  let criticalCount = 0;
  let seriousCount = 0;
  let moderateCount = 0;
  let minorCount = 0;

  for (const defect of allDefects) {
    if (defect.severity === "critical") criticalCount++;
    else if (defect.severity === "serious") seriousCount++;
    else if (defect.severity === "moderate") moderateCount++;
    else if (defect.severity === "minor") minorCount++;
  }

  const totalDefects = allDefects.length;
  const verdict: ValidationVerdict = totalDefects === 0 ? "CERTIFIED" : "DEFECTS_FOUND";

  // Collect unique remediations across all defects
  const remediationSummaryMap = new Map<string, CodeRemediation>();
  for (const defect of allDefects) {
    for (const rem of defect.remediations) {
      const key = `${defect.category}-${rem.framework}`;
      if (!remediationSummaryMap.has(key)) {
        remediationSummaryMap.set(key, rem);
      }
    }
  }

  const criteria = buildEvaluatedCriteria(ctx, mechanicalResult, cognitiveResult, customResult);
  const cognitiveAnalysis = evaluateCognitiveQuestions({ context: ctx, elements: ctx.elements });

  return {
    version: "2.0",
    screenId: ctx.screenId,
    viewport: ctx.viewport,
    timestamp: new Date().toISOString(),
    verdict,
    totalDefects,
    criticalCount,
    seriousCount,
    moderateCount,
    minorCount,
    criteria,
    cognitiveAnalysis,
    pillars: {
      mechanical: mechanicalResult,
      cognitive: cognitiveResult,
      custom: customResult,
      product: productResult,
      ux: uxResult,
    },
    allDefects,
    remediationSummary: Array.from(remediationSummaryMap.values()),
  };
}

export function isCertifiedManifest(manifest: CompanionManifestV2): boolean {
  return manifest.verdict === "CERTIFIED" && manifest.totalDefects === 0;
}
