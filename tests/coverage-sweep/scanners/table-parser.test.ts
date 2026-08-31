import { describe, expect, test } from "bun:test";
import { parseCoverageTable } from "../../../olt/scripts/src/cli/commands/coverage-check.ts";
import { createSampleCoverageTableRow } from "../fixtures/index.ts";

describe("coverage sweep gap tests: coverage check table parser edge cases", () => {
  test("parseCoverageTable handles various row formats and empty inputs", () => {
    expect(parseCoverageTable("")).toEqual([]);
    expect(parseCoverageTable("random non matching text")).toEqual([]);

    const singleRow = createSampleCoverageTableRow();
    const parsed = parseCoverageTable(singleRow);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.file).toBe("src/lib/index.ts");
    expect(parsed[0]?.lines).toBe(0.955);
    expect(parsed[0]?.statements).toBe(0.972);
  });
});
