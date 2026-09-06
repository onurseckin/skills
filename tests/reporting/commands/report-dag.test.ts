import { describe, expect, it } from "bun:test";
import { reportDagCommand } from "../../../olt/scripts/src/cli/commands/reporting/index.ts";

describe("Reporting Commands - report:dag Handler", () => {
  const capsule = ".olt/capsules/dag-engine-and-reporting-separation";

  it("executes reportDagCommand without crash on default repo", () => {
    const res = reportDagCommand({ run: capsule });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
  });

  it("handles --json flag cleanly", () => {
    const res = reportDagCommand({ run: capsule, json: true });
    expect(res).toBeDefined();
    expect(typeof res).toBe("object");
  });
});
