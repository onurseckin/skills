import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDualChannelAudit } from "../../../../../../olt/scripts/src/cli/commands/task-review-support.ts";
import type { TaskRecord } from "../../../../../../olt/scripts/src/workflow/types.ts";
import type { ScreenshotRecord } from "../../../../../../olt/scripts/src/reporting/screenshot-types.ts";
import type { CompanionManifestData } from "../../../../../../olt/scripts/src/validation/channels/index.ts";
import { createSyntheticPngBuffer } from "../../../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createValidScreenshotFixtures(label: string): ScreenshotRecord[] {
  const dir = mkdtempSync(join(tmpdir(), `dual-chan-${label}-`));
  roots.push(dir);
  const specs = [
    { name: "button-desktop.png", w: 1440, h: 900, bytes: 2048, sha: "sha-desktop" },
    { name: "button-tablet.png", w: 768, h: 1024, bytes: 1536, sha: "sha-tablet" },
    { name: "button-mobile.png", w: 390, h: 844, bytes: 1200, sha: "sha-mobile" },
  ];
  return specs.map(({ name, w, h, bytes, sha }) => {
    const path = join(dir, name);
    writeFileSync(path, createSyntheticPngBuffer(w, h, bytes));
    return {
      kind: "screenshot",
      name,
      path,
      sha256: sha,
      bytes,
      blob_path: `/mock/blobs/${sha}`,
      storage: "copy",
      original_path: path,
    };
  });
}

describe("Task Review Dual-Channel - Companion Manifest Audit", () => {
  const dummyTask: TaskRecord = {
    id: "task-01",
    label: "Implement UI button component",
    lane: 0,
    requirement_ids: ["req-01"],
    dependencies: [],
    write_scope: ["src/components/Button.tsx"],
    acceptance: [{ id: "acc-01", statement: "Renders button" }],
    status: "running",
    attempts: [],
    history: [],
  };

  it("passes audit when valid screenshots and 4-pillar companion manifests are present", () => {
    const deepManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "Passes APCA Lc lightness contrast thresholds across all button variants.",
          evidence: "APCA Lc=78.4 exceeds threshold 60.0 on 25 inspected button nodes.",
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "All UI interaction states (idle, hover, active, focus, disabled) implemented.",
          evidence: "5 distinct interactive states verified with 120ms animation transitions.",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "Conforms to typography, spacing, and border-radius token scales.",
          evidence: "42 design tokens validated: 16px font-size, 8px padding, 4px radius.",
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "State layers calibrated against Material 3 state layer specifications.",
          evidence: "Hover opacity 0.08, active opacity 0.12 tested with 0 origin orphans.",
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      createValidScreenshotFixtures("passes-audit-valid-screenshots"),
      [deepManifest],
      { requireSemanticDepth: true },
    );
    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(true);
    expect(audit.mode).toBe("screenshot_gap_filled");
    expect(
      audit.proofs.some((p) => p.verifiedInvariants.includes("manifest_4_pillars_certified")),
    ).toBe(true);
  });
});
