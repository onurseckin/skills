import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  auditCumulativeSocraticProgression,
  auditErgonomicWalkthrough,
  auditInnovationPortfolio702010,
  auditPreDeclaredParetoArbitration,
} from "../../../olt/scripts/src/reporting/doctor/anti-stagnation/rules-socratic.ts";
import { HistoricalDebateMemory } from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import { resolveDashboardPaths } from "../../../olt/scripts/src/mind/reporting/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../fixture.ts";

describe("rules-socratic anti-stagnation coverage", () => {
  let sandboxDir: string;

  beforeEach(() => {
    setupVirtualReportingFS();
    sandboxDir = tempDir("socratic-rules");
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  describe("auditCumulativeSocraticProgression", () => {
    it("flags unfulfilled commitments lacking recorded justification", () => {
      const now = new Date().toISOString();
      const memory = new HistoricalDebateMemory();
      memory.recordCommitment({
        id: "comm-1",
        topic: "Architecture Alignment",
        agreedResolution: "Adopt L2 standard",
        targetMilestone: "m-1",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      const resInstance = auditCumulativeSocraticProgression({ socraticMemory: memory });
      expect(resInstance[0]?.compliant).toBe(false);
      expect(resInstance[0]?.severity).toBe("ERROR");
      expect(resInstance[0]?.details?.unjustifiedCount).toBe(1);

      const serialized = JSON.parse(memory.serialize()) as Record<string, unknown>;
      const resObj = auditCumulativeSocraticProgression({ socraticMemory: serialized });
      expect(resObj[0]?.compliant).toBe(false);

      const resState = auditCumulativeSocraticProgression({
        state: { socratic_memory: serialized },
      });
      expect(resState[0]?.compliant).toBe(false);
    });

    it("handles corrupt in-memory socratic memory gracefully", () => {
      const corruptObj = { unparseable: BigInt(123) } as unknown as Record<string, unknown>;
      expect(auditCumulativeSocraticProgression({ socraticMemory: corruptObj })[0]?.compliant).toBe(
        true,
      );
      expect(
        auditCumulativeSocraticProgression({ state: { socratic_memory: corruptObj } })[0]
          ?.compliant,
      ).toBe(true);
    });

    it("passes when commitments are justified or satisfied, and handles disk files", () => {
      const now = new Date().toISOString();
      const memory = new HistoricalDebateMemory();
      memory.recordCommitment({
        id: "comm-2",
        topic: "Refactoring",
        agreedResolution: "Split modules",
        targetMilestone: "m-1",
        status: "pending",
        justification: "Deferred until Milestone 2",
        createdAt: now,
        updatedAt: now,
      });

      expect(auditCumulativeSocraticProgression({ socraticMemory: memory })[0]?.compliant).toBe(
        true,
      );
      expect(auditCumulativeSocraticProgression({})[0]?.compliant).toBe(true);

      const oltDir = join(sandboxDir, ".olt");
      fs.mkdirSync(oltDir, { recursive: true });
      fs.writeFileSync(join(oltDir, "debate-memory.json"), memory.serialize());
      expect(auditCumulativeSocraticProgression({ repoRoot: sandboxDir })[0]?.compliant).toBe(true);

      fs.writeFileSync(join(oltDir, "debate-memory.json"), "{ invalid json");
      expect(auditCumulativeSocraticProgression({ repoRoot: sandboxDir })[0]?.compliant).toBe(true);
    });
  });

  describe("auditPreDeclaredParetoArbitration", () => {
    it("flags Priority 4 (Speculative Abstraction) and unescalated consecutive impasses", () => {
      const resPriority4 = auditPreDeclaredParetoArbitration({
        state: {
          pareto: {
            recentArbitrations: [
              { id: "arb-1", chosenPriorityLevel: 4, winningApproach: "Generic Factory" },
            ],
          },
        },
      });
      expect(resPriority4[0]?.compliant).toBe(false);
      expect(resPriority4[0]?.severity).toBe("ERROR");
      expect(resPriority4[0]?.message).toContain("Priority 4 (Speculative Abstraction)");

      const resImpasse = auditPreDeclaredParetoArbitration({
        state: { socratic: { consecutiveImpasseCycles: 3, requiresCrucible: false } },
      });
      expect(resImpasse[0]?.compliant).toBe(false);
      expect(resImpasse[0]?.message).toContain("without mandatory Crucible escalation");

      const resCrucible = auditPreDeclaredParetoArbitration({
        state: { socratic: { consecutiveImpasseCycles: 3, requiresCrucible: true } },
      });
      expect(resCrucible[0]?.compliant).toBe(true);
      expect(auditPreDeclaredParetoArbitration({})[0]?.compliant).toBe(true);
    });
  });

  describe("auditInnovationPortfolio702010", () => {
    it("flags Core Stability deficits and speculative overallocations", () => {
      const resDeficit = auditInnovationPortfolio702010({
        state: {
          portfolio: {
            balanceStatus: "CORE_DEFICIT",
            trackA_CoreStabilityAndPolish: { percentage: 35 },
            trackC_ExploratoryHorizonBets: { percentage: 10 },
          },
        },
      });
      expect(resDeficit[0]?.compliant).toBe(false);
      expect(resDeficit[0]?.severity).toBe("ERROR");

      const resOver = auditInnovationPortfolio702010({
        state: {
          portfolio: {
            balanceStatus: "SPECULATIVE_OVERALLOCATION",
            trackA_CoreStabilityAndPolish: { percentage: 50 },
            trackC_ExploratoryHorizonBets: { percentage: 40 },
          },
        },
      });
      expect(resOver[0]?.compliant).toBe(false);
      expect(resOver[0]?.severity).toBe("WARN");

      const resBalanced = auditInnovationPortfolio702010({
        state: {
          portfolio: {
            balanceStatus: "BALANCED",
            trackA_CoreStabilityAndPolish: { percentage: 70 },
            trackC_ExploratoryHorizonBets: { percentage: 10 },
          },
        },
      });
      expect(resBalanced[0]?.compliant).toBe(true);
    });

    it("loads portfolio from disk dashboard json and handles empty state", () => {
      const dashPaths = resolveDashboardPaths(sandboxDir);
      fs.mkdirSync(join(sandboxDir, ".olt"), { recursive: true });
      fs.writeFileSync(
        dashPaths.jsonPath,
        JSON.stringify({
          portfolio: {
            balanceStatus: "CORE_DEFICIT",
            trackA_CoreStabilityAndPolish: { percentage: 30 },
          },
        }),
      );

      const resDisk = auditInnovationPortfolio702010({ repoRoot: sandboxDir });
      expect(resDisk[0]?.compliant).toBe(false);
      expect(auditInnovationPortfolio702010({})[0]?.compliant).toBe(true);
    });
  });

  describe("auditErgonomicWalkthrough", () => {
    it("flags blocking deficits, low composite scores, and high latency", () => {
      const resDeficit = auditErgonomicWalkthrough({
        state: { product_craft: { status: "DEFICIT_NOTICE", openDeficits: { blockingCount: 2 } } },
      });
      expect(resDeficit[0]?.compliant).toBe(false);
      expect(resDeficit[0]?.severity).toBe("ERROR");

      const resLowScore = auditErgonomicWalkthrough({
        state: { product_craft: { compositeCraftScore: 70, passThreshold: 85 } },
      });
      expect(resLowScore[0]?.compliant).toBe(false);
      expect(resLowScore[0]?.severity).toBe("WARN");

      const resLatency = auditErgonomicWalkthrough({
        state: { product_craft: { microInteractionLatencyMs: 40, microInteractionTargetMs: 16 } },
      });
      expect(resLatency[0]?.compliant).toBe(false);
      expect(resLatency[0]?.severity).toBe("WARN");

      const resNominal = auditErgonomicWalkthrough({
        state: {
          product_craft: {
            compositeCraftScore: 95,
            passThreshold: 85,
            microInteractionLatencyMs: 12,
          },
        },
      });
      expect(resNominal[0]?.compliant).toBe(true);
    });

    it("loads product craft from disk dashboard json and handles missing craft", () => {
      const dashPaths = resolveDashboardPaths(sandboxDir);
      fs.mkdirSync(join(sandboxDir, ".olt"), { recursive: true });
      fs.writeFileSync(
        dashPaths.jsonPath,
        JSON.stringify({
          productCraft: {
            ergonomicWalkthroughStatus: "DEFICIT_NOTICE",
            openDeficits: { blockingCount: 1 },
          },
        }),
      );

      const resDisk = auditErgonomicWalkthrough({ repoRoot: sandboxDir });
      expect(resDisk[0]?.compliant).toBe(false);
      expect(auditErgonomicWalkthrough({})[0]?.compliant).toBe(true);
    });
  });
});
