import { describe, expect, test } from "bun:test";
import { defaultLayout } from "../../../olt/scripts/src/health/index.ts";
import { staleExemptions } from "../../../olt/scripts/src/health/vendor-identifiers.ts";
import {
  checkVendorIdentifiers,
  PRODUCT_GRAMMAR_MODULES,
} from "../../../olt/scripts/src/health/vendors.ts";

function assertNoStaleModules(root: string, modulePaths: readonly string[]): void {
  const stale = staleExemptions(root, modulePaths);
  if (stale.length > 0) {
    throw new Error(`Stale module path(s) detected under ${root}: ${stale.join(", ")}`);
  }
}

describe("Health Reporting - PRODUCT_GRAMMAR_MODULES Staleness & Invariants", () => {
  const layout = defaultLayout();

  test("PRODUCT_GRAMMAR_MODULES contains active module entries", () => {
    expect(PRODUCT_GRAMMAR_MODULES.length).toBeGreaterThan(0);
  });

  test("every entry in PRODUCT_GRAMMAR_MODULES corresponds to an existing file or directory on disk", () => {
    expect(() => assertNoStaleModules(layout.scriptsRoot, PRODUCT_GRAMMAR_MODULES)).not.toThrow();

    const stale = staleExemptions(layout.scriptsRoot, PRODUCT_GRAMMAR_MODULES);
    expect(stale).toEqual([]);

    for (const modulePath of PRODUCT_GRAMMAR_MODULES) {
      expect(staleExemptions(layout.scriptsRoot, [modulePath])).toEqual([]);
    }
  });

  describe("adversarial counterfactual validation", () => {
    const nonexistentPath = "src/phantom/adversarial-nonexistent-module.ts";
    const adversarialFixture: readonly string[] = [...PRODUCT_GRAMMAR_MODULES, nonexistentPath];

    test("assertNoStaleModules fails when a nonexistent path is added to the fixture array", () => {
      expect(() => assertNoStaleModules(layout.scriptsRoot, adversarialFixture)).toThrow(
        nonexistentPath,
      );
    });

    test("staleExemptions detects nonexistent fixture entry as stale", () => {
      const stale = staleExemptions(layout.scriptsRoot, adversarialFixture);
      expect(stale).toEqual([nonexistentPath]);
    });

    test("checkVendorIdentifiers emits a stale exemption finding for nonexistent entry", () => {
      const result = checkVendorIdentifiers([
        { label: "producer", root: layout.scriptsRoot, exempt: adversarialFixture },
      ]);
      const staleFindings = result.findings.filter(
        (finding) => finding.key === `vendor-exemption-stale:producer:${nonexistentPath}`,
      );
      expect(staleFindings.length).toBe(1);
      expect(staleFindings[0]?.file).toBe(`producer/${nonexistentPath}`);
    });
  });
});
