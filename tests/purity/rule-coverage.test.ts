import { describe, expect, it } from "bun:test";
import type { Violation } from "../../scripts/modularity/core/contracts.ts";
import { compareBaseline } from "../../scripts/modularity/policy/compare.ts";
import type { ModularityBaseline } from "../../scripts/modularity/policy/baseline.ts";

function createBaseline(violations: Violation[]): ModularityBaseline {
  return {
    schema: "olt-modularity-baseline/v1",
    violations,
  };
}

describe("modularity rules ratchet coverage (pure in-memory)", () => {
  describe("export_star", () => {
    const v: Violation = {
      rule: "export_star",
      path: "src/barrel.ts",
      observed: "export * from './internal.ts'",
      detail: "export-star forbidden",
    };

    it("passes when export_star violation is baselined", () => {
      const res = compareBaseline(createBaseline([v]), createBaseline([{ ...v }]));
      expect(res.passed).toBe(true);
      expect(res.baselineDelta.added).toEqual([]);
      expect(res.baselineDelta.worsened).toEqual([]);
    });

    it("fails when an unbaselined export_star is added", () => {
      const res = compareBaseline(createBaseline([]), createBaseline([v]));
      expect(res.passed).toBe(false);
      expect(res.baselineDelta.added).toEqual([v]);
    });

    it("records resolved when export_star is eliminated", () => {
      const res = compareBaseline(createBaseline([v]), createBaseline([]));
      expect(res.passed).toBe(true);
      expect(res.baselineDelta.resolved).toEqual([v]);
    });
  });

  describe("facade_bypass", () => {
    const bypassA: Violation = {
      rule: "facade_bypass",
      path: "src/caller.ts",
      observed: "src/domain/internal.ts",
      detail: "Cross-directory import must target index.ts facade",
    };
    const bypassB: Violation = {
      rule: "facade_bypass",
      path: "src/caller.ts",
      observed: "src/domain/helper.ts",
      detail: "Cross-directory import must target index.ts facade",
    };

    it("differentiates multiple facade bypasses from the same caller file", () => {
      const baseline = createBaseline([bypassA]);
      const current = createBaseline([bypassA, bypassB]);
      const res = compareBaseline(baseline, current);

      expect(res.passed).toBe(false);
      expect(res.baselineDelta.added).toEqual([bypassB]);
      expect(res.baselineDelta.worsened).toEqual([]);
    });

    it("passes when all facade bypasses match the baseline", () => {
      const baseline = createBaseline([bypassA, bypassB]);
      const current = createBaseline([bypassA, bypassB]);
      const res = compareBaseline(baseline, current);

      expect(res.passed).toBe(true);
      expect(res.baselineDelta.added).toEqual([]);
    });
  });

  describe("root_no_growth", () => {
    const rootViolation: Violation = {
      rule: "root_no_growth",
      path: ".",
      observed: "unapproved-root-file.txt",
      detail: "Root directory may not grow new top-level entries",
    };

    it("fails ratchet gate when a new unapproved root file appears", () => {
      const res = compareBaseline(createBaseline([]), createBaseline([rootViolation]));
      expect(res.passed).toBe(false);
      expect(res.baselineDelta.added).toEqual([rootViolation]);
    });

    it("tolerates existing baselined root violation without failing", () => {
      const res = compareBaseline(
        createBaseline([rootViolation]),
        createBaseline([{ ...rootViolation }]),
      );
      expect(res.passed).toBe(true);
      expect(res.baselineDelta.added).toEqual([]);
    });

    it("marks resolved when baselined root file is cleaned up", () => {
      const res = compareBaseline(createBaseline([rootViolation]), createBaseline([]));
      expect(res.passed).toBe(true);
      expect(res.baselineDelta.resolved).toEqual([rootViolation]);
    });
  });

  describe("generated_catalog", () => {
    const catalogViolation: Violation = {
      rule: "generated_catalog",
      path: "olt/references/cli-capabilities/commands/new-domain",
      observed: "missing manifest.json",
      detail: "Generated CLI directory requires a catalog index",
    };

    it("detects added generated_catalog violation", () => {
      const res = compareBaseline(createBaseline([]), createBaseline([catalogViolation]));
      expect(res.passed).toBe(false);
      expect(res.baselineDelta.added).toEqual([catalogViolation]);
    });

    it("marks catalog violation resolved when catalog is generated", () => {
      const res = compareBaseline(createBaseline([catalogViolation]), createBaseline([]));
      expect(res.passed).toBe(true);
      expect(res.baselineDelta.resolved).toEqual([catalogViolation]);
    });
  });

  describe("non-numeric observed rules ratchet invariant", () => {
    it("never treats changed non-numeric observed strings as worsened (treats as new identity)", () => {
      const original: Violation = {
        rule: "missing_facade",
        path: "src/components",
        observed: "missing index.ts",
        detail: "Facade required",
      };
      const altered: Violation = {
        rule: "missing_facade",
        path: "src/components",
        observed: "corrupt index.ts",
        detail: "Facade required",
      };

      const baseline = createBaseline([original]);
      const current = createBaseline([altered]);
      const res = compareBaseline(baseline, current);

      // Non-numeric observed change changes identity key -> resolved original + added altered
      expect(res.passed).toBe(false);
      expect(res.baselineDelta.worsened).toEqual([]);
      expect(res.baselineDelta.added).toEqual([altered]);
      expect(res.baselineDelta.resolved).toEqual([original]);
    });
  });
});
