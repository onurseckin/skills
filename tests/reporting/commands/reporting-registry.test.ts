import { describe, expect, it } from "bun:test";
import { REPORTING_COMMANDS } from "../../../olt/scripts/src/cli/registry/reporting.ts";

describe("Reporting Registry - Standardized Commands & Invariants", () => {
  it("registers report:dag as canonical Sugiyama visualizer and retires root dag", () => {
    const names = REPORTING_COMMANDS.map((c) => c.name);
    expect(names).toContain("report:dag");
    expect(names).not.toContain("dag");
  });

  it("registers report:unified with canonical alias report", () => {
    const unifiedSpec = REPORTING_COMMANDS.find((c) => c.name === "report:unified");
    expect(unifiedSpec).toBeDefined();
    expect(unifiedSpec?.aliases).toContain("report");
  });

  it("registers all core reporting commands under report domain", () => {
    const reportPrefixes = REPORTING_COMMANDS.filter((c) => c.name.startsWith("report:"));
    expect(reportPrefixes.length).toBeGreaterThanOrEqual(7);
  });
});
