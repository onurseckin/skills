import { afterAll, beforeAll, describe, expect, test, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSyntheticPngBuffer } from "../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";
import {
  analyzeDualChannel,
  isUiScope,
  validateCompanionManifestCriteria,
  type DualChannelInput,
  type ScreenshotMetadata,
  type StructuredFinding,
  type VisualMetricsReport,
} from "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts";

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies dual-channel test and source files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/types.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/file-classifier.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/semantic-depth.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/manifest-auditor.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/cross-proof.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/analyzer.ts",
      ),
      resolve(
        import.meta.dir,
        "../../../olt/scripts/src/validation/dual-channel-analyzer/index.ts",
      ),
      resolve(import.meta.dir, "dual-channel-analyzer-core.test.ts"),
    ];

    const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
    const suppressionPattern = new RegExp(
      "@ts-" +
        "ignore|@ts-" +
        "expect-error|@ts-" +
        "nocheck|eslint-" +
        "disable|oxlint-" +
        "disable",
    );

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip comment lines in invariant check itself
        if (
          line.includes("anyPattern") ||
          line.includes("suppressionPattern") ||
          line.includes("new RegExp")
        )
          continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});

describe("Ultra-Lean Packet Invariants & Fake Completion Purging Verification", () => {
  it("verifies sanitizeLeanContext purges fake completion assumptions and heavy metadata blobs", async () => {
    const { sanitizeLeanContext } =
      await import("../../../olt/scripts/src/packets/validator-context.ts");
    expect(typeof sanitizeLeanContext).toBe("function");

    const payload = {
      clean_field: "valid_value",
      assumed_complete: true,
      assumed_completion: "fake_success",
      fake_completion: "done_without_proof",
      historical_completion: "past_success",
      prior_completion_claim: "i_already_finished",
      stale_pass: true,
      unverified_success: "unverified",
      raw_events: [{ event: "big" }],
      raw_metadata: { heavy: true },
      giant_logs: "100MB_log_data",
      dependency_graph_dump: { nodes: [1, 2, 3] },
      nested: {
        safe: "ok",
        fake_completion: "nested_leak",
        stale_evidence: "old",
      },
    };

    const sanitized = sanitizeLeanContext(payload) as Record<string, unknown>;
    expect(sanitized["clean_field"]).toBe("valid_value");
    expect("assumed_complete" in sanitized).toBe(false);
    expect("assumed_completion" in sanitized).toBe(false);
    expect("fake_completion" in sanitized).toBe(false);
    expect("historical_completion" in sanitized).toBe(false);
    expect("prior_completion_claim" in sanitized).toBe(false);
    expect("stale_pass" in sanitized).toBe(false);
    expect("unverified_success" in sanitized).toBe(false);
    expect("raw_events" in sanitized).toBe(false);
    expect("raw_metadata" in sanitized).toBe(false);
    expect("giant_logs" in sanitized).toBe(false);
    expect("dependency_graph_dump" in sanitized).toBe(false);
    const nested = sanitized["nested"] as Record<string, unknown>;
    expect(nested["safe"]).toBe("ok");
    expect("fake_completion" in nested).toBe(false);
    expect("stale_evidence" in nested).toBe(false);
  });
});
