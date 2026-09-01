import { describe, expect, it } from "bun:test";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  isUiScope,
  validateCompanionManifestCriteria,
  type DualChannelInput,
  type ScreenshotMetadata,
  type StructuredFinding,
  type VisualMetricsReport,
} from "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";

describe("Semantic Depth Quality Checks & requireSemanticDepth Enforcement", () => {
  const findingsCollector = () => {
    const findings: StructuredFinding[] = [];
    const addFinding = (
      category: StructuredFinding["category"],
      severity: StructuredFinding["severity"],
      message: string,
      remediation: string,
      affectedSelector?: string,
      viewport?: string,
    ) => {
      findings.push({
        id: `VF-${findings.length + 1}`,
        category,
        severity,
        message,
        remediation,
        ...(affectedSelector !== undefined ? { affectedSelector } : {}),
        ...(viewport !== undefined ? { viewport } : {}),
      });
    };
    return { findings, addFinding };
  };

  it("detects boilerplate details and superficial evidence under requireSemanticDepth", () => {
    const manifest = {
      screenId: "checkout",
      viewport: "mobile",
      criteria: [
        {
          id: "CRIT-MECH-OVERFLOW",
          pillar: "mechanical",
          passed: true,
          details: "ok", // boilerplate
          evidence: "375px width verified without horizontal scroll",
        },
        {
          id: "CRIT-COGN-THUMB",
          pillar: "cognitive",
          passed: true,
          details: "Thumb zone", // < 12 characters (superficial)
          evidence: "passed", // boilerplate
        },
        {
          id: "CRIT-PROD-BRAND",
          pillar: "product",
          passed: true,
          details: "Verified brand color palette tokens",
          evidence: "Looks good to reviewer", // missing quantitative metric numbers
        },
        {
          id: "CRIT-UX-CONTRAST",
          pillar: "ux",
          passed: true,
          details: "Evaluated interactive button states",
          evidence: "4.5:1 ratio", // valid with quantitative metric
        },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding, {
      requireSemanticDepth: true,
    });

    expect(outcome.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("CRIT-MECH-OVERFLOW"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "superficial_evidence" && f.message.includes("CRIT-COGN-THUMB"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("CRIT-COGN-THUMB"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "missing_evidence_metrics" && f.message.includes("CRIT-PROD-BRAND"),
      ),
    ).toBe(true);
  });

  it("validates cognitiveAnalysis.questions for superficial rationale and missing metrics", () => {
    const manifest = {
      screenId: "settings",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details: "APCA lightness contrast exceeds required Lc thresholds.",
          evidence: "Evaluated 12 text surfaces; min Lc = 78.4.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          passed: true,
          details: "Fitts Law index of difficulty complies with target bounds.",
          evidence: "Evaluated 8 buttons; min size = 48x48px.",
        },
        {
          id: "CRIT-PROD-DESIGN",
          pillar: "product",
          passed: true,
          details: "Design system spacing tokens conform to 8pt spatial grid.",
          evidence: "100% of padding uses 8px/16px/24px steps.",
        },
        {
          id: "CRIT-UX-KEYBOARD",
          pillar: "ux",
          passed: true,
          details: "Keyboard accessibility preserves visible focus rings.",
          evidence: "Tab index traversal verified across 15 interactive elements.",
        },
      ],
      cognitiveAnalysis: {
        questions: [
          {
            id: "Q-PERC-01-JTBD-ANCHOR",
            passed: true,
            observation: "Good anchor", // < 12 characters -> superficial_evidence
            evidence: "1 headline element detected with font-size 28px.",
          },
          {
            id: "Q-ERGO-02-FITTS",
            passed: true,
            observation: "Interactive targets maintain comfortable touch floor above 44px.",
            evidence: "checked", // boilerplate evidence
          },
          {
            id: "Q-TYPO-01-CONTRAST",
            passed: true,
            observation: "ok", // boilerplate observation
            evidence: "All text elements pass with 100% compliance.",
          },
          {
            id: "Q-RESI-01-STATES",
            passed: true,
            observation: "Interactive state transitions provide immediate tactile visual response.",
            evidence: "No issues with state transitions", // missing metrics
          },
        ],
      },
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding, {
      requireSemanticDepth: true,
    });

    expect(outcome.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "superficial_evidence" && f.message.includes("Q-PERC-01-JTBD-ANCHOR"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("Q-ERGO-02-FITTS"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "boilerplate_evidence" && f.message.includes("Q-TYPO-01-CONTRAST"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.category === "missing_evidence_metrics" && f.message.includes("Q-RESI-01-STATES"),
      ),
    ).toBe(true);
  });
});
