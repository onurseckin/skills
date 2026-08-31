import { describe, expect, it } from "bun:test";
import { isRepoPolicyCalibrated } from "../../../olt/scripts/src/mind/governance/index.ts";

describe("Governance Boundary Enforcement", () => {
  it("evaluates calibration state safely on current repo", () => {
    const cal = isRepoPolicyCalibrated(".");
    expect(typeof cal).toBe("boolean");
  });
});
