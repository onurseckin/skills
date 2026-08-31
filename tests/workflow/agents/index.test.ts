import { describe, expect, test } from "bun:test";
import * as agentsIndex from "../../../olt/scripts/src/workflow/agents/index.ts";

describe("workflow/agents/index exports", () => {
  test("re-exports all expected agent workflow modules and functions", () => {
    expect(agentsIndex.registerAgentGrant).toBeFunction();
    expect(agentsIndex.recordAgentReport).toBeFunction();
    expect(agentsIndex.releaseAgentGrant).toBeFunction();
    expect(agentsIndex.readAgentLedger).toBeFunction();
    expect(agentsIndex.writeAgentLedger).toBeFunction();
    expect(agentsIndex.findGrant).toBeFunction();
    expect(agentsIndex.requireGrant).toBeFunction();
    expect(agentsIndex.replaceGrant).toBeFunction();
    expect(agentsIndex.assertAgentBudget).toBeFunction();
    expect(agentsIndex.knownTaskIds).toBeFunction();
    expect(agentsIndex.releaseGrantInLedger).toBeFunction();
    expect(agentsIndex.releaseAllActiveGrants).toBeFunction();
    expect(agentsIndex.ancestorChain).toBeFunction();
    expect(agentsIndex.childrenOf).toBeFunction();
    expect(agentsIndex.taskLineage).toBeFunction();
    expect(agentsIndex.executeAgentReset).toBeFunction();
    expect(agentsIndex.formatAgentResetBrief).toBeFunction();
    expect(agentsIndex.mergeDerivedField).toBeFunction();
    expect(agentsIndex.mergeObservedCount).toBeFunction();
    expect(agentsIndex.mergeObservedExtras).toBeFunction();
    expect(agentsIndex.mergeObservedTools).toBeFunction();
    expect(agentsIndex.transcriptAuditContext).toBeFunction();
    expect(agentsIndex.checkParentAgentConflict).toBeFunction();
    expect(agentsIndex.appendTelemetryConflicts).toBeFunction();
    expect(agentsIndex.applyDerivedTelemetry).toBeFunction();
    expect(agentsIndex.refreshAgentDerivedTelemetry).toBeFunction();
    expect(agentsIndex.readAgentTranscriptTelemetry).toBeFunction();
  });
});
