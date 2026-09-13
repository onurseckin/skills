import { describe, expect, it } from "bun:test";
import type { Violation } from "../../scripts/modularity/core/contracts.ts";
import {
  assertNoPhantomPaths,
  buildBaselineDocument,
  compareViolations,
} from "../../scripts/modularity/baseline/generate.ts";

describe("modularity baseline generator (pure in-memory)", () => {
  describe("compareViolations", () => {
    it("sorts by rule name alphabetically", () => {
      const v1: Violation = {
        rule: "directory_fanout",
        path: "src/a.ts",
        observed: 15,
        detail: "Exceeds fanout",
      };
      const v2: Violation = {
        rule: "line_limit",
        path: "src/a.ts",
        observed: 450,
        detail: "Exceeds lines",
      };
      expect(compareViolations(v1, v2)).toBeLessThan(0);
      expect(compareViolations(v2, v1)).toBeGreaterThan(0);
    });

    it("sorts by path when rules are identical", () => {
      const v1: Violation = {
        rule: "line_limit",
        path: "src/alpha.ts",
        observed: 450,
        detail: "Exceeds lines",
      };
      const v2: Violation = {
        rule: "line_limit",
        path: "src/beta.ts",
        observed: 450,
        detail: "Exceeds lines",
      };
      expect(compareViolations(v1, v2)).toBeLessThan(0);
      expect(compareViolations(v2, v1)).toBeGreaterThan(0);
    });

    it("sorts by observed value string when rule and path match", () => {
      const v1: Violation = {
        rule: "facade_bypass",
        path: "src/a.ts",
        observed: "target/bar.ts",
        detail: "Bypass",
      };
      const v2: Violation = {
        rule: "facade_bypass",
        path: "src/a.ts",
        observed: "target/foo.ts",
        detail: "Bypass",
      };
      expect(compareViolations(v1, v2)).toBeLessThan(0);
      expect(compareViolations(v2, v1)).toBeGreaterThan(0);
    });

    it("sorts by detail when rule, path, and observed match", () => {
      const v1: Violation = {
        rule: "missing_facade",
        path: "src/sub",
        observed: "missing index.ts",
        detail: "Detail A",
      };
      const v2: Violation = {
        rule: "missing_facade",
        path: "src/sub",
        observed: "missing index.ts",
        detail: "Detail B",
      };
      expect(compareViolations(v1, v2)).toBeLessThan(0);
      expect(compareViolations(v2, v1)).toBeGreaterThan(0);
    });

    it("returns 0 for identical violation tuples", () => {
      const v1: Violation = {
        rule: "export_star",
        path: "src/index.ts",
        observed: "export * from './mod.ts'",
        detail: "Export star forbidden",
      };
      const v2: Violation = {
        rule: "export_star",
        path: "src/index.ts",
        observed: "export * from './mod.ts'",
        detail: "Export star forbidden",
      };
      expect(compareViolations(v1, v2)).toBe(0);
    });

    it("handles special characters, unicode, and commas in observed safely", () => {
      const v1: Violation = {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/b.ts,src/c.ts",
        detail: "Cycle component",
      };
      const v2: Violation = {
        rule: "dependency_cycle",
        path: "src/a.ts",
        observed: "src/a.ts,src/z.ts",
        detail: "Cycle component",
      };
      expect(compareViolations(v1, v2)).toBeLessThan(0);
      expect(compareViolations(v2, v1)).toBeGreaterThan(0);
    });
  });

  describe("buildBaselineDocument", () => {
    it("builds empty baseline document for empty violations array", () => {
      const baseline = buildBaselineDocument([]);
      expect(baseline.schema).toBe("olt-modularity-baseline/v1");
      expect(baseline.violations).toEqual([]);
    });

    it("deduplicates identical violation objects", () => {
      const v: Violation = {
        rule: "line_limit",
        path: "src/large.ts",
        observed: 420,
        detail: "File exceeds line limit",
      };
      const baseline = buildBaselineDocument([v, { ...v }, v]);
      expect(baseline.violations.length).toBe(1);
      expect(baseline.violations[0]).toEqual(v);
    });

    it("sorts violations deterministically regardless of input order", () => {
      const v1: Violation = {
        rule: "directory_fanout",
        path: "src/commands",
        observed: 12,
        detail: "Fanout",
      };
      const v2: Violation = {
        rule: "export_star",
        path: "src/lib.ts",
        observed: "*",
        detail: "Export star",
      };
      const v3: Violation = {
        rule: "line_limit",
        path: "src/big.ts",
        observed: 500,
        detail: "Too big",
      };

      const docA = buildBaselineDocument([v3, v1, v2]);
      const docB = buildBaselineDocument([v2, v3, v1]);

      expect(docA.violations).toEqual(docB.violations);
      expect(docA.violations.map((x) => x.rule)).toEqual([
        "directory_fanout",
        "export_star",
        "line_limit",
      ]);
    });

    it("supports multiple distinct rules on the same file path", () => {
      const v1: Violation = {
        rule: "export_star",
        path: "src/multi.ts",
        observed: "export * from './b'",
        detail: "Export star",
      };
      const v2: Violation = {
        rule: "line_limit",
        path: "src/multi.ts",
        observed: 410,
        detail: "Line limit",
      };
      const doc = buildBaselineDocument([v2, v1]);
      expect(doc.violations.length).toBe(2);
      expect(doc.violations[0]?.rule).toBe("export_star");
      expect(doc.violations[1]?.rule).toBe("line_limit");
    });

    it("sorts mixed staged violation rules deterministically", () => {
      const v1: Violation = {
        rule: "dependency_cycle",
        path: "olt/scripts/src/agents/supervision/role-boundary-verifier.ts",
        observed:
          "olt/scripts/src/agents/supervision/role-boundary-verifier.ts,olt/scripts/src/agents/supervision/tier0-confinement.ts",
        detail: "Import graph contains a strongly connected component.",
      };
      const v2: Violation = {
        rule: "directory_fanout",
        path: "olt/scripts/src/agents/fleet",
        observed: 11,
        detail: "Directory exceeds the 10 direct-file limit.",
      };
      const v3: Violation = {
        rule: "facade_bypass",
        path: "olt/scripts/src/reporting/doctor/optical/engine.ts",
        observed: "olt/scripts/src/reporting/doctor/types.ts",
        detail: "Cross-directory import must target the destination index.ts facade.",
      };
      const v4: Violation = {
        rule: "line_limit",
        path: "olt/scripts/src/cli/commands/task-check.ts",
        observed: 1627,
        detail: "File exceeds the 400 physical-line limit.",
      };

      const doc = buildBaselineDocument([v4, v3, v1, v2]);
      expect(doc.violations.map((v) => v.rule)).toEqual([
        "dependency_cycle",
        "directory_fanout",
        "facade_bypass",
        "line_limit",
      ]);
    });
  });

  describe("assertNoPhantomPaths", () => {
    it("passes for empty baseline and empty blobs", () => {
      expect(() => {
        assertNoPhantomPaths({ schema: "olt-modularity-baseline/v1", violations: [] }, []);
      }).not.toThrow();
    });

    it("passes when all violation paths and targets exist in blobs", () => {
      const baseline = {
        schema: "olt-modularity-baseline/v1" as const,
        violations: [
          {
            rule: "line_limit" as const,
            path: "src/file.ts",
            observed: 450,
            detail: "exceeds limit",
          },
          {
            rule: "missing_facade" as const,
            path: "src/dir",
            observed: "missing index.ts",
            detail: "facade missing",
          },
          {
            rule: "facade_bypass" as const,
            path: "src/caller.ts",
            observed: "src/target.ts",
            detail: "bypass",
          },
        ],
      };
      const blobs = [
        { path: "src/file.ts" },
        { path: "src/dir/mod.ts" },
        { path: "src/caller.ts" },
        { path: "src/target.ts" },
      ];
      expect(() => assertNoPhantomPaths(baseline, blobs)).not.toThrow();
    });

    it("throws when a violation file path does not exist in blobs", () => {
      const baseline = {
        schema: "olt-modularity-baseline/v1" as const,
        violations: [
          {
            rule: "line_limit" as const,
            path: "nonexistent/ghost.ts",
            observed: 500,
            detail: "ghost line",
          },
        ],
      };
      expect(() => assertNoPhantomPaths(baseline, [{ path: "src/index.ts" }])).toThrow(
        /phantom path\(s\) not found in audited blob set/,
      );
    });

    it("throws when a facade_bypass target does not exist in blobs", () => {
      const baseline = {
        schema: "olt-modularity-baseline/v1" as const,
        violations: [
          {
            rule: "facade_bypass" as const,
            path: "src/caller.ts",
            observed: "src/deleted-target.ts",
            detail: "bypass target phantom",
          },
        ],
      };
      const blobs = [{ path: "src/caller.ts" }];
      expect(() => assertNoPhantomPaths(baseline, blobs)).toThrow(
        /bypass target "src\/deleted-target\.ts" in "src\/caller\.ts"/,
      );
    });

    it("throws when a dependency_cycle node does not exist in blobs", () => {
      const baseline = {
        schema: "olt-modularity-baseline/v1" as const,
        violations: [
          {
            rule: "dependency_cycle" as const,
            path: "src/cycle-a.ts",
            observed: "src/cycle-a.ts,src/ghost-cycle-b.ts",
            detail: "cycle component",
          },
        ],
      };
      const blobs = [{ path: "src/cycle-a.ts" }];
      expect(() => assertNoPhantomPaths(baseline, blobs)).toThrow(
        /cycle node "src\/ghost-cycle-b\.ts" in "src\/cycle-a\.ts"/,
      );
    });

    it("formats truncation message when more than 10 phantoms exist", () => {
      const violations: Violation[] = [];
      for (let i = 1; i <= 12; i += 1) {
        violations.push({
          rule: "line_limit",
          path: `ghost/file${i}.ts`,
          observed: 500,
          detail: "ghost",
        });
      }
      const baseline = {
        schema: "olt-modularity-baseline/v1" as const,
        violations,
      };
      expect(() => assertNoPhantomPaths(baseline, [])).toThrow(/\(and 2 more\)/);
    });
  });
});
