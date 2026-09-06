import { describe, expect, it } from "bun:test";
import { REPORTING_COMMANDS } from "../../../olt/scripts/src/cli/registry/index.ts";

describe("Reporting Registry - Standardized Commands & Invariants", () => {
  it("registers report:dag as canonical Sugiyama visualizer and retires root dag", () => {
    const names = REPORTING_COMMANDS.map((c) => c.name);
    expect(names).toContain("report:dag");
    expect(names).not.toContain("dag");
  });

  it("registers report as canonical with zero aliases", () => {
    const reportSpec = REPORTING_COMMANDS.find((c) => c.name === "report");
    expect(reportSpec).toBeDefined();
    expect(reportSpec?.aliases).toEqual([]);
  });

  it("registers all core reporting commands under report domain", () => {
    const reportPrefixes = REPORTING_COMMANDS.filter(
      (c) => c.name === "report" || c.name.startsWith("report:"),
    );
    expect(reportPrefixes.length).toBeGreaterThanOrEqual(7);
  });
});
