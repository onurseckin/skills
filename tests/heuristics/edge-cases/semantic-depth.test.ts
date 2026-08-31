/**
 * @file semantic-depth.test.ts
 * Modular unit tests for Semantic Depth & Anti-Boilerplate Heuristics
 */

import { describe, expect, it } from "bun:test";
import {
  auditCriterionSemanticDepth,
  auditManifestSemanticDepth,
} from "../../../olt/scripts/src/heuristics/multi-viewport-manifest/index.ts";
import {
  evaluateCognitiveQuestions,
  validateCognitiveSemanticDepth,
} from "../../../olt/scripts/src/capture/validator/cognitive/cognitive-questions/index.ts";
import type {
  ElementPhysicsSnapshot,
  EvaluatedCriterion,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Extended Heuristics: Semantic Depth & Anti-Boilerplate Verification", () => {
  it("certifies high-depth semantic criterion with quantitative metrics and qualitative explanation", () => {
    const deepCriterion: EvaluatedCriterion = {
      id: "CRIT-MECH-APCA",
      pillar: "mechanical",
      name: "APCA Lightness Contrast",
      passed: true,
      details:
        "All heading and body elements satisfy APCA Lc lightness contrast thresholds based on font size and weight.",
      evidence:
        "Evaluated 28 text elements in viewport 'desktop' with 0 contrast violations; lowest measured Lc was 78.4 (required: 60).",
    };

    const depthResult = auditCriterionSemanticDepth(deepCriterion);
    expect(depthResult.isDeep).toBe(true);
    expect(depthResult.combinedDepthScore).toBeGreaterThanOrEqual(0.7);
    expect(depthResult.defects.length).toBe(0);
    expect(depthResult.metricsFound.length).toBeGreaterThanOrEqual(2);
  });

  it("flags and rejects superficial boilerplate details ('ok', 'pass', 'looks good', 'n/a', 'checked', 'none')", () => {
    const boilerplateSamples = [
      "ok",
      "pass",
      "passed",
      "true",
      "yes",
      "n/a",
      "none",
      "looks good",
      "test passed",
      "checked",
      "valid",
      "all good",
      "placeholder",
      "tbd",
    ];

    for (const bp of boilerplateSamples) {
      const criterion = {
        id: "CRIT-TEST-BP",
        pillar: "cognitive",
        details: bp,
        evidence: "Evaluated 10 elements in mobile viewport with 0 errors.",
      };

      const depthResult = auditCriterionSemanticDepth(criterion);
      expect(depthResult.isDeep).toBe(false);
      expect(depthResult.defects.some((d) => d.category === "boilerplate_evidence")).toBe(true);
    }
  });

  it("flags and rejects superficial boilerplate evidence (< 12 chars, 'all good', 'as expected')", () => {
    const badEvidenceSamples = [
      "",
      "   ",
      "ok",
      "all good",
      "done",
      "as expected",
      "fine",
      "looks fine",
    ];

    for (const ev of badEvidenceSamples) {
      const criterion = {
        id: "CRIT-TEST-EV",
        pillar: "product",
        details: "Detailed explanation of design tokens adhering to 8pt spatial grid.",
        evidence: ev,
      };

      const depthResult = auditCriterionSemanticDepth(criterion);
      expect(depthResult.isDeep).toBe(false);
      expect(depthResult.defects.length).toBeGreaterThan(0);
    }
  });

  it("flags evidence missing empirical quantitative measurements or counts", () => {
    const ungroundedCriterion = {
      id: "CRIT-NO-METRICS",
      pillar: "ux",
      details: "Modal focus trap is properly implemented without focus escape.",
      evidence: "Everything appears properly aligned and working.",
    };

    const depthResult = auditCriterionSemanticDepth(ungroundedCriterion);
    expect(
      depthResult.defects.some(
        (d) => d.category === "missing_evidence_metrics" || d.category === "superficial_evidence",
      ),
    ).toBe(true);
  });

  it("audits manifest-level semantic depth across multi-pillar criteria", () => {
    const richManifest = {
      version: "2.0",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          passed: true,
          details:
            "All text elements meet APCA Lc lightness contrast thresholds based on font size and weight.",
          evidence: "Evaluated 18 element snapshots in viewport 'desktop' with 0 violations.",
        },
        {
          id: "CRIT-COGN-FITTS",
          pillar: "cognitive",
          passed: true,
          details: "Primary call-to-action targets maintain low Index of Difficulty ID <= 5.5.",
          evidence: "Evaluated 6 interactive targets with minimum width of 48px and ID of 3.2.",
        },
        {
          id: "CRIT-PROD-TOKENS",
          pillar: "product",
          passed: true,
          details:
            "Typography, spacing, borders, and shadows adhere to design system token scales.",
          evidence: "Evaluated 24 container surfaces conforming to 8pt spatial grid rhythm.",
        },
        {
          id: "CRIT-UX-FOCUS",
          pillar: "ux",
          passed: true,
          details:
            "Modal dialogs and menus constrain keyboard focus cycling and support roving tabindex.",
          evidence: "Verified 4 focusable controls trapped inside modal with 0 leakage.",
        },
      ],
    };

    const manifestDepth = auditManifestSemanticDepth(richManifest);
    expect(manifestDepth.passed).toBe(true);
    expect(manifestDepth.evaluatedCount).toBe(4);
    expect(manifestDepth.deepCount).toBe(4);
    expect(manifestDepth.averageDepthScore).toBeGreaterThanOrEqual(0.7);
    expect(manifestDepth.defects.length).toBe(0);
  });

  it("evaluates all 12 cognitive questions in CognitiveAnalysisReport using validateCognitiveSemanticDepth", () => {
    const sampleElements: ElementPhysicsSnapshot[] = [
      {
        selector: "h1.title",
        tagName: "H1",
        text: "VIP Dispatch Center",
        bounds: { x: 40, y: 40, width: 400, height: 48 },
        computedStyles: {
          fontSize: 32,
          fontWeight: 700,
          color: "#ffffff",
          backgroundColor: "#000000",
        },
      },
      {
        selector: "button.dispatch-btn",
        tagName: "BUTTON",
        text: "Launch Dispatch",
        interactive: true,
        isTouchTarget: true,
        bounds: { x: 40, y: 500, width: 200, height: 48 },
        computedStyles: { fontSize: 16, fontWeight: 600, padding: 16 },
        implementedStates: ["default", "hover", "active", "focus"],
      },
      {
        selector: "span.badge-status",
        tagName: "SPAN",
        text: "LIVE TELEMETRY ONLINE",
        bounds: { x: 500, y: 40, width: 160, height: 28 },
      },
    ];

    const context: ValidationContext = {
      screenId: "dispatch_center",
      viewport: "desktop",
      elements: sampleElements,
      viewportBounds: { width: 1440, height: 900 },
    };

    const report = evaluateCognitiveQuestions({ context, elements: sampleElements });
    expect(report.questions.length).toBe(12);

    const depthAudit = validateCognitiveSemanticDepth(report);
    expect(depthAudit.passed).toBe(true);
    expect(depthAudit.evaluatedCount).toBe(12);
    expect(depthAudit.deepCount).toBe(12);
    expect(depthAudit.superficialCount).toBe(0);
    expect(depthAudit.averageScore).toBe(1.0);
    expect(depthAudit.defects.length).toBe(0);
  });

  it("rejects artificially injected superficial cognitive observations or unevidenced cognitive answers", () => {
    const superficialReport = {
      summary: "Evaluated 2 questions.",
      questionsEvaluated: 2,
      questionsPassed: 2,
      questions: [
        {
          id: "Q-PERC-01-JTBD-ANCHOR",
          category: "perception" as const,
          question: "Does the screen present a clear dominant visual anchor?",
          answered: true,
          passed: true,
          verdict: "OPTIMAL" as const,
          observation: "Looks good",
          evidence: "None",
        },
        {
          id: "Q-ERGO-02-FITTS-ACQUISITION",
          category: "ergonomics" as const,
          question: "Do interactive targets maintain low acquisition difficulty?",
          answered: true,
          passed: true,
          verdict: "OPTIMAL" as const,
          observation: "Short",
          evidence: "Pass",
        },
      ],
    };

    const depthAudit = validateCognitiveSemanticDepth(superficialReport);
    expect(depthAudit.passed).toBe(false);
    expect(depthAudit.defects.length).toBeGreaterThanOrEqual(3);
    expect(depthAudit.deepCount).toBe(0);
  });
});
