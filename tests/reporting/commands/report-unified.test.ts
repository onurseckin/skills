import { describe, expect, it } from "bun:test";
import { reportUnifiedCommand } from "../../../olt/scripts/src/cli/commands/reporting/index.ts";

describe("Reporting Commands - report:unified / report Handler", () => {
  const capsule = ".olt/capsules/dag-engine-and-reporting-separation";

  it("executes reportUnifiedCommand without crashing on current repo", () => {
    const res = reportUnifiedCommand({ run: capsule });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
  });

  it("handles --json and --detailed flags cleanly", () => {
    const res = reportUnifiedCommand({ run: capsule, json: true, detailed: true });
    expect(res).toBeDefined();
    expect(res.json).toBe(true);
  });
});
