import { describe, expect, it, test } from "bun:test";
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

describe("Companion Manifest 4-Pillar Criteria Enforcement", () => {
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

  it("validates a compliant companion manifest covering all 4 mandatory pillars", () => {
    const manifest = {
      schema: "companion.manifest.v1",
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "All text elements meet APCA Lc lightness contrast thresholds.",
          evidence: "Evaluated 25 text nodes with 0 violations.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          name: "Fitts's Law Target Acquisition",
          passed: true,
          details: "Primary call to action targets maintain ID <= 5.5.",
          evidence: "Average target acquisition ID = 3.2.",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Design System Tokens",
          passed: true,
          details: "Typography, spacing, and borders adhere to token scales.",
          evidence: "Validated 42 token usages.",
        },
        {
          id: "CRIT-UX-FOCUS-TRAP",
          pillar: "ux",
          name: "WAI-ARIA Focus Trap",
          passed: true,
          details: "Modal and dialog containers constrain tab cycle traversal.",
          evidence: "Verified keyboard navigation focus cycling.",
        },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(true);
    expect(outcome.evaluatedCriteriaCount).toBe(4);
    expect(outcome.passedCriteriaCount).toBe(4);
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
  });

  it("rejects companion manifest if any of the 4 mandatory pillars is missing", () => {
    const manifestMissingUx = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-PROD-GEIST",
          pillar: "product",
          passed: true,
          details: "Pass",
          evidence: "Evidence",
        },
        // UX Ergonomics pillar missing!
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifestMissingUx, addFinding);

    expect(outcome.valid).toBe(false);
    const pillarErrors = findings.filter((f) => f.category === "missing_pillar_criteria");
    expect(pillarErrors.length).toBeGreaterThanOrEqual(1);
    expect(pillarErrors.some((f) => f.message.includes("UX Ergonomics"))).toBe(true);
  });

  it("rejects criteria missing explicit boolean passed property", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          // missing passed!
          details: "Pass",
          evidence: "Evidence",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const critErrors = findings.filter((f) => f.category === "invalid_manifest_criterion");
    expect(critErrors.some((f) => f.message.includes("Missing explicit boolean 'passed'"))).toBe(
      true,
    );
  });

  it("rejects criteria with empty details and empty evidence", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        { id: "CRIT-MECH-APCA", pillar: "mechanical", passed: true, details: "", evidence: "   " },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const critErrors = findings.filter((f) => f.category === "invalid_manifest_criterion");
    expect(critErrors.some((f) => f.message.includes("non-empty 'details' or 'evidence'"))).toBe(
      true,
    );
  });

  it("rejects manifest if any criterion failed (passed: false)", () => {
    const manifest = {
      screenId: "dashboard",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: false,
          details: "APCA contrast Lc=38.2 below required threshold 60.0",
          evidence: "Contrast failure on selector .btn-secondary",
        },
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Pass",
          evidence: "Ev",
        },
        { id: "CRIT-PROD-GEIST", pillar: "product", passed: true, details: "Pass", evidence: "Ev" },
        { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Pass", evidence: "Ev" },
      ],
    };

    const { findings, addFinding } = findingsCollector();
    const outcome = validateCompanionManifestCriteria(manifest, addFinding);

    expect(outcome.valid).toBe(false);
    const failedErrors = findings.filter((f) => f.category === "manifest_criterion_failed");
    expect(failedErrors).toHaveLength(1);
    expect(failedErrors[0]?.message).toContain("CRIT-MECH-APCA");
  });
});
