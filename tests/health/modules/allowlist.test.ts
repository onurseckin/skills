import { afterAll, describe, expect, test } from "bun:test";
import {
  ALLOWED_FINDINGS,
  applyAllowances,
  assertAllowancesHaveReasons,
} from "../../../olt/scripts/src/health/allowlist.ts";
import { renderHealthReport } from "../../../olt/scripts/src/health/report.ts";
import { advisory, finding } from "../../../olt/scripts/src/health/types.ts";
import type { HealthCheckResult } from "../../../olt/scripts/src/health/types.ts";
import { cleanupTempRoots } from "../fixture.ts";

afterAll(cleanupTempRoots);

function results(): HealthCheckResult[] {
  return [
    {
      check: "unused-code",
      title: "Unused code",
      scanned: 2,
      limitations: ["lexical only"],
      findings: [
        finding("unused-code", "unused-export:a.ts#one", "a.ts", "no caller", 3),
        finding("unused-code", "unused-export:b.ts#two", "b.ts", "no caller"),
        advisory("unused-code", "unused-export:c.ts#Shape", "c.ts", "type only"),
      ],
    },
  ];
}

describe("Health Modules - Allowlist & Opt-Out Management", () => {
  describe("the opt-out list excuses code, and every entry says why", () => {
    test("an allowance without a reason is refused", () => {
      expect(() =>
        assertAllowancesHaveReasons([{ check: "unused-code", key: "x", reason: "  " }]),
      ).toThrow("health allowance without a reason");
    });

    test("every checked-in allowance carries a reason", () => {
      expect(() => assertAllowancesHaveReasons()).not.toThrow();
      expect(ALLOWED_FINDINGS.every((entry) => entry.reason.trim().length > 20)).toBe(true);
    });

    test("an allowed finding is still reported, and carries the reason it was allowed", () => {
      const { checks } = applyAllowances(results(), [
        { check: "unused-code", key: "unused-export:a.ts#one", reason: "the process entry point" },
      ]);
      const allowed = checks[0]?.findings.find((entry) => entry.key === "unused-export:a.ts#one");
      expect(allowed?.acknowledged).toBe("the process entry point");
      expect(checks[0]?.findings).toHaveLength(3);
    });

    test("a prefix allowance covers a family without naming each member", () => {
      const { checks } = applyAllowances(results(), [
        {
          check: "unused-code",
          key: "unused-export:*",
          reason: "the whole export surface is public API here",
        },
      ]);
      expect(checks[0]?.findings.every((entry) => entry.acknowledged !== undefined)).toBe(true);
    });

    test("an allowance that matches nothing is itself a finding", () => {
      const { stale } = applyAllowances(results(), [
        { check: "unused-code", key: "unused-export:gone.ts#absent", reason: "fixed long ago" },
      ]);
      expect(stale).toHaveLength(1);
      expect(stale[0]?.detail).toContain("matches no finding");
    });

    test("an allowance for a check this run never requested is not reported stale", () => {
      const { stale } = applyAllowances(results(), [
        { check: "vendor-identifiers", key: "vendor-identifier:x.ts#Vendor", reason: "unrelated" },
      ]);
      expect(stale).toEqual([]);
    });

    test("an unrelated finding is untouched", () => {
      const { checks } = applyAllowances(results(), [
        { check: "unused-code", key: "unused-export:a.ts#one", reason: "the process entry point" },
      ]);
      expect(checks[0]?.findings[1]?.acknowledged).toBeUndefined();
    });

    test("an allowance does not cross-suppress an identical key from a different check", () => {
      const collidingKey = "same-key-different-check";
      const twoChecks: HealthCheckResult[] = [
        {
          check: "unused-code",
          title: "Unused code",
          scanned: 1,
          limitations: [],
          findings: [finding("unused-code", collidingKey, "a.ts", "no caller")],
        },
        {
          check: "literal-fallbacks",
          title: "Literal fallbacks",
          scanned: 1,
          limitations: [],
          findings: [finding("literal-fallbacks", collidingKey, "b.ts", "plausible literal")],
        },
      ];
      const { checks } = applyAllowances(twoChecks, [
        { check: "unused-code", key: collidingKey, reason: "excused for unused-code only" },
      ]);
      expect(checks[0]?.findings[0]?.acknowledged).toBe("excused for unused-code only");
      expect(checks[1]?.findings[0]?.acknowledged).toBeUndefined();
    });

    test("staleness is scoped by check too: a key match under the wrong check is not a use", () => {
      const collidingKey = "same-key-different-check";
      const twoChecks: HealthCheckResult[] = [
        {
          check: "unused-code",
          title: "Unused code",
          scanned: 1,
          limitations: [],
          findings: [finding("unused-code", collidingKey, "a.ts", "no caller")],
        },
        {
          check: "literal-fallbacks",
          title: "Literal fallbacks",
          scanned: 1,
          limitations: [],
          findings: [],
        },
      ];
      const { stale } = applyAllowances(twoChecks, [
        { check: "literal-fallbacks", key: collidingKey, reason: "wrong check on purpose" },
      ]);
      expect(stale).toHaveLength(1);
    });

    test("a real match on one check does not mark a same-keyed allowance for a different check as used", () => {
      const collidingKey = "same-key-different-check-both-present";
      const twoChecks: HealthCheckResult[] = [
        {
          check: "unused-code",
          title: "Unused code",
          scanned: 1,
          limitations: [],
          findings: [finding("unused-code", collidingKey, "a.ts", "no caller")],
        },
        {
          check: "literal-fallbacks",
          title: "Literal fallbacks",
          scanned: 1,
          limitations: [],
          findings: [],
        },
      ];
      const { checks, stale } = applyAllowances(twoChecks, [
        {
          check: "unused-code",
          key: collidingKey,
          reason: "genuinely excuses the unused-code finding",
        },
        {
          check: "literal-fallbacks",
          key: collidingKey,
          reason: "stale: nothing under this check matches",
        },
      ]);
      expect(checks[0]?.findings[0]?.acknowledged).toBe(
        "genuinely excuses the unused-code finding",
      );
      expect(stale).toHaveLength(1);
      expect(stale[0]?.detail).toContain(collidingKey);
    });
  });

  describe("the rendered report separates what failed from what was allowed", () => {
    const report = {
      healthy: false,
      checks: applyAllowances(results(), [
        { check: "unused-code", key: "unused-export:a.ts#one", reason: "the process entry point" },
      ]).checks,
      failure_count: 1,
      advisory_count: 1,
      acknowledged_count: 1,
      skipped: [{ check: "intent-drift" as const, reason: "no requirement documents" }],
    };

    test("the verdict, the counts and the skipped checks are all printed", () => {
      const markdown = renderHealthReport(report, "/repo");
      expect(markdown).toContain("UNHEALTHY");
      expect(markdown).toContain("**Failures**: 1");
      expect(markdown).toContain("no requirement documents");
      expect(markdown).toContain("lexical only");
      expect(markdown).toContain("_(allowed: the process entry point)_");
    });

    test("a healthy report says so", () => {
      expect(renderHealthReport({ ...report, healthy: true, failure_count: 0 }, "/repo")).toContain(
        "**Verdict**: healthy",
      );
    });

    test("the listing is bounded by default and complete with --all", () => {
      const many = {
        ...report,
        checks: [
          {
            check: "unused-code" as const,
            title: "Unused code",
            scanned: 9,
            limitations: [],
            findings: Array.from({ length: 9 }, (_, index) =>
              finding("unused-code", `k${index}`, `f${index}.ts`, "no caller"),
            ),
          },
        ],
      };
      expect(renderHealthReport(many, "/repo")).toContain("4 more failure(s)");
      expect(renderHealthReport(many, "/repo", true)).not.toContain("more failure(s)");
      expect(renderHealthReport(many, "/repo", true)).toContain("f8.ts");
    });

    test("a finding with a line number prints it", () => {
      expect(renderHealthReport(report, "/repo")).toContain("`a.ts:3`");
    });

    test("an advisory is counted always and listed on request", () => {
      expect(renderHealthReport(report, "/repo")).not.toContain("type only");
      expect(renderHealthReport(report, "/repo", true)).toContain("type only");
    });
  });
});
