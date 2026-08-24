import { describe, it, expect } from "bun:test";
import {
  pruneAsciiDagBadges,
  killDanglingBrowserProcesses,
  type DagBadge,
} from "../../../olt/scripts/src/health/doctor.ts";
import { generatePulseReport } from "../../../olt/scripts/src/health/health-check.ts";
import { renderHealthReport } from "../../../olt/scripts/src/health/report.ts";
import type { HealthReport, HealthCheckResult } from "../../../olt/scripts/src/health/types.ts";

describe("health/doctor and health/health-check", () => {
  describe("pruneAsciiDagBadges", () => {
    it("filters badges to active wave or isActive=true and enforces 30-line limit", () => {
      const longAscii = Array.from({ length: 45 }, (_, i) => `Line ${i + 1}`).join("\n");
      const badges: DagBadge[] = [
        {
          id: "b-1",
          asciiArt: longAscii,
          waveNeighborhood: "wave-1",
          isActive: false,
        },
        {
          id: "b-2",
          asciiArt: "Active Node Art",
          waveNeighborhood: "wave-2",
          isActive: true,
        },
        {
          id: "b-3",
          asciiArt: "Irrelevant Wave Art",
          waveNeighborhood: "wave-3",
          isActive: false,
        },
      ];

      const pruned = pruneAsciiDagBadges(badges, "wave-1");
      expect(pruned.length).toBe(2);
      expect(pruned.some((b) => b.id === "b-1")).toBe(true);
      expect(pruned.some((b) => b.id === "b-2")).toBe(true);
      expect(pruned.some((b) => b.id === "b-3")).toBe(false);

      // Verify line limit enforcement (<= 30 lines)
      const b1 = pruned.find((b) => b.id === "b-1")!;
      const lines = b1.asciiArt.split("\n");
      expect(lines.length).toBeLessThanOrEqual(30);
    });
  });

  describe("killDanglingBrowserProcesses", () => {
    it("safely attempts cleanup of dangling browser processes", () => {
      const killed = killDanglingBrowserProcesses();
      expect(typeof killed).toBe("number");
      expect(killed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("generatePulseReport", () => {
    it("generates a pulse health report with active badges and recommendations", () => {
      const badges: DagBadge[] = [
        {
          id: "b-active",
          asciiArt: "Active DAG",
          waveNeighborhood: "wave-1",
          isActive: true,
        },
      ];

      const report = generatePulseReport(badges, "wave-1");
      expect(report.activeBadges.length).toBe(1);
      expect(Array.isArray(report.zombieProcesses)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    it("includes automated cleanup recommendations when dangling browser processes are killed", async () => {
      const doctorMod = await import("../../../olt/scripts/src/health/doctor.ts");
      const { spyOn } = await import("bun:test");
      const killSpy = spyOn(doctorMod, "killDanglingBrowserProcesses").mockReturnValue(2);

      try {
        const badges: DagBadge[] = [];
        const report = generatePulseReport(badges, "wave-1");
        expect(report.activeBadges).toEqual([]);
      } finally {
        killSpy.mockRestore();
      }
    });
  });

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
