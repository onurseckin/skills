import { describe, expect, it } from "bun:test";
import {
  runDualChannelAudit,
  dualChannelRefusalMessage,
} from "../../../../olt/scripts/src/cli/commands/task-review-support.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import type { ScreenshotRecord } from "../../../../olt/scripts/src/reporting/screenshot-types.ts";
import type { CompanionManifestData } from "../../../../olt/scripts/src/validation/channels/index.ts";

describe("Task Review Dual-Channel Audit - Invariants & Pillar Checks", () => {
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
    repair_round: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const validScreenshots: ScreenshotRecord[] = [
    {
      kind: "screenshot",
      name: "button-desktop.png",
      path: "/mock/button-desktop.png",
      sha256: "sha-desktop",
      bytes: 2048,
      blob_path: "/mock/blobs/sha-desktop",
      storage: "copy",
      original_path: "/mock/button-desktop.png",
    },
    {
      kind: "screenshot",
      name: "button-tablet.png",
      path: "/mock/button-tablet.png",
      sha256: "sha-tablet",
      bytes: 1536,
      blob_path: "/mock/blobs/sha-tablet",
      storage: "copy",
      original_path: "/mock/button-tablet.png",
    },
    {
      kind: "screenshot",
      name: "button-mobile.png",
      path: "/mock/button-mobile.png",
      sha256: "sha-mobile",
      bytes: 1200,
      blob_path: "/mock/blobs/sha-mobile",
      storage: "copy",
      original_path: "/mock/button-mobile.png",
    },
  ];

  it("identifies UI task by write scope", () => {
    const audit = runDualChannelAudit("/mock/runRoot", dummyTask, [], []);
    expect(audit.isUiTask).toBe(true);
  });

  it("identifies non-UI task when no UI files in write scope", () => {
    const backendTask: TaskRecord = {
      ...dummyTask,
      id: "task-backend",
      write_scope: ["src/engine/db.ts"],
    };
    const audit = runDualChannelAudit("/mock/runRoot", backendTask, [], []);
    expect(audit.isUiTask).toBe(false);
    expect(audit.passed).toBe(true);
  });

  it("fails audit and generates refusal message when screenshot is < 1024 bytes", () => {
    const stubScreenshot: ScreenshotRecord = {
      kind: "screenshot",
      name: "button-desktop.png",
      path: "/mock/button-desktop.png",
      sha256: "dummy-sha",
      bytes: 67,
      blob_path: "/mock/blobs/dummy-sha",
      storage: "copy",
      original_path: "/mock/button-desktop.png",
    };

    const audit = runDualChannelAudit("/mock/runRoot", dummyTask, [stubScreenshot], []);
    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain("Anti-Mocking Invariant Violation");
    expect(refusal).toContain("< 1024 bytes");
  });

  it("fails audit and generates actionable refusal message when companion manifest contains shallow/boilerplate evidence under requireSemanticDepth: true", () => {
    const shallowManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "looks good",
          evidence: "pass",
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "ok",
          evidence: "verified",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "valid",
          evidence: "as expected",
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "done",
          evidence: "fine",
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      validScreenshots,
      [shallowManifest],
      { requireSemanticDepth: true },
    );

    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain(
      "Dual-Channel Validator Protocol mandate not satisfied (mode rejected)",
    );
    expect(refusal).toContain("boilerplate_evidence");
    expect(refusal).toContain("looks good");
  });

  it("fails audit and generates actionable refusal message when companion manifest contains superficial evidence (< 12 chars)", () => {
    const superficialManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "Short text",
          evidence: "APCA Lc=78.4 across 25 nodes",
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "All UI interaction states implemented cleanly",
          evidence: "5 states ok",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "Conforms to typography and spacing tokens throughout",
          evidence: "42 token usages validated",
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "State layers calibrated against Material 3 specs",
          evidence: "Hover opacity 0.08 tested",
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      validScreenshots,
      [superficialManifest],
      { requireSemanticDepth: true },
    );

    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain("superficial_evidence");
    expect(refusal).toContain("CRIT-MECH-APCA");
  });

  it("fails audit and generates actionable refusal message when companion manifest evidence lacks quantitative metrics", () => {
    const noMetricsManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "Contrast ratios adhere to web accessibility standards.",
          evidence: "Verified that text contrast appears distinct and legible over background.",
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "State machine transitions handled correctly according to design specs.",
          evidence: "All states observed in unit tests without unexpected behavior.",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "Design system tokens are used consistently across components.",
          evidence: "Validated tokens for typography and colors across all widgets.",
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "Interactive layer opacity responds to user touch and focus state changes.",
          evidence: "Opacity shifts visibly on hover and press events.",
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      validScreenshots,
      [noMetricsManifest],
      { requireSemanticDepth: true },
    );

    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain("missing_evidence_metrics");
    expect(refusal).toContain("quantitative measurements");
  });
});
