import { describe, expect, test } from "bun:test";
import { extractDomViolations } from "../../../orchestrating-long-tasks/scripts/src/validation/dom-violation-extractor.ts";
import type { VisualMetricsReport } from "../../../orchestrating-long-tasks/scripts/src/validation/dual-channel-types.ts";

interface RecordedFinding {
  category: string;
  severity: string;
  message: string;
  remediation: string;
  affectedSelector?: string;
  viewport?: string;
}

function recorder(): {
  findings: RecordedFinding[];
  add: Parameters<typeof extractDomViolations>[1];
} {
  const findings: RecordedFinding[] = [];
  return {
    findings,
    add: (category, severity, message, remediation, affectedSelector, viewport) => {
      findings.push({ category, severity, message, remediation, affectedSelector, viewport });
    },
  };
}

describe("extractDomViolations", () => {
  test("flags a run-wide render cache that was not reset before capture", () => {
    const report: VisualMetricsReport = { renderCacheReset: false, viewports: [] };
    const { findings, add } = recorder();
    extractDomViolations(report, add);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe("render_cache");
    expect(findings[0]?.message).toContain("Layout render cache was not reset");
  });

  test("flags a per-viewport render cache that was not reset for that viewport specifically", () => {
    const report: VisualMetricsReport = {
      renderCacheReset: true,
      viewports: [{ viewport: "mobile", renderCacheReset: false }],
    };
    const { findings, add } = recorder();
    extractDomViolations(report, add);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      category: "render_cache",
      viewport: "mobile",
    });
    expect(findings[0]?.message).toContain("not reset for viewport 'mobile'");
  });

  test("reports a genuine text-clipping violation (not just a malformed one)", () => {
    const report: VisualMetricsReport = {
      viewports: [
        {
          viewport: "mobile",
          clippingViolations: [
            { selector: ".caption", scrollHeight: 40, clientHeight: 20, viewport: "mobile" },
          ],
        },
      ],
    };
    const { findings, add } = recorder();
    extractDomViolations(report, add);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "clipping", affectedSelector: ".caption" });
    expect(findings[0]?.message).toContain("Text clipping detected");
    expect(findings[0]?.message).toContain("scrollHeight (40px) > clientHeight (20px)");
  });

  test("prefers a violation's own message over the generated one when present", () => {
    const report: VisualMetricsReport = {
      viewports: [
        {
          viewport: "mobile",
          clippingViolations: [
            {
              selector: ".caption",
              scrollHeight: 40,
              clientHeight: 20,
              viewport: "mobile",
              message: "custom clipping report",
            },
          ],
        },
      ],
    };
    const { findings, add } = recorder();
    extractDomViolations(report, add);
    expect(findings[0]?.message).toBe("custom clipping report");
  });

  test("reports a genuine WCAG contrast violation (not just a malformed one)", () => {
    const report: VisualMetricsReport = {
      viewports: [
        {
          viewport: "desktop",
          contrastViolations: [
            {
              selector: ".label",
              textColor: "#777",
              backgroundColor: "#fff",
              contrastRatio: 2.1,
              requiredRatio: 4.5,
              wcagLevel: "AA",
            },
          ],
        },
      ],
    };
    const { findings, add } = recorder();
    extractDomViolations(report, add);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "contrast", affectedSelector: ".label" });
    expect(findings[0]?.message).toContain("WCAG AA contrast ratio violation");
    expect(findings[0]?.message).toContain("ratio 2.1:1 is below required 4.5:1");
  });
});
