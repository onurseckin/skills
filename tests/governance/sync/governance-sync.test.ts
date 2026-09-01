import { describe, expect, it } from "bun:test";
import {
  auditCaptureGovernance,
  synchronizeCaptureGovernance,
} from "../../../olt/scripts/src/platform/capture/governance-sync.ts";

describe("Platform Governance Synchronization", () => {
  it("audits capture governance state safely", () => {
    const res = auditCaptureGovernance({});
    expect(res).toBeDefined();
    expect(typeof res.compliant).toBe("boolean");
  });

  it("synchronizes capture governance state", () => {
    const res = synchronizeCaptureGovernance({});
    expect(res).toBeDefined();
  });
});
