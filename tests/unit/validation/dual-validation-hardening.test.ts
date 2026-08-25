import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeDualChannel,
  validateBoundaryIntegrity,
  assertNoBoundaryLeak,
  validateReviewAntiBatching,
  AntiMockEngine,
  type DualChannelInput,
} from "../../../olt/scripts/src/validation/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Validation Layer Hardening & Dual-Validation Requirements", () => {
  describe("1. Validation Index Re-exports", () => {
    it("exports anti-leak and anti-batching functions from validation index", () => {
      expect(typeof validateBoundaryIntegrity).toBe("function");
      expect(typeof assertNoBoundaryLeak).toBe("function");
      expect(typeof validateReviewAntiBatching).toBe("function");
      expect(typeof AntiMockEngine).toBe("function");
    });
  });

  describe("2. Dual-Channel Cognitive / UI Validation Hardening", () => {
    it("rejects UI task with no visual artifacts (screenshots or DOM report)", () => {
      const input: DualChannelInput = {
        taskFiles: ["src/components/Header.tsx"],
        writeScope: ["src/components/Header.tsx"],
        screenshots: [],
      };
      const result = analyzeDualChannel(input);
      expect(result.isUiTask).toBe(true);
      expect(result.passed).toBe(false);
      expect(result.mode).toBe("rejected");
      expect(result.findings.some((f) => f.category === "missing_channel")).toBe(true);
    });

    it("rejects UI task with stubbed or miniature screenshots (< 1024 bytes)", () => {
      const input: DualChannelInput = {
        taskFiles: ["src/components/Header.tsx"],
        writeScope: ["src/components/Header.tsx"],
        screenshots: [
          {
            name: "header-mobile",
            path: "evidence/header-mobile.png",
            sizeBytes: 512, // Too small!
            viewport: "mobile",
            width: 375,
            height: 667,
          },
        ],
      };
      const result = analyzeDualChannel(input);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === "invalid_screenshot_size")).toBe(true);
    });

    it("accepts UI task with valid multi-viewport screenshots (>= 1024 bytes)", () => {
      const dir = scratchRoot(
        import.meta.path,
        "accepts-ui-task-with-valid-multi-viewport-screenshots",
      );
      const mobilePath = join(dir, "header-mobile.png");
      const tabletPath = join(dir, "header-tablet.png");
      const desktopPath = join(dir, "header-desktop.png");
      writeFileSync(mobilePath, createSyntheticPngBuffer(390, 844, 4096));
      writeFileSync(tabletPath, createSyntheticPngBuffer(768, 1024, 8192));
      writeFileSync(desktopPath, createSyntheticPngBuffer(1440, 900, 16384));

      const input: DualChannelInput = {
        taskFiles: ["src/components/Header.tsx"],
        writeScope: ["src/components/Header.tsx"],
        screenshots: [
          {
            name: "header-mobile",
            path: mobilePath,
            sizeBytes: 4096,
            viewport: "mobile",
            width: 390,
            height: 844,
          },
          {
            name: "header-tablet",
            path: tabletPath,
            sizeBytes: 8192,
            viewport: "tablet",
            width: 768,
            height: 1024,
          },
          {
            name: "header-desktop",
            path: desktopPath,
            sizeBytes: 16384,
            viewport: "desktop",
            width: 1440,
            height: 900,
          },
        ],
      };
      const result = analyzeDualChannel(input);
      expect(result.isUiTask).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.proofs.length).toBe(3);
    });

    it("resolves capsule-relative screenshot paths (as produced by the real ingestion/linkBlobIntoView pipeline) against a supplied runRoot", () => {
      const runRoot = scratchRoot(import.meta.path, "resolves-capsule-relative-screenshot-paths");
      const evidenceDir = join(runRoot, "evidence", "screenshots");
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(
        join(evidenceDir, "header-desktop.png"),
        createSyntheticPngBuffer(1440, 900, 4096),
      );

      const input: DualChannelInput = {
        taskFiles: ["src/components/Header.tsx"],
        writeScope: ["src/components/Header.tsx"],
        runRoot,
        screenshots: [
          {
            name: "header-desktop",
            path: "evidence/screenshots/header-desktop.png",
            sizeBytes: 4096,
            viewport: "desktop",
          },
        ],
      };
      const result = analyzeDualChannel(input);
      expect(result.findings.some((f) => f.category === "invalid_screenshot_size")).toBe(false);
      expect(result.proofs.some((p) => p.viewport === "desktop")).toBe(true);
    });

    it("does not let a capsule-relative path escape runRoot via '..' traversal", () => {
      const runRoot = scratchRoot(import.meta.path, "rejects-runroot-escaping-screenshot-paths");

      const input: DualChannelInput = {
        taskFiles: ["src/components/Header.tsx"],
        writeScope: ["src/components/Header.tsx"],
        runRoot,
        screenshots: [
          {
            name: "header-desktop",
            path: "../../../etc/passwd",
            sizeBytes: 4096,
            viewport: "desktop",
          },
        ],
      };
      const result = analyzeDualChannel(input);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === "invalid_screenshot_size")).toBe(true);
    });

    it("rejects a DOM report entry that claims a custom viewport by name alone, with no measured width to back the claim", () => {
      const input: DualChannelInput = {
        taskFiles: ["src/components/Header.tsx"],
        writeScope: ["src/components/Header.tsx"],
        requiredViewports: ["ultra-narrow-sidebar"],
        domReport: {
          viewports: [
            {
              viewport: "ultra-narrow-sidebar",
              overflowViolations: [],
              clippingViolations: [],
              stackingViolations: [],
            },
          ],
        },
      };
      const result = analyzeDualChannel(input);
      expect(result.passed).toBe(false);
      expect(result.findings.some((f) => f.category === "missing_viewport")).toBe(true);
    });

    it("accepts a DOM report entry claiming a custom viewport once it carries a genuine measured width", () => {
      const input: DualChannelInput = {
        taskFiles: ["src/components/Header.tsx"],
        writeScope: ["src/components/Header.tsx"],
        requiredViewports: ["ultra-narrow-sidebar"],
        domReport: {
          viewports: [
            {
              viewport: "ultra-narrow-sidebar",
              width: 220,
              height: 800,
              overflowViolations: [],
              clippingViolations: [],
              stackingViolations: [],
            },
          ],
        },
      };
      const result = analyzeDualChannel(input);
      expect(result.findings.some((f) => f.category === "missing_viewport")).toBe(false);
    });

    it("non-UI task skips dual-channel UI checks cleanly", () => {
      const input: DualChannelInput = {
        taskFiles: ["src/engine/scheduler.ts"],
        writeScope: ["src/engine/scheduler.ts"],
      };
      const result = analyzeDualChannel(input);
      expect(result.isUiTask).toBe(false);
      expect(result.passed).toBe(true);
      expect(result.mode).toBe("non_ui_skipped");
    });
  });

  describe("3. Anti-Leak Boundary Enforcement for Validators", () => {
    it("prohibits validators and critics from claiming task write leases", () => {
      const check = {
        agent_id: "val-mechanic-1",
        role: "validator",
        action: "task:claim",
        task_id: "task-01",
        write_scope: ["src/lib.ts"],
      };
      const result = validateBoundaryIntegrity(check);
      expect(result.valid).toBe(false);
      expect(result.violations[0]?.violation_type).toBe("validator_write_lease");
    });

    it("prohibits validators from mutating code directly", () => {
      const check = {
        agent_id: "val-ui-1",
        role: "validator",
        action: "replace_file_content",
        task_id: "task-01",
        target_file: "src/Button.tsx",
      };
      const result = validateBoundaryIntegrity(check);
      expect(result.valid).toBe(false);
      expect(result.violations[0]?.violation_type).toBe("critic_code_edit");
    });
  });

  describe("4. Anti-Batching Floor Enforcement", () => {
    it("rejects passing review covering multiple requirements with single check proof", () => {
      const task = {
        id: "task-multi",
        requirement_ids: ["REQ-01", "REQ-02"],
      } as unknown as TaskRecord;

      const review = {
        verdict: "pass" as const,
        requirement_ids: ["REQ-01", "REQ-02"],
        checks: [{ command_id: "CMD-01" }], // Only 1 check for 2 requirements!
      };

      const result = validateReviewAntiBatching(task, review);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toContain("anti-batching violation");
    });
  });
});
