import { describe, expect, it } from "bun:test";
import {
  COGNITIVE_BOILERPLATE,
  calculateFittsId,
  calculateHickHymanEntropy,
  evaluateCognitiveQuestions,
  validateCognitive,
  validateCognitiveSemanticDepth,
  validateCowanChunking,
  validateFittsLaw,
  validateHickHyman,
  validateNormanRecovery,
  validateUiStatesFsm,
} from "../../../../olt/scripts/src/capture/validator/cognitive/index.ts";
import type {
  CognitiveAnalysisReport,
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../../olt/scripts/src/capture/validator/types.ts";

describe("Cognitive Validators", () => {
  describe("Cowan Working Memory 4±1 Chunking (cowan-chunking.ts)", () => {
    it("returns null for elements without children or non-container tags", () => {
      const elNoChildren: ElementPhysicsSnapshot = {
        selector: "nav.main",
        tagName: "NAV",
        bounds: { x: 0, y: 0, width: 200, height: 400 },
      };
      expect(validateCowanChunking(elNoChildren, 0)).toBeNull();

      const elDiv: ElementPhysicsSnapshot = {
        selector: "div.wrapper",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 200, height: 400 },
        children: Array.from({ length: 8 }, (_, i) => ({
          selector: `span.child-${i}`,
          tagName: "SPAN",
          bounds: { x: 0, y: i * 20, width: 100, height: 20 },
        })),
      };
      expect(validateCowanChunking(elDiv, 0)).toBeNull();
    });

    it("evaluates containers (NAV, SECTION, UL, OL, MENU, role navigation/menu/list)", () => {
      const containerTags = ["NAV", "SECTION", "UL", "OL", "MENU"];
      for (const tag of containerTags) {
        // <= 5 children passes
        const elPass: ElementPhysicsSnapshot = {
          selector: `${tag.toLowerCase()}.nav`,
          tagName: tag,
          bounds: { x: 0, y: 0, width: 200, height: 300 },
          children: Array.from({ length: 4 }, (_, i) => ({
            selector: `div.item-${i}`,
            tagName: "DIV",
            bounds: { x: 0, y: i * 30, width: 100, height: 30 },
          })),
        };
        expect(validateCowanChunking(elPass, 0)).toBeNull();

        // > 5 children fails
        const elFail: ElementPhysicsSnapshot = {
          selector: `${tag.toLowerCase()}.dense`,
          tagName: tag,
          bounds: { x: 0, y: 0, width: 200, height: 300 },
          children: Array.from({ length: 8 }, (_, i) => ({
            selector: `div.item-${i}`,
            tagName: "DIV",
            bounds: { x: 0, y: i * 30, width: 100, height: 30 },
          })),
        };
        const def = validateCowanChunking(elFail, 1);
        expect(def).not.toBeNull();
        expect(def?.id).toBe("cog-cowan-1");
        expect(def?.severity).toBe("moderate");
        expect(def?.metadata?.itemCount).toBe(8);
      }

      // Container by role
      const elByRole: ElementPhysicsSnapshot = {
        selector: "div.nav-role",
        tagName: "DIV",
        role: "navigation",
        bounds: { x: 0, y: 0, width: 200, height: 300 },
        children: Array.from({ length: 9 }, (_, i) => ({
          selector: `a.link-${i}`,
          tagName: "A",
          bounds: { x: 0, y: i * 30, width: 100, height: 30 },
        })),
      };
      expect(validateCowanChunking(elByRole, 2)).not.toBeNull();
    });
  });

  describe("Fitts's Law Index of Difficulty (fitts-law.ts)", () => {
    it("calculateFittsId computes accurate difficulty bits and boundary conditions", () => {
      // Target centered on origin -> distance = 0 -> ID = 0
      expect(calculateFittsId(100, 100, 40, 40, 120, 120)).toBe(0);

      // Distance 500, width 40 -> 2D/W = 1000/40 = 25 -> log2(25) ~ 4.64
      const id = calculateFittsId(500, 500, 40, 40, 0, 0);
      expect(id).toBeGreaterThan(4.0);

      // Very close target where 2D/W <= 1 -> returns 0
      expect(calculateFittsId(0, 0, 100, 100, 45, 45)).toBe(0);

      // Distance <= 0 -> returns 0
      expect(calculateFittsId(10, 10, 20, 20, 20, 20)).toBe(0);
    });

    it("validateFittsLaw checks buttons and interactive controls against 5.5 bit threshold", () => {
      // Non-interactive / non-button returns null
      const elDiv: ElementPhysicsSnapshot = {
        selector: "div.banner",
        tagName: "DIV",
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      };
      expect(validateFittsLaw(elDiv, 0)).toBeNull();

      // Normal button near center passes (ID <= 5.5)
      const elBtnPass: ElementPhysicsSnapshot = {
        selector: "button.submit",
        tagName: "BUTTON",
        interactive: true,
        bounds: { x: 600, y: 400, width: 120, height: 44 },
      };
      expect(validateFittsLaw(elBtnPass, 0, { width: 1280, height: 800 })).toBeNull();

      // Tiny button at corner far from origin (ID > 5.5)
      const elBtnFar: ElementPhysicsSnapshot = {
        selector: "button.tiny-corner",
        tagName: "BUTTON",
        interactive: true,
        bounds: { x: 2, y: 2, width: 12, height: 12 },
      };
      const defect = validateFittsLaw(elBtnFar, 1, { width: 1920, height: 1080 });
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("cog-fitts-1");
      expect(defect?.severity).toBe("moderate");
      expect(defect?.message).toContain("Index of Difficulty");
      expect(defect?.metadata?.indexOfDifficultyBits).toBeGreaterThan(5.5);

      // Uses fallback 1280x800 viewport bounds when omitted
      const defFallback = validateFittsLaw(elBtnFar, 2);
      expect(defFallback).not.toBeNull();
    });
  });

  describe("Hick-Hyman Decision Entropy (hick-hyman.ts)", () => {
    it("calculateHickHymanEntropy computes entropy bits for items", () => {
      expect(calculateHickHymanEntropy(0)).toBe(0);
      expect(calculateHickHymanEntropy(-5)).toBe(0);
      expect(calculateHickHymanEntropy(1)).toBeCloseTo(1.0, 4); // log2(2) = 1
      expect(calculateHickHymanEntropy(7)).toBeCloseTo(3.0, 4); // log2(8) = 3
    });

    it("validateHickHyman checks choice containers (menu, listbox, SELECT, dropdown, etc.)", () => {
      // Empty children returns null
      const elEmpty: ElementPhysicsSnapshot = {
        selector: "select.country",
        tagName: "SELECT",
        bounds: { x: 0, y: 0, width: 150, height: 36 },
      };
      expect(validateHickHyman(elEmpty, 0)).toBeNull();

      // Choice container with <= 7 options passes
      const elChoicePass: ElementPhysicsSnapshot = {
        selector: "select.size",
        tagName: "SELECT",
        bounds: { x: 0, y: 0, width: 150, height: 36 },
        children: Array.from({ length: 5 }, (_, i) => ({
          selector: `option.opt-${i}`,
          tagName: "OPTION",
          bounds: { x: 0, y: i * 20, width: 100, height: 20 },
        })),
      };
      expect(validateHickHyman(elChoicePass, 0)).toBeNull();

      // Choice container with > 7 options fails (excess entropy)
      const elChoiceFail: ElementPhysicsSnapshot = {
        selector: "ul.dropdown-options",
        tagName: "UL",
        role: "listbox",
        bounds: { x: 0, y: 0, width: 200, height: 300 },
        children: Array.from({ length: 15 }, (_, i) => ({
          selector: `li.opt-${i}`,
          tagName: "LI",
          bounds: { x: 0, y: i * 20, width: 100, height: 20 },
        })),
      };
      const defect = validateHickHyman(elChoiceFail, 1);
      expect(defect).not.toBeNull();
      expect(defect?.id).toBe("cog-hick-hyman-1");
      expect(defect?.severity).toBe("moderate");
      expect(defect?.metadata?.optionCount).toBe(15);
      expect(defect?.metadata?.entropyBits).toBeGreaterThan(3.5);
    });
  });

  describe("Don Norman Error Recovery Grace Periods (norman-recovery.ts)", () => {
    it("returns null for non-destructive actions", () => {
      const elSave: ElementPhysicsSnapshot = {
        selector: "button.save",
        tagName: "BUTTON",
        text: "Save Changes",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
      };
      expect(validateNormanRecovery(elSave, 0)).toBeNull();
    });

    it("identifies destructive actions by keyword or isDestructive flag", () => {
      const keywords = [
        "delete",
        "remove",
        "destroy",
        "drop",
        "purge",
        "terminate",
        "wipe",
        "discard",
      ];
      for (const kw of keywords) {
        const elText: ElementPhysicsSnapshot = {
          selector: "button.action",
          tagName: "BUTTON",
          text: `Please ${kw} record`,
          bounds: { x: 0, y: 0, width: 120, height: 40 },
        };
        const defText = validateNormanRecovery(elText, 0);
        expect(defText).not.toBeNull();
        expect(defText?.category).toBe("norman-grace");

        const elSelector: ElementPhysicsSnapshot = {
          selector: `button.btn-${kw}`,
          tagName: "BUTTON",
          bounds: { x: 0, y: 0, width: 120, height: 40 },
        };
        expect(validateNormanRecovery(elSelector, 0)).not.toBeNull();
      }

      const elFlag: ElementPhysicsSnapshot = {
        selector: "button.custom",
        tagName: "BUTTON",
        isDestructive: true,
        bounds: { x: 0, y: 0, width: 120, height: 40 },
      };
      expect(validateNormanRecovery(elFlag, 0)).not.toBeNull();
    });

    it("passes destructive actions with confirmation dialog or undo grace period", () => {
      const elConfirmed: ElementPhysicsSnapshot = {
        selector: "button.delete",
        tagName: "BUTTON",
        text: "Delete Project",
        hasConfirmation: true,
        bounds: { x: 0, y: 0, width: 120, height: 40 },
      };
      expect(validateNormanRecovery(elConfirmed, 0)).toBeNull();

      const elUndo: ElementPhysicsSnapshot = {
        selector: "button.remove",
        tagName: "BUTTON",
        text: "Remove Item",
        hasUndo: true,
        bounds: { x: 0, y: 0, width: 120, height: 40 },
      };
      expect(validateNormanRecovery(elUndo, 0)).toBeNull();
    });

    it("elevates severity to critical for account or bulk destruction without safety", () => {
      const elAccount: ElementPhysicsSnapshot = {
        selector: "button.delete-account",
        tagName: "BUTTON",
        text: "Delete Account and Billing Data",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
      };
      const defAccount = validateNormanRecovery(elAccount, 1);
      expect(defAccount).not.toBeNull();
      expect(defAccount?.severity).toBe("critical");

      const elAll: ElementPhysicsSnapshot = {
        selector: "button.wipe-all",
        tagName: "BUTTON",
        text: "Wipe All Logs",
        bounds: { x: 0, y: 0, width: 200, height: 40 },
      };
      const defAll = validateNormanRecovery(elAll, 2);
      expect(defAll).not.toBeNull();
      expect(defAll?.severity).toBe("critical");
    });
  });

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
      // With 'disabled'
      const elDisabled: ElementPhysicsSnapshot = {
        selector: "button.complete-btn",
        tagName: "BUTTON",
        bounds: { x: 0, y: 0, width: 100, height: 40 },
        implementedStates: ["default", "hover", "active", "focus", "disabled"],
      };
      expect(validateUiStatesFsm(elDisabled, 0)).toBeNull();

      // With 'loading' substituting for 'disabled'
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
        implementedStates: ["default", "hover"], // Missing active, focus, disabled
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

  describe("Cognitive Questionnaire Engine (cognitive-questions/*)", () => {
    it("evaluates all viewports (mobile, tablet, desktop, desktop-wide) with fallback bounds", () => {
      const viewports = ["mobile", "tablet", "desktop", "desktop-wide"];
      for (const vp of viewports) {
        const report = evaluateCognitiveQuestions({
          context: { screenId: "screen", viewport: vp, elements: [] },
          elements: [],
        });
        expect(report.questionsEvaluated).toBe(12);
        expect(report.questions.length).toBe(12);
      }
    });

    it("evaluates failing branches in perception, ergonomics, and typography questions", () => {
      // Failing elements setup
      const failingElements: ElementPhysicsSnapshot[] = [
        // No heading, text without dominant anchor (Q-PERC-01 fail)
        {
          selector: "p.body",
          tagName: "P",
          text: "Some random text without heading",
          bounds: { x: 10, y: 10, width: 200, height: 20 },
          computedStyles: { fontSize: 14, color: "#ffffff", backgroundColor: "#ffffff" }, // Low contrast Q-TYPO-01 fail
        },
        // 7 large cards (Q-PERC-02 chunking warning)
        ...Array.from({ length: 7 }, (_, i) => ({
          selector: `div.card-${i}`,
          tagName: "DIV",
          bounds: { x: 10, y: 40 + i * 90, width: 400, height: 85 },
          computedStyles: { padding: 13 }, // Non-8pt grid padding (13 % 4 !== 0) (Q-TYPO-02 fail)
        })),
        // Sub-44px touch target (Q-ERGO-02 fail)
        {
          selector: "button.tiny-touch",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 10, y: 700, width: 20, height: 20 },
          implementedStates: ["default", "active"], // Missing hover in pointer viewport (Q-RESI-01 fail)
        },
        // Interactive element near bottom floor in mobile (Q-ERGO-03 fail)
        {
          selector: "button.bottom-edge",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 10, y: 785, width: 100, height: 44 }, // within 32px of 800
        },
        // Destructive action without safety (Q-RESI-02 fail)
        {
          selector: "button.delete-all",
          tagName: "BUTTON",
          isDestructive: true,
          text: "Delete All Records",
          bounds: { x: 10, y: 500, width: 160, height: 44 },
        },
      ];

      const report = evaluateCognitiveQuestions({
        context: {
          screenId: "failing_screen",
          viewport: "desktop",
          elements: failingElements,
          viewportBounds: { width: 1280, height: 800 },
        },
        elements: failingElements,
      });

      const qAnchor = report.questions.find((q) => q.id === "Q-PERC-01-JTBD-ANCHOR");
      expect(qAnchor?.passed).toBe(false);
      expect(qAnchor?.verdict).toBe("DEFECT_FLAGGED");

      const qChunks = report.questions.find((q) => q.id === "Q-PERC-02-COWAN-CHUNKS");
      expect(qChunks?.passed).toBe(false);
      expect(qChunks?.verdict).toBe("ACCEPTABLE");

      const qFitts = report.questions.find((q) => q.id === "Q-ERGO-02-FITTS-ACQUISITION");
      expect(qFitts?.passed).toBe(false);

      const qFloor = report.questions.find((q) => q.id === "Q-ERGO-03-SAFE-FLOOR");
      expect(qFloor?.passed).toBe(false);

      const qContrast = report.questions.find((q) => q.id === "Q-TYPO-01-CONTRAST");
      expect(qContrast?.passed).toBe(false);

      const qGrid = report.questions.find((q) => q.id === "Q-TYPO-02-SPATIAL-GRID");
      expect(qGrid?.passed).toBe(false);

      const qStates = report.questions.find((q) => q.id === "Q-RESI-01-FIVE-STATES");
      expect(qStates?.passed).toBe(false);

      const qDestructive = report.questions.find((q) => q.id === "Q-RESI-02-DESTRUCTIVE-SAFETY");
      expect(qDestructive?.passed).toBe(false);
    });

    it("evaluates mobile thumb reach and telemetry indicators across thumb zones and stretch positions", () => {
      // In optimal thumb zone (y >= reachFloor)
      const mobileElements: ElementPhysicsSnapshot[] = [
        {
          selector: "button.mobile-action",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 20, y: 700, width: 350, height: 50 }, // in thumb zone (y >= 844 - 240 = 604)
        },
        {
          selector: "span.live-status",
          tagName: "SPAN",
          text: "Live Sync Active",
          bounds: { x: 20, y: 20, width: 100, height: 20 },
        },
      ];

      const report = evaluateCognitiveQuestions({
        context: {
          screenId: "mobile_screen",
          viewport: "mobile",
          elements: mobileElements,
        },
        elements: mobileElements,
      });

      const qThumb = report.questions.find((q) => q.id === "Q-ERGO-01-THUMB-ZONE");
      expect(qThumb?.passed).toBe(true);

      const qJtbd = report.questions.find((q) => q.id === "Q-JTBD-01-TELEMETRY-HEARTBEAT");
      expect(qJtbd?.passed).toBe(true);
      expect(qJtbd?.observation).toContain("Live Sync Active");

      // Mid-canvas interactive (y <= 600)
      const midElements: ElementPhysicsSnapshot[] = [
        {
          selector: "button.mid-action",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 20, y: 500, width: 300, height: 50 },
        },
      ];
      const reportMid = evaluateCognitiveQuestions({
        context: { screenId: "mobile_mid", viewport: "mobile", elements: midElements },
        elements: midElements,
      });
      const qThumbMid = reportMid.questions.find((q) => q.id === "Q-ERGO-01-THUMB-ZONE");
      expect(qThumbMid?.passed).toBe(true);

      // Dead-zone stretch interactive (y = 602, between 600 and reachFloor 604)
      const stretchElements: ElementPhysicsSnapshot[] = [
        {
          selector: "button.stretch-action",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 20, y: 602, width: 300, height: 50 },
        },
      ];
      const reportStretch = evaluateCognitiveQuestions({
        context: { screenId: "mobile_stretch", viewport: "mobile", elements: stretchElements },
        elements: stretchElements,
      });
      const qThumbStretch = reportStretch.questions.find((q) => q.id === "Q-ERGO-01-THUMB-ZONE");
      expect(qThumbStretch?.passed).toBe(false);
      expect(qThumbStretch?.verdict).toBe("ACCEPTABLE");
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
            observation: "ok", // Boilerplate
            evidence: "n/a", // Boilerplate
          },
          {
            id: "Q-2",
            category: "ergonomics",
            question: "Test question 2",
            answered: true,
            passed: true,
            verdict: "OPTIMAL",
            observation: "Too short", // < 15 chars
            evidence: "No metrics here", // < 25 chars without metrics
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
        undefined, // covers if (!el) continue
        // Cowan defect
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
        // Fitts defect
        {
          selector: "button.tiny-far",
          tagName: "BUTTON",
          interactive: true,
          bounds: { x: 2, y: 2, width: 10, height: 10 },
        },
        // Hick-Hyman defect
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
        // Norman recovery defect
        {
          selector: "button.delete-all",
          tagName: "BUTTON",
          text: "Delete All Records",
          bounds: { x: 0, y: 0, width: 150, height: 40 },
        },
        // UI states FSM defect
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
