import { describe, expect, test } from "bun:test";
import {
  inspectCommandReceipts,
  inspectMilestoneEvents,
  verifyEventsHashChain,
  verifyMilestoneEvidence,
} from "../../../olt/scripts/src/authority/evidence/index.ts";
import {
  inspectCommandReceipts as directInspectReceipts,
  inspectMilestoneEvents as directInspectEvents,
  verifyEventsHashChain as directVerifyHashChain,
  verifyMilestoneEvidence as directVerifyEvidence,
} from "../../../olt/scripts/src/authority/evidence/receipt-verifier.ts";

describe("Authority Evidence Subsystem (authority/evidence)", () => {
  test("re-exports all milestone evidence verification functions cleanly", () => {
    expect(typeof verifyMilestoneEvidence).toBe("function");
    expect(typeof verifyEventsHashChain).toBe("function");
    expect(typeof inspectCommandReceipts).toBe("function");
    expect(typeof inspectMilestoneEvents).toBe("function");

    expect(verifyMilestoneEvidence).toBe(directVerifyEvidence);
    expect(verifyEventsHashChain).toBe(directVerifyHashChain);
    expect(inspectCommandReceipts).toBe(directInspectReceipts);
    expect(inspectMilestoneEvents).toBe(directInspectEvents);
  });
});
