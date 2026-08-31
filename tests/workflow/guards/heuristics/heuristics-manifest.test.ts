import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
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

describe("Adversarial Edge Cases: Multi-Viewport Companion Manifest Verification", () => {
  it("rejects companion manifests missing any of the 4 mandatory pillars", () => {
    const { findings, addFinding } = createFindingCollector();

    // Manifest missing Mechanical pillar
    const manifestMissingMech: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "settings-view",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-COGN-COWAN",
          pillar: "cognitive",
          passed: true,
          details: "Passes chunking",
          evidence: "4 chunks",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          passed: true,
          details: "Passes tokens",
          evidence: "Tokens valid",
        },
        {
          id: "CRIT-UX-FOCUS-TRAP",
          pillar: "ux",
          passed: true,
          details: "Passes focus trap",
          evidence: "Trapped focus",
        },
      ],
    };

    const res = validateCompanionManifestCriteria(manifestMissingMech, addFinding);
    expect(res.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "missing_pillar_criteria" && f.message.includes("Mechanical"),
      ),
    ).toBe(true);
  });

  it("rejects unevidenced evaluations (missing passed flag, empty details and evidence)", () => {
    const { findings, addFinding } = createFindingCollector();

    const unevidencedManifest = {
      screenId: "profile-view",
      viewport: "mobile",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          // missing passed boolean!
          details: "",
          evidence: "   ",
        },
      ],
    };

    const res = validateCompanionManifestCriteria(unevidencedManifest, addFinding);
    expect(res.valid).toBe(false);
    expect(
      findings.some(
        (f) => f.category === "invalid_manifest_criterion" && f.message.includes("passed"),
      ),
    ).toBe(true);
    expect(
      findings.some(
        (f) =>
          f.category === "invalid_manifest_criterion" &&
          f.message.includes("non-empty 'details' or 'evidence'"),
      ),
    ).toBe(true);
  });

});
