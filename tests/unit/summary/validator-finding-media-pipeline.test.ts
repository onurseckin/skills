import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapMediaAssets } from "../../../orchestrating-long-tasks/scripts/src/summary/asset-mapper.ts";
import { makeCommand, makeTask } from "./graph-fixtures.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function runRootWithLog(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "asset-mapper-"));
  roots.push(root);
  mkdirSync(join(root, "commands", "CMD-GATE"), { recursive: true });
  writeFileSync(join(root, "commands", "CMD-GATE", "stdout.log"), contents);
  return root;
}

describe("media assets come from recorded bytes", () => {
  test("extracts paths from argv and from the log file the runner actually wrote", () => {
    const runRoot = runRootWithLog(
      [
        "Running 3 tests using 1 worker",
        "  Captured artifact: test-results/dashboard/telemetry_cards.png",
        "  Captured layout audit: playwright-report/audit/layout_radial.svg",
        "  Captured video recording: test-results/dashboard/run_recording.webm",
        "  Generated document: evidence/audit_summary.pdf",
      ].join("\n"),
    );
    const task = makeTask("T-ui-dashboard", { label: "Build Telemetry Dashboard UI" });
    const command = makeCommand("CMD-GATE", {
      argv: ["playwright", "test", "tests/ui/dashboard.spec.ts", "--reporter=line"],
      task_id: "T-ui-dashboard",
      gate_id: "gate-ui-check",
      actor: "val",
      logs: {
        stdout: { path: "commands/CMD-GATE/stdout.log", bytes: 256, sha256: "a" },
        stderr: { path: "commands/CMD-GATE/stderr.log", bytes: 0, sha256: "b" },
      },
    });

    const assets = mapMediaAssets(task, [command], { runRoot });
    const byUrl = new Map(assets.map((asset) => [asset.url, asset]));

    const png = byUrl.get("test-results/dashboard/telemetry_cards.png");
    expect(png?.type).toBe("image");
    expect(png?.mimeType).toBe("image/png");
    expect(png?.metadata?.stage).toBe("validation");
    expect(png?.metadata?.commandId).toBe("CMD-GATE");

    expect(byUrl.get("playwright-report/audit/layout_radial.svg")?.type).toBe("diagram");
    expect(byUrl.get("test-results/dashboard/run_recording.webm")?.type).toBe("video");
    expect(byUrl.get("evidence/audit_summary.pdf")?.type).toBe("document");
  });

  test("finds nothing in a log the run never wrote rather than inventing an asset", () => {
    const task = makeTask("T-no-logs");
    const command = makeCommand("CMD-MISSING", {
      task_id: "T-no-logs",
      argv: ["bun", "test"],
      logs: {
        stdout: { path: "commands/CMD-MISSING/stdout.log", bytes: 900, sha256: "a" },
        stderr: { path: "commands/CMD-MISSING/stderr.log", bytes: 0, sha256: "b" },
      },
    });

    expect(mapMediaAssets(task, [command], { runRoot: "/nonexistent-run-root" })).toEqual([]);
  });

  test("scopes finding screenshots to the validator and report screenshots to the implementer", () => {
    const task = makeTask("T-media-findings", {
      status: "changes_requested",
      repair_round: 1,
      report: { summary: "done", screenshots: ["evidence/report-shot.png"] },
      validations: [
        {
          validator_id: "val-visual-inspector",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:00:00.000Z",
          deadline_at: "2026-08-15T19:10:00.000Z",
          verdict: "reject",
        },
      ],
      findings: [
        {
          id: "FINDING-THEME-01",
          requirement_id: "REQ-T-media-findings",
          severity: "critical",
          observation: "Dark mode background has low contrast",
          remediation: "Raise the contrast",
          revalidation: "Re-run the theme gate",
          status: "open",
          evidence: [],
          screenshots: ["evidence/theme-dark.png"],
        },
      ],
    });

    const implementer = mapMediaAssets(task, [], { scope: "implementer" });
    expect(implementer.map((asset) => asset.url)).toEqual(["evidence/report-shot.png"]);

    const validator = mapMediaAssets(task, [], { scope: "validator" });
    expect(validator).toHaveLength(1);
    expect(validator[0].id).toBe("FINDING-THEME-01-screenshot-1");
    expect(validator[0].url).toBe("evidence/theme-dark.png");
    expect(validator[0].author).toBe("val-visual-inspector");
    expect(validator[0].metadata?.findingId).toBe("FINDING-THEME-01");
  });

  test("a screenshot record with no type is typed from its own extension, not defaulted to image", () => {
    const task = makeTask("T-media-typed", {
      report: {
        summary: "done",
        // Neither object below carries a `type` field - exactly what a producer that only knows
        // the url writes. The recording must not be reported as an "image".
        screenshots: [{ url: "evidence/dashboard-recording.webm" }],
      },
      validations: [
        {
          validator_id: "val-visual-inspector",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:00:00.000Z",
          deadline_at: "2026-08-15T19:10:00.000Z",
          verdict: "reject",
        },
      ],
    });

    const implementer = mapMediaAssets(task, [], { scope: "implementer" });
    expect(implementer).toHaveLength(1);
    expect(implementer[0].type).toBe("video");

    const validatorTask = makeTask("T-media-typed-val", {
      validations: [
        {
          validator_id: "val-visual-inspector",
          domain: "code-quality",
          token_digest: "tok",
          attempt: 1,
          started_at: "2026-08-15T19:00:00.000Z",
          deadline_at: "2026-08-15T19:10:00.000Z",
          verdict: "reject",
          screenshots: [{ url: "evidence/gate-audit.svg" }],
        },
      ],
    });
    const validatorAssets = mapMediaAssets(validatorTask, [], { scope: "validator" });
    expect(validatorAssets).toHaveLength(1);
    expect(validatorAssets[0].type).toBe("diagram");
  });
});
