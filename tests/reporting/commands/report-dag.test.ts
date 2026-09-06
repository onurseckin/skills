import { describe, expect, it } from "bun:test";
import { reportDagCommand } from "../../../olt/scripts/src/cli/commands/reporting/index.ts";
import { findLatestCapsuleIn } from "../../../olt/scripts/src/cli/commands/dag-view.ts";

describe("Reporting Commands - report:dag Handler", () => {
  const capsule =
    findLatestCapsuleIn(process.cwd()) ??
    ".olt/capsules/archive/dag-engine-and-reporting-separation";

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
