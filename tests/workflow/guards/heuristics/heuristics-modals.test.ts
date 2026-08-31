import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  calculateApcaLightness,
  formatManifestFilename,
  isCertifiedManifest,
  loadCompanionManifest,
  saveCompanionManifest,
  synthesizeCompanionManifest,
  validateApcaElement,
  validateConcentricRadius,
  validateCustom,
  validateFloatingUiCollision,
  validateMaterialStateLayers,
  validateMechanical,
  validateSubpixelSnapping,
  validateWaiAriaFocusTrap,
} from "../../../../olt/scripts/src/capture/validator/index.ts";
import type {
  CompanionManifestV2,
  ElementPhysicsSnapshot,
  ValidationContext,
} from "../../../../olt/scripts/src/capture/validator/types.ts";
import {
  computeLayoutMetrics,
  createEmptyDomPhysicsSnapshot,
} from "../../../../olt/scripts/src/capture/runners/dom-physics-extractor.ts";
import { createSyntheticPngBuffer } from "../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  validateCompanionManifestCriteria,
  type CompanionManifestData,
  type DualChannelInput,
  type ScreenshotMetadata,
  type StructuredFinding,
  type VisualMetricsReport,
} from "../../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";
import { assertRoleArtifactPresent } from "../../../../olt/scripts/src/workflow/review/role-evidence.ts";
import type { TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

function createFindingCollector(): {
  readonly findings: StructuredFinding[];
  readonly addFinding: (
    category: StructuredFinding["category"],
    severity: StructuredFinding["severity"],
    message: string,
    remediation: string,
    affectedSelector?: string,
    viewport?: string,
  ) => void;
} {
  const findings: StructuredFinding[] = [];
  const addFinding = (
    category: StructuredFinding["category"],
    severity: StructuredFinding["severity"],
    message: string,
    remediation: string,
    affectedSelector?: string,
    viewport?: string,
  ): void => {
    findings.push({
      id: `FINDING-${String(findings.length + 1).padStart(3, "0")}`,
      category,
      severity,
      message,
      remediation,
      ...(affectedSelector !== undefined ? { affectedSelector } : {}),
      ...(viewport !== undefined ? { viewport } : {}),
    });
  };
  return { findings, addFinding };
}

describe("Adversarial Edge Cases: Modal Focus Trap Cycles & Tab Navigation", () => {
  it("flags modal dialogs missing WAI-ARIA 1.2 focus traps and aria-modal attributes", () => {
    // Adversarial: Dialog lacking both aria-modal="true" and hasTrapFocus: false
    const unconstrainedDialog: ElementPhysicsSnapshot = {
      selector: "div.modal-overlay[role='dialog']",
      tagName: "DIV",
      role: "dialog",
      bounds: { x: 200, y: 150, width: 400, height: 300 },
      attributes: {
        "aria-modal": "false",
      },
      hasTrapFocus: false,
    };

    const defect = validateWaiAriaFocusTrap(unconstrainedDialog, 0);
    expect(defect).not.toBeNull();
    expect(defect?.pillar).toBe("custom");
    expect(defect?.category).toBe("aria-focus-trap");
    expect(defect?.severity).toBe("critical");
    expect(defect?.message).toContain("missing WAI-ARIA 1.2 / Radix UI focus trap");
  });

  it("passes compliant modal dialogs with aria-modal and trapped keyboard focus", () => {
    const compliantDialog: ElementPhysicsSnapshot = {
      selector: "div.radix-dialog",
      tagName: "DIV",
      role: "dialog",
      bounds: { x: 200, y: 150, width: 400, height: 300 },
      attributes: {
        "aria-modal": "true",
      },
      hasTrapFocus: true,
    };

    expect(validateWaiAriaFocusTrap(compliantDialog, 0)).toBeNull();
  });

  it("flags composite interactive widgets missing roving tabindex and aria-activedescendant", () => {
    const compositeRoles = ["tablist", "menu", "menubar", "radiogroup", "grid", "tree"] as const;

    for (let i = 0; i < compositeRoles.length; i++) {
      const role = compositeRoles[i]!;
      const invalidComposite: ElementPhysicsSnapshot = {
        selector: `div.${role}-widget`,
        tagName: "DIV",
        role,
        bounds: { x: 0, y: 0, width: 300, height: 40 },
        hasRovingTabindex: false,
      };

      const defect = validateWaiAriaFocusTrap(invalidComposite, i);
      expect(defect).not.toBeNull();
      expect(defect?.severity).toBe("serious");
      expect(defect?.message).toContain(`role="${role}" lacks roving tabindex`);

      // Compliant with roving tabindex
      const validRoving: ElementPhysicsSnapshot = {
        selector: `div.${role}-roving`,
        tagName: "DIV",
        role,
        bounds: { x: 0, y: 0, width: 300, height: 40 },
        hasRovingTabindex: true,
      };
      expect(validateWaiAriaFocusTrap(validRoving, i)).toBeNull();

      // Compliant with aria-activedescendant
      const validActiveDesc: ElementPhysicsSnapshot = {
        selector: `div.${role}-activedesc`,
        tagName: "DIV",
        role,
        bounds: { x: 0, y: 0, width: 300, height: 40 },
        attributes: {
          "aria-activedescendant": "item-01",
        },
      };
      expect(validateWaiAriaFocusTrap(validActiveDesc, i)).toBeNull();
    }
  });

  it("handles disconnected DOM nodes and inert shadow roots gracefully", () => {
    // Orphaned node with empty selector, missing parents, bounds of 0 width/height
    const disconnectedEl: ElementPhysicsSnapshot = {
      selector: "",
      tagName: "DIV",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      interactive: false,
    };

    const ctx: ValidationContext = {
      screenId: "disconnected-dom-test",
      viewport: "desktop",
      elements: [disconnectedEl],
    };

    const customResult = validateCustom(ctx);
    expect(customResult.pillar).toBe("custom");
    expect(customResult.defects).toHaveLength(0);

    const mechResult = validateMechanical(ctx);
    expect(mechResult.pillar).toBe("mechanical");
    expect(mechResult.defects).toHaveLength(0);
  });
});
