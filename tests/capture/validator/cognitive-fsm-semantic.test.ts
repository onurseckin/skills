import { describe, expect, it } from "bun:test";
import {
  COGNITIVE_BOILERPLATE,
  validateCognitive,
  validateCognitiveSemanticDepth,
  validateUiStatesFsm,
} from "../../../olt/scripts/src/capture/validator/cognitive/index.ts";
import type {
  CognitiveAnalysisReport,
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Cognitive Validators: UI States FSM, Semantic Depth & Aggregate", () => {
  describe("5 UI States FSM (ui-states-fsm.ts)", () => {
    it("returns null for non-interactive elements or elements without implementedStates", () => {
      const elPlain: ElementPhysicsSnapshot = {
        selector: "div.card",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateUiStatesFsm(elPlain, 0)).toBeNull();

      const elNoStates: ElementPhysicsSnapshot = {
        selector: "button.btn",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
      };
      expect(validateUiStatesFsm(elNoStates, 0)).toBeNull();
    });

    it("passes interactive elements implementing all 5 states (default, hover, active, focus, disabled/loading)", () => {
      const elDisabled: ElementPhysicsSnapshot = {
        selector: "button.complete-btn",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        implementedStates: ["default", "hover", "active", "focus", "disabled"],
      };
      expect(validateUiStatesFsm(elDisabled, 0)).toBeNull();

      const elLoading: ElementPhysicsSnapshot = {
        selector: "button.loading-btn",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        implementedStates: ["default", "hover", "active", "focus", "loading"],
      };
      expect(validateUiStatesFsm(elLoading, 0)).toBeNull();
    });

    it("detects missing states and returns defect", () => {
      const elMissing: ElementPhysicsSnapshot = {
        selector: "a.link-partial",
        tagName: "A",
        bounds: { x: 0, y: 0, width: 100, height: 20 },
        implementedStates: ["default", "hover"],
      };
      const defect = validateUiStatesFsm(elMissing, 1);
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("cog-ui-states-fsm-1");
      expect(defect?.severity).toBe("moderate");
      expect(defect?.message).toContain("active");
      expect(defect?.message).toContain("focus");
      expect(defect?.message).toContain("disabled");
    });
  });

  describe("Cognitive Semantic Depth Auditor (semantic-depth.ts)", () => {
    it("COGNITIVE_BOILERPLATE contains disallowed superficial phrases", () => {
      expect(COGNITIVE_BOILERPLATE.has("ok")).toBe(true);
      expect(COGNITIVE_BOILERPLATE.has("passed")).toBe(true);
      expect(COGNITIVE_BOILERPLATE.has("looks good")).toBe(true);
      expect(COGNITIVE_BOILERPLATE.has("n/a")).toBe(true);
    });

    it("rejects boilerplate and superficial observations and unevidenced answers", () => {
      const shallowReport: CognitiveAnalysisReport = {
        summary: "Superficial report",
        questionsEvaluated: 3,
        questionsPassed: 3,
        questions: [
          {
            id: "Q-1",
            category: "perception",
            question: "Test question 1",
            answered: true,
            passed: true,
            verdict: "OPTIMAL",
            observation: "ok",
            evidence: "n/a",
          },
          {
            id: "Q-2",
            category: "ergonomics",
            question: "Test question 2",
            answered: true,
            passed: true,
            verdict: "OPTIMAL",
            observation: "Too short",
            evidence: "No metrics here",
          },
        ],
      };

      const result = validateCognitiveSemanticDepth(shallowReport);
      expect(result.passed).toBe(false);
      expect(result.defects.length).toBeGreaterThan(0);
      expect(result.superficialCount).toBe(2);
      expect(result.deepCount).toBe(0);
      expect(result.averageScore).toBeLessThan(0.5);
    });

    it("certifies thorough, metric-rich cognitive reports", () => {
      const deepReport: CognitiveAnalysisReport = {
        summary: "Deep report",
        questionsEvaluated: 1,
        questionsPassed: 1,
        questions: [
          {
            id: "Q-PERC-01",
            category: "perception",
            question: "Visual anchor question",
            answered: true,
            passed: true,
            verdict: "OPTIMAL",
            observation:
              "Primary headline established with high perceptual dominance and 32px font size.",
            evidence: "Measured 32px font-size and 700 font-weight spanning 48px height.",
          },
        ],
      };

      const result = validateCognitiveSemanticDepth(deepReport);
      expect(result.passed).toBe(true);
      expect(result.defects.length).toBe(0);
      expect(result.deepCount).toBe(1);
      expect(result.averageScore).toBe(1.0);
    });

    it("handles empty questions list cleanly", () => {
      const emptyReport: CognitiveAnalysisReport = {
        summary: "Empty",
        questionsEvaluated: 0,
        questionsPassed: 0,
        questions: [],
      };
      const result = validateCognitiveSemanticDepth(emptyReport);
      expect(result.passed).toBe(false);
      expect(result.evaluatedCount).toBe(0);
      expect(result.averageScore).toBe(0);
    });
  });

  describe("Cognitive Aggregate (validateCognitive)", () => {
    it("evaluates empty elements list cleanly", () => {
      const ctx: ValidationContext = {
        screenId: "test_cog",
        viewport: "desktop",
        elements: [],
      };
      const res = validateCognitive(ctx);
      expect(res.pillar).toBe("cognitive");
      expect(res.passed).toBe(true);
      expect(res.defects.length).toBe(0);
      expect(res.evaluatedCount).toBe(0);
    });

    it("handles undefined slots and aggregates defects across all cognitive categories", () => {
      const elements: (ElementPhysicsSnapshot | undefined)[] = [
        undefined,
        {
          selector: "nav.crowded-nav",
          tagName: "NAV",
          bounds: { x: 0, y: 0, width: 200, height: 400 },
          children: Array.from({ length: 8 }, (_, i) => ({
            selector: `a.item-${i}`,
            tagName: "A",
            bounds: { x: 0, y: i * 30, width: 100, height: 30 },
          })),
        },
        {
          selector: "button.tiny-far",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 2, y: 2, width: 10, height: 10 },
        },
        {
          selector: "select.huge-select",
          tagName: "SELECT",
          bounds: { x: 0, y: 0, width: 200, height: 40 },
          children: Array.from({ length: 12 }, (_, i) => ({
            selector: `option.opt-${i}`,
            tagName: "OPTION",
            bounds: { x: 0, y: i * 20, width: 100, height: 20 },
          })),
        },
        {
          selector: "button.delete-all",
          tagName: "BUTTON",
          text: "Delete All Records",
          bounds: { x: 0, y: 0, width: 150, height: 40 },
        },
        {
          selector: "button.incomplete-fsm",
          tagName: "BUTTON",
          bounds: { x: 0, y: 0, width: 100, height: 40 },
          implementedStates: ["default"],
        },
      ];

      const ctx: ValidationContext = {
        screenId: "cog_screen",
        viewport: "desktop",
        elements: elements as unknown as ElementPhysicsSnapshot[],
      };

      const res = validateCognitive(ctx);
      expect(res.pillar).toBe("cognitive");
      expect(res.passed).toBe(false);
      expect(res.evaluatedCount).toBe(elements.length);
      expect(res.defects.length).toBe(5);

      const categories = res.defects.map((d) => d.category);
      expect(categories).toContain("cowan-chunking");
      expect(categories).toContain("fitts-law");
      expect(categories).toContain("hick-hyman");
      expect(categories).toContain("norman-grace");
      expect(categories).toContain("ui-states-fsm");
    });
  });
});
