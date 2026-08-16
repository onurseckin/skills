import { describe, expect, test } from "bun:test";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import type { TaskRecord } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import {
  detectPlaywrightMetadata,
  mapMediaAssets,
} from "../../../orchestrating-long-tasks/scripts/src/summary/asset-mapper.ts";

describe("Round 3: Validator Evidence & Screenshot Asset Pipeline", () => {
  test("crawls commands argv, stdout, stderr and maps rich MediaAsset objects with metadata", () => {
    const task: TaskRecord = {
      id: "T-ui-dashboard",
      label: "Build Telemetry Dashboard UI",
      status: "done",
      requirement_ids: ["REQ-UI-01"],
      write_scope: ["src/ui/dashboard.tsx"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
    };

    const cmdGate: CommandRecord = {
      id: "CMD-GATE-PLAYWRIGHT",
      argv: ["playwright", "test", "tests/ui/dashboard.spec.ts", "--reporter=line"],
      cwd: "/repo",
      cwd_relative: ".",
      repository_root: "/repo",
      status: "succeeded",
      task_id: "T-ui-dashboard",
      gate_id: "gate-ui-check",
      actor: "val",
      started_at: "2026-08-15T19:10:00.000Z",
      finished_at: "2026-08-15T19:10:05.000Z",
      exit_code: 0,
      signal: null,
      fingerprint: "fp-playwright",
      attempt_signing_public_key: "pk-val",
      record_path: "commands/CMD-GATE-PLAYWRIGHT/record.json",
      stdout: `
Running 3 tests using 1 worker
  ✓ [chromium] › dashboard.spec.ts:12:5 › render telemetry cards (450ms)
    Captured artifact: test-results/dashboard/telemetry_cards.png
    Captured layout audit: playwright-report/audit/layout_radial.svg
    Captured video recording: test-results/dashboard/run_recording.webm
    Generated document: evidence/audit_summary.pdf
    Detailed logs: logs/test_execution.log
      `,
    };

    const assets = mapMediaAssets(task, [cmdGate]);
    expect(assets.length).toBeGreaterThanOrEqual(5);

    const pngAsset = assets.find((a) => a.url.endsWith("telemetry_cards.png"));
    expect(pngAsset).toBeDefined();
    expect(pngAsset?.type).toBe("image");
    expect(pngAsset?.mimeType).toBe("image/png");
    expect(pngAsset?.title).toBe("Test Snapshot: telemetry_cards.png");
    expect(pngAsset?.description).toContain("Captured by validator");
    expect(pngAsset?.dimensions).toEqual({ width: 1280, height: 720 });
    expect(pngAsset?.metadata?.stage).toBe("validation");
    expect(pngAsset?.metadata?.commandId).toBe("CMD-GATE-PLAYWRIGHT");

    const svgAsset = assets.find((a) => a.url.endsWith("layout_radial.svg"));
    expect(svgAsset).toBeDefined();
    expect(svgAsset?.type).toBe("diagram");
    expect(svgAsset?.mimeType).toBe("image/svg+xml");
    expect(svgAsset?.title).toBe("Validator Layout Audit: layout_radial.svg");

    const webmAsset = assets.find((a) => a.url.endsWith("run_recording.webm"));
    expect(webmAsset).toBeDefined();
    expect(webmAsset?.type).toBe("video");
    expect(webmAsset?.mimeType).toBe("video/webm");

    const pdfAsset = assets.find((a) => a.url.endsWith("audit_summary.pdf"));
    expect(pdfAsset).toBeDefined();
    expect(pdfAsset?.type).toBe("document");
    expect(pdfAsset?.mimeType).toBe("application/pdf");

    const logAsset = assets.find((a) => a.url.endsWith("test_execution.log"));
    expect(logAsset).toBeDefined();
    expect(logAsset?.type).toBe("log");
    expect(logAsset?.mimeType).toBe("text/plain");

    const pwMeta = detectPlaywrightMetadata(task, [cmdGate], assets);
    expect(pwMeta).toBeDefined();
    expect(pwMeta?.browser).toBe("chromium");
    expect(pwMeta?.status).toBe("passed");
    expect(pwMeta?.testFile).toBe("tests/ui/dashboard.spec.ts");
    expect(pwMeta?.videos).toContain("test-results/dashboard/run_recording.webm");
    expect(pwMeta?.screenshots?.length).toBeGreaterThanOrEqual(1);
  });

  test("maps task finding screenshots into media assets with dimensions, title, and author", () => {
    const task: TaskRecord = {
      id: "T-media-findings",
      label: "Visual Regression Check",
      status: "changes_requested",
      requirement_ids: ["REQ-VR-01"],
      write_scope: ["src/ui/theme.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 1,
      validation: {
        validator_id: "val-visual-inspector",
        verdict: "reject",
      },
      findings: [
        {
          id: "FINDING-THEME-01",
          observation: "Dark mode background has low contrast",
          screenshots: ["evidence/theme-dark.png"],
        },
      ],
    };

    const assets = mapMediaAssets(task, []);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset.id).toBe("FINDING-THEME-01-screenshot-1");
    expect(asset.type).toBe("image");
    expect(asset.url).toBe("evidence/theme-dark.png");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.dimensions).toEqual({ width: 1280, height: 720 });
    expect(asset.author).toBe("val-visual-inspector");
    expect(asset.metadata?.findingId).toBe("FINDING-THEME-01");
    expect(asset.metadata?.stage).toBe("validation");
  });
});
