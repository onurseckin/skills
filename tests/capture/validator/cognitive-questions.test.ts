import { describe, expect, it } from "bun:test";
import { evaluateCognitiveQuestions } from "../../../olt/scripts/src/capture/validator/cognitive/cognitive-questions/index.ts";
import type {
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../olt/scripts/src/capture/validator/types.ts";

describe("Cognitive Questions & Answers Evaluation Engine", () => {
  const sampleElements: ElementPhysicsSnapshot[] = [
    {
      selector: "h1.title",
      tagName: "H1",
      text: "VIP Reservation Studio",
      bounds: { x: 40, y: 40, width: 400, height: 48 },
      computedStyles: {
        fontSize: 32,
        fontWeight: 700,
        color: "#ffffff",
        backgroundColor: "#0a0a0a",
      },
    },
    {
      selector: "div.card-booking",
      tagName: "DIV",
      bounds: { x: 40, y: 120, width: 600, height: 300 },
      computedStyles: {
        borderRadius: 12,
        padding: 24,
        backgroundColor: "#171717",
      },
    },
    {
      selector: "button.confirm-booking",
      tagName: "BUTTON",
      text: "Confirm Reservation",
      interactive: true,
      isTouchTarget: true,
      bounds: { x: 40, y: 460, width: 220, height: 48 },
      computedStyles: {
        fontSize: 16,
        fontWeight: 600,
        color: "#000000",
        backgroundColor: "#d4af37",
        borderRadius: 8,
        padding: 12,
      },
      implementedStates: ["default", "hover", "active", "focus"],
    },
    {
      selector: "span.badge-status",
      tagName: "SPAN",
      text: "LIVE DISPATCH CONNECTED",
      bounds: { x: 500, y: 40, width: 140, height: 28 },
      computedStyles: {
        fontSize: 12,
        fontWeight: 600,
        color: "#10b981",
        backgroundColor: "#064e3b",
      },
    },
  ];

  const context: ValidationContext = {
    screenId: "customer_booking",
    viewport: "desktop",
    elements: sampleElements,
    viewportBounds: { width: 1440, height: 900 },
  };

  it("evaluates all 12 mandatory cognitive & ergonomic questions", () => {
    const report = evaluateCognitiveQuestions({ context, elements: sampleElements });

    expect(report.questionsEvaluated).toBe(12);
    expect(report.questions.length).toBe(12);
    expect(report.questionsPassed).toBe(12);
    expect(report.summary).toContain("12/12");

    const ids = report.questions.map((q) => q.id);
    expect(ids).toContain("Q-PERC-01-JTBD-ANCHOR");
    expect(ids).toContain("Q-PERC-02-COWAN-CHUNKS");
    expect(ids).toContain("Q-PERC-03-SCAN-PATH");
    expect(ids).toContain("Q-ERGO-01-THUMB-ZONE");
    expect(ids).toContain("Q-ERGO-02-FITTS-ACQUISITION");
    expect(ids).toContain("Q-ERGO-03-SAFE-FLOOR");
    expect(ids).toContain("Q-TYPO-01-CONTRAST");
    expect(ids).toContain("Q-TYPO-02-SPATIAL-GRID");
    expect(ids).toContain("Q-TYPO-03-OPTICAL-TRACKING");
    expect(ids).toContain("Q-RESI-01-FIVE-STATES");
    expect(ids).toContain("Q-RESI-02-DESTRUCTIVE-SAFETY");
    expect(ids).toContain("Q-JTBD-01-TELEMETRY-HEARTBEAT");
  });

  it("identifies JTBD headline focal point with font size metrics", () => {
    const report = evaluateCognitiveQuestions({ context, elements: sampleElements });
    const q1 = report.questions.find((q) => q.id === "Q-PERC-01-JTBD-ANCHOR")!;

    expect(q1.answered).toBe(true);
    expect(q1.passed).toBe(true);
    expect(q1.verdict).toBe("OPTIMAL");
    expect(q1.observation).toContain("VIP Reservation Studio");
    expect(q1.observation).toContain("32px");
  });

  it("flags sub-44px targets in Fitts acquisition question", () => {
    const flawedElements: ElementPhysicsSnapshot[] = [
      {
        selector: "button.tiny-close",
        tagName: "BUTTON",
        interactive: true,
        isTouchTarget: true,
        bounds: { x: 100, y: 100, width: 24, height: 24 },
      },
    ];

    const report = evaluateCognitiveQuestions({
      context: { ...context, viewport: "mobile" },
      elements: flawedElements,
    });
    const qFitts = report.questions.find((q) => q.id === "Q-ERGO-02-FITTS-ACQUISITION")!;

    expect(qFitts.passed).toBe(false);
    expect(qFitts.verdict).toBe("DEFECT_FLAGGED");
    expect(qFitts.evidence).toContain("button.tiny-close (24x24px)");
  });

  it("evaluates Norman error recovery for unshielded destructive actions", () => {
    const destructiveElements: ElementPhysicsSnapshot[] = [
      {
        selector: "button.delete-account",
        tagName: "BUTTON",
        interactive: true,
        isDestructive: true,
        hasConfirmation: false,
        hasUndo: false,
        bounds: { x: 100, y: 100, width: 160, height: 48 },
      },
    ];

    const report = evaluateCognitiveQuestions({
      context,
      elements: destructiveElements,
    });
    const qNorman = report.questions.find((q) => q.id === "Q-RESI-02-DESTRUCTIVE-SAFETY")!;

    expect(qNorman.passed).toBe(false);
    expect(qNorman.verdict).toBe("DEFECT_FLAGGED");
    expect(qNorman.observation).toContain("destructive action(s) lack confirmation");
  });
});
