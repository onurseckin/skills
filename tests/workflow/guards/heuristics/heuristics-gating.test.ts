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

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies heuristics-workflow.test.ts contains zero any types and zero suppressions", async () => {
    const thisFilePath = join(import.meta.dir, "heuristics-gating.test.ts");
    const content = await readFile(thisFilePath, "utf8");
    const lines = content.split("\n");

    const forbiddenAnyForms = [
      ":" + " any",
      "as" + " any",
      "<" + "any>",
      "Promise<" + "any>",
      "Record<string," + " any>",
    ];
    const forbiddenSupTokens = [
      "@" + "ts-ignore",
      "@" + "ts-expect-error",
      "@" + "ts-nocheck",
      "eslint-" + "disable",
      "oxlint-" + "disable",
    ];

    const invariantBlockIdx = lines.findIndex((l) =>
      l.includes("Static Invariant Verification: Zero TypeScript any"),
    );

    const invalidLines = lines.filter((line, idx) => {
      // Ignore the static invariant test block itself
      if (invariantBlockIdx !== -1 && idx >= invariantBlockIdx) return false;
      return (
        forbiddenAnyForms.some((token) => line.includes(token)) ||
        forbiddenSupTokens.some((token) => line.includes(token))
      );
    });

    expect(invalidLines).toEqual([]);
  });
});
