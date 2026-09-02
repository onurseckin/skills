import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatValidateUiBrief,
  validateUiCommand,
} from "../../../../olt/scripts/src/cli/commands/validate-ui.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  initRun,
  linkBlobIntoView,
  putBlobFile,
  recordCaptures,
  refreshIndex,
  transact,
} from "../../../../olt/scripts/src/engine/store/index.ts";
import type { DualUiAuditResult } from "../../../../olt/scripts/src/validation/ui/index.ts";

describe("validate-ui CLI command coverage suite", () => {
  let tempDir: string;
  let runRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "validate-ui-test-"));
    runRoot = initRun(tempDir, "validate-ui-run", new TextEncoder().encode("prompt"), "file", true);

    transact(runRoot, "system", "setup-test-tasks", {}, (working) => {
      const tasks = (working.tasks ?? {}) as Record<string, unknown>;
      tasks["task-ui-1"] = {
        id: "task-ui-1",
        title: "Build Responsive Header",
        role: "frontend-developer",
        write_scope: ["src/components/Header.tsx", "src/styles/header.css"],
        status: "in_progress",
      };
      tasks["task-backend-1"] = {
        id: "task-backend-1",
        title: "Database Migration",
        role: "backend-developer",
        write_scope: ["src/db/migrate.ts"],
        status: "in_progress",
      };
      working.tasks = tasks;
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("formatValidateUiBrief formats complete passing and failing briefs with edge cases", () => {
    // 1. Failing brief with empty viewports and defects
    const failingResult: DualUiAuditResult = {
      isUiTask: true,
      passed: false,
      mode: "rejected",
      mechanicReport: {
        passed: false,
        viewportsCovered: [],
        missingViewports: [],
        touchTargetEvaluations: [
          { selector: "button", width: 30, height: 30, passed: false, minRequired: 44 },
        ],
        touchTargetFailures: [
          { selector: "button", width: 30, height: 30, passed: false, minRequired: 44 },
        ],
        overflowEvaluations: [
          { selector: "div", scrollWidth: 500, clientWidth: 400, passed: false },
        ],
        overflowViolations: [
          { selector: "div", scrollWidth: 500, clientWidth: 400, passed: false },
        ],
        journeyResults: [],
        validScreenshotsCount: 0,
        totalDefects: 2,
        summary: "Mechanic failed",
      },
      cognitiveReport: {
        passed: false,
        canExecuteShell: false,
        opticalHierarchy: {
          score: 40,
          passed: false,
          headingScaleRatio: 1.0,
          visualWeightBalanced: false,
          notes: "bad",
          issues: [],
        },
        descenderIntegrity: {
          passed: false,
          clippedElements: ["p"],
          elementsInspected: 1,
          descenderCharactersChecked: ["p"],
          notes: "bad",
          issues: [],
        },
        aestheticHarmony: {
          score: 30,
          passed: false,
          spacingRhythmGrid: 4,
          spacingRhythmValid: false,
          colorPaletteBalance: "bad",
          themeHarmony: "bad",
          notes: "bad",
          issues: [],
        },
        socraticCritique: "",
        shellHardlockViolations: [],
        isSuperficial: true,
        totalDefects: 1,
        summary: "Cognitive failed",
      },
      defects: [
        {
          id: "d1",
          pillar: "mechanical",
          category: "touch",
          message: "Target too small",
          severity: "important",
          remediation: "Expand padding",
        },
      ],
      summary: "Audit failed completely",
    };

    const brief1 = formatValidateUiBrief(failingResult, "task-ui-1");
    expect(brief1).toContain("❌ Dual UI Validation Report: `task-ui-1`");
    expect(brief1).toContain("Viewports Covered**: none (Missing: none)");
    expect(brief1).toContain("Qualitative Critique**: None provided");
    expect(brief1).toContain("#### ⚠️ Defects Detected:");
    expect(brief1).toContain("[MECHANICAL]");

    // 2. Non-UI task passing brief
    const nonUiResult: DualUiAuditResult = {
      isUiTask: false,
      passed: true,
      mode: "non_ui_skipped",
      mechanicReport: {
        passed: true,
        viewportsCovered: ["desktop"],
        missingViewports: ["mobile"],
        touchTargetEvaluations: [],
        touchTargetFailures: [],
        overflowEvaluations: [],
        overflowViolations: [],
        journeyResults: [],
        validScreenshotsCount: 1,
        totalDefects: 0,
        summary: "Bypassed",
      },
      cognitiveReport: {
        passed: true,
        canExecuteShell: false,
        opticalHierarchy: {
          score: 100,
          passed: true,
          headingScaleRatio: 1.25,
          visualWeightBalanced: true,
          notes: "ok",
          issues: [],
        },
        descenderIntegrity: {
          passed: true,
          clippedElements: [],
          elementsInspected: 0,
          descenderCharactersChecked: [],
          notes: "ok",
          issues: [],
        },
        aestheticHarmony: {
          score: 100,
          passed: true,
          spacingRhythmGrid: 8,
          spacingRhythmValid: true,
          colorPaletteBalance: "ok",
          themeHarmony: "ok",
          notes: "ok",
          issues: [],
        },
        socraticCritique: "Valid non-UI bypass verified.",
        shellHardlockViolations: [],
        isSuperficial: false,
        totalDefects: 0,
        summary: "Bypassed",
      },
      defects: [],
      summary: "Non UI task skipped.",
    };

    const brief2 = formatValidateUiBrief(nonUiResult, "task-backend-1");
    expect(brief2).toContain("✅ Dual UI Validation Report: `task-backend-1`");
    expect(brief2).toContain("UI Scope Detected**: No");
    expect(brief2).toContain("Valid non-UI bypass verified.");
  });

  test("validateUiCommand validates flags and throws on missing or unknown tasks", async () => {
    await expect(validateUiCommand({})).rejects.toThrow(HarnessError);
    await expect(validateUiCommand({ run: runRoot })).rejects.toThrow(HarnessError);
    await expect(validateUiCommand({ run: runRoot, task: "nonexistent-task" })).rejects.toThrow(
      "unknown task nonexistent-task",
    );
  });

  test("validateUiCommand executes on valid task in capsule and handles screenshots", async () => {
    const res1 = await validateUiCommand({ run: runRoot, task: "task-backend-1" });
    expect(
      res1.task_id === "task-backend-1" && res1.is_ui_task === true && res1.passed === true,
    ).toBe(true);

    await expect(
      validateUiCommand({ run: runRoot, task: "task-ui-1", "require-screenshots": true }),
    ).rejects.toThrow("no valid screenshot artifacts");

    const sampleImg = join(tempDir, "header.png");
    writeFileSync(sampleImg, Buffer.alloc(2048, 1));
    const blob = putBlobFile(runRoot, sampleImg);
    const link = linkBlobIntoView(runRoot, blob, "evidence/screenshots", "header.png");
    recordCaptures(runRoot, [
      {
        kind: "screenshot",
        name: "header.png",
        sha256: blob.sha256,
        bytes: blob.bytes,
        blob_path: blob.path,
        path: link.view_path,
        storage: link.storage,
        original_path: "header.png",
        task_id: "task-ui-1",
        actor: "ui-mechanic-validator",
      },
    ]);
    refreshIndex(runRoot);

    const res2 = await validateUiCommand({
      run: runRoot,
      task: "task-ui-1",
      "require-screenshots": true,
      "touch-floor": "44",
      summary: "Fallback critique",
      viewports: "mobile, tablet, desktop",
    });
    expect(res2.task_id === "task-ui-1" && res2.passed === true).toBe(true);
  });
});
