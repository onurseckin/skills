import { describe, it, expect } from "bun:test";
import { renderHealthReport } from "../../olt/scripts/src/health/report.ts";
import type { HealthReport, HealthCheckResult } from "../../olt/scripts/src/health/types.ts";

describe("health/report", () => {
  describe("renderHealthReport", () => {
    it("renders complete health report with failures, advisories, allowed, skipped and all=true", () => {
      const checkResult: HealthCheckResult = {
        check: "test_check",
        title: "Test Health Check",
        passed: false,
        scanned: 10,
        findings: [
          {
            file: "src/file1.ts",
            line: 42,
            detail: "Unchecked type cast",
            severity: "failure",
          },
          {
            file: "src/file2.ts",
            detail: "Legacy comment",
            severity: "advisory",
          },
          {
            file: "src/file3.ts",
            line: 10,
            detail: "Exempted rule",
            severity: "failure",
            acknowledged: "Exemption approved in RFC-12",
          },
        ],
        limitations: ["Cannot check dynamic imports"],
      };

      const report: HealthReport = {
        healthy: false,
        failure_count: 1,
        advisory_count: 1,
        acknowledged_count: 1,
        checks: [checkResult],
        skipped: [{ check: "skipped_check", reason: "Disabled in config" }],
      };

      const renderedDefault = renderHealthReport(report, "/repo/path", false);
      expect(renderedDefault).toContain("### Semantic Health: `/repo/path`");
      expect(renderedDefault).toContain("UNHEALTHY");
      expect(renderedDefault).toContain("src/file1.ts:42");
      expect(renderedDefault).toContain("Exemption approved in RFC-12");
      expect(renderedDefault).toContain("Cannot check dynamic imports");
      expect(renderedDefault).toContain("`skipped_check`: Disabled in config");

      const renderedAll = renderHealthReport(report, "/repo/path", true);
      expect(renderedAll).toContain("src/file2.ts");
    });

    it("renders healthy report with 0 failures", () => {
      const checkResult: HealthCheckResult = {
        check: "clean_check",
        title: "Clean Check",
        passed: true,
        scanned: 5,
        findings: [],
        limitations: [],
      };

      const report: HealthReport = {
        healthy: true,
        failure_count: 0,
        advisory_count: 0,
        acknowledged_count: 0,
        checks: [checkResult],
        skipped: [],
      };

      const rendered = renderHealthReport(report, "/repo/path");
      expect(rendered).toContain("**Verdict**: healthy");
      expect(rendered).not.toContain("UNHEALTHY");
    });
  });
});
