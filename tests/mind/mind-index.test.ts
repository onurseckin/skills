import { describe, it, expect } from "bun:test";
import * as mindIndex from "../../olt/scripts/src/mind/index.ts";
import * as lanesIndex from "../../olt/scripts/src/mind/lanes/index.ts";
import * as defectsIndex from "../../olt/scripts/src/mind/defects/index.ts";

describe("mind/index and sub-domain barrel exports", () => {
  it("exports all subsystems from mind/index.ts", () => {
    expect(mindIndex.archival).toBeDefined();
    expect(mindIndex.audit).toBeDefined();
    expect(mindIndex.defectAudit).toBeDefined();
    expect(mindIndex.defects).toBeDefined();
    expect(mindIndex.brief).toBeDefined();
    expect(mindIndex.briefingBuilder).toBeDefined();
    expect(mindIndex.budget).toBeDefined();
    expect(mindIndex.cadence).toBeDefined();
    expect(mindIndex.charter).toBeDefined();
    expect(mindIndex.cognitiveFlavor).toBeDefined();
    expect(mindIndex.completedTasks).toBeDefined();
    expect(mindIndex.counterfactual).toBeDefined();
    expect(mindIndex.deploy).toBeDefined();
    expect(mindIndex.digest).toBeDefined();
    expect(mindIndex.dynamicRoles).toBeDefined();
    expect(mindIndex.feedbackQueue).toBeDefined();
    expect(mindIndex.gates).toBeDefined();
    expect(mindIndex.hyperCognition).toBeDefined();
    expect(mindIndex.interval).toBeDefined();
    expect(mindIndex.lane).toBeDefined();
    expect(mindIndex.lanes).toBeDefined();
    expect(mindIndex.lastPulse).toBeDefined();
    expect(mindIndex.liveness).toBeDefined();
    expect(mindIndex.memory).toBeDefined();
    expect(mindIndex.metaAuditor).toBeDefined();
    expect(mindIndex.mindObserve).toBeDefined();
    expect(mindIndex.profiles).toBeDefined();
    expect(mindIndex.proposal).toBeDefined();
    expect(mindIndex.pulseReclaim).toBeDefined();
    expect(mindIndex.pushbacks).toBeDefined();
    expect(mindIndex.quiesce).toBeDefined();
    expect(mindIndex.recycler).toBeDefined();
    expect(mindIndex.roleAuditing).toBeDefined();
    expect(mindIndex.rotate).toBeDefined();
    expect(mindIndex.rounds).toBeDefined();
    expect(mindIndex.selfEvolution).toBeDefined();
    expect(mindIndex.smartTaskManager).toBeDefined();
    expect(mindIndex.sources).toBeDefined();
    expect(mindIndex.strategicPurpose).toBeDefined();
    expect(mindIndex.taskDiscovery).toBeDefined();
    expect(mindIndex.taskQueue).toBeDefined();
    expect(mindIndex.value).toBeDefined();
    expect(mindIndex.watchdogManager).toBeDefined();
    expect(mindIndex.watchdogOps).toBeDefined();
    expect(mindIndex.witness).toBeDefined();
  });

  it("exports lanes repairs and rescue from mind/lanes/index.ts", () => {
    expect(lanesIndex.executeRepairLane).toBeDefined();
    expect(lanesIndex.executeRescueLane).toBeDefined();
  });

  it("exports defect utilities from mind/defects/index.ts", () => {
    expect(defectsIndex.LiveDefectDeduplicator).toBeDefined();
    expect(defectsIndex.toAggregatedDefect).toBeDefined();
    expect(defectsIndex.computeDefectDiscriminator).toBeDefined();
  });
});
