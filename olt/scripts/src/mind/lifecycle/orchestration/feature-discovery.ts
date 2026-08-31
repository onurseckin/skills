import type { DetectedRepositoryStructure } from "../../tasks/smart/executor/evolution/self-evolution.ts";
import type { GroundedFeatureProposal } from "./types.ts";

export function discoverGroundedFeatures(
  structure: DetectedRepositoryStructure,
  charterGoals?: readonly string[] | undefined,
  maxProposals = 5,
): readonly GroundedFeatureProposal[] {
  const proposals: GroundedFeatureProposal[] = [];
  const goals = charterGoals && charterGoals.length > 0 ? charterGoals : ["G1", "G2", "G3"];

  // Step 1: Baseline Quality & Invariant Hygiene
  const testDir = structure.hasTests ? `${structure.tests[0] ?? "tests"}/` : "tests/";
  proposals.push({
    id: "prop-step-1-invariant-hygiene",
    title: "Baseline Quality & Invariant Hygiene Assurance",
    statement:
      "Enforce 0 any, 0 compiler/linter suppressions, and 100% strict TypeScript types across all source and test modules.",
    charterGoals: [goals[0] ?? "G1"],

    writeScope: [testDir],
    gate: structure.hasTests
      ? `bun test ${structure.tests[0]} && bun run typecheck`
      : "bun test tests/unit && bun run typecheck",
    acceptanceCriteria: [
      "0 TypeScript any annotations across all files",
      "0 linter or compiler suppressions",
      "All unit test suites pass cleanly with exit code 0",
    ],
    priority: "HIGH",
    rationale:
      "Step 1 Baseline Quality: Continuous type soundness and regression immunity under charter goal G1.",
    step: "step_1_baseline_quality",
    estimatedEffort: 3,
    dependencies: [],
  });

  // Step 2: Product & UX Quality Audit
  const clientScope: string[] = [];
  if (structure.hasApps) {
    clientScope.push(structure.apps[0] ? `${structure.apps[0]}/` : "apps/");
  } else if (structure.hasPackages) {
    clientScope.push(structure.packages[0] ? `${structure.packages[0]}/` : "packages/");
  } else if (structure.hasSrc) {
    clientScope.push(structure.src[0] ? `${structure.src[0]}/` : "src/");
  } else {
    clientScope.push("apps/");
  }

  proposals.push({
    id: "prop-step-2-product-ux-perfection",
    title: "Product & UX Quality Perfection across Multi-Tier Viewports",
    statement:
      "Inspect screens, responsive tiers (desktop, tablet, mobile), optical rhythm, APCA contrast ratios, and runtime interaction latency.",
    charterGoals: [goals[1] ?? "G2"],
    writeScope: clientScope,
    gate: structure.hasTests
      ? `bun test ${structure.tests[0]} && bun run typecheck`
      : "bun test && bun run typecheck",
    acceptanceCriteria: [
      "Audit responsive layout balance and optical spacing across client surfaces",
      "Verify APCA lightness contrast (Lc >= 60) and ergonomic touch targets (>= 44x44px)",
      "Catalog UI/UX polish improvements and interaction smoothness",
    ],
    priority: "HIGH",
    rationale:
      "Step 2 Product & UX Quality: Multi-viewport visual verification and interface ergonomics under charter goal G2.",
    step: "step_2_product_ux_audit",
    estimatedEffort: 3,
    dependencies: ["prop-step-1-invariant-hygiene"],
  });

  // Step 3: Autonomous Creative Ideation
  proposals.push({
    id: "prop-step-3-creative-roadmap-ideation",
    title: "Autonomous Creative Ideation & Feature Roadmap Authoring",
    statement:
      "Conceive high-leverage forward-looking features, radical first-principles simplifications, and author structured PLAN.md roadmaps in docs/planning/.",
    charterGoals: [goals[2] ?? "G3"],
    writeScope: ["docs/planning/PLAN.md", "docs/planning/"],
    gate: structure.hasTests
      ? `bun test ${structure.tests[0]} && bun run typecheck`
      : "bun test && bun run typecheck",
    acceptanceCriteria: [
      "Conceive ambitious product features and toolchain expansions from first principles",
      "Author structured PLAN.md roadmap in docs/planning/ with architecture, milestones, and gates",
      "Align feature proposals with strategic charter goals without idle standby",
    ],
    priority: "MEDIUM",
    rationale:
      "Step 3 Autonomous Creative Ideation: First-principles product manager innovation under charter goal G3.",
    step: "step_3_creative_ideation",
    estimatedEffort: 3,
    dependencies: ["prop-step-2-product-ux-perfection"],
  });

  return proposals.slice(0, maxProposals);
}
