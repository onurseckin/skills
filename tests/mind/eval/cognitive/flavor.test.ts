import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  CANONICAL_SELF_QUESTIONING_QUESTION,
  COGNITIVE_DIMENSION_SPECS,
  COGNITIVE_DIMENSIONS,
  COGNITIVE_FLAVOR_IDS,
  COGNITIVE_FLAVOR_PROFILES,
  evaluateCognitiveState,
  formatCognitiveEvaluationBrief,
  formatCognitivePromptSection,
  getCognitiveDimensionSpec,
  getCognitiveFlavorProfile,
  type CognitiveDimension,
  type CognitiveFlavorId,
} from "../../../../olt/scripts/src/mind/auditing/flavor/index.ts";

describe("Innovative Mind Cognition & Self-Questioning Flavor", () => {
  describe("Constants & Core Taxonomy", () => {
    it("defines the canonical first-principles self-questioning mantra", () => {
      expect(CANONICAL_SELF_QUESTIONING_QUESTION).toBe(
        "How can this system be made simpler, better, faster, more visual, more token-efficient, and higher quality?",
      );
    });

    it("defines exactly 6 cognitive dimensions", () => {
      expect(COGNITIVE_DIMENSIONS).toHaveLength(6);
      expect(COGNITIVE_DIMENSIONS).toContain("simpler");
      expect(COGNITIVE_DIMENSIONS).toContain("better");
      expect(COGNITIVE_DIMENSIONS).toContain("faster");
      expect(COGNITIVE_DIMENSIONS).toContain("more_visual");
      expect(COGNITIVE_DIMENSIONS).toContain("more_token_efficient");
      expect(COGNITIVE_DIMENSIONS).toContain("higher_quality");
    });

    it("defines 6 cognitive flavor personas", () => {
      expect(COGNITIVE_FLAVOR_IDS).toHaveLength(6);
      expect(COGNITIVE_FLAVOR_IDS).toContain("FIRST_PRINCIPLES");
      expect(COGNITIVE_FLAVOR_IDS).toContain("ARCHITECTURAL_ELEGANCE");
      expect(COGNITIVE_FLAVOR_IDS).toContain("RADICAL_OBSERVABILITY");
      expect(COGNITIVE_FLAVOR_IDS).toContain("TOKEN_PARSIMONY");
      expect(COGNITIVE_FLAVOR_IDS).toContain("ADVERSARIAL_SCEPTICISM");
      expect(COGNITIVE_FLAVOR_IDS).toContain("PERPETUAL_VITALITY");
    });

    it("maps all 6 cognitive dimensions to comprehensive specifications", () => {
      for (const dim of COGNITIVE_DIMENSIONS) {
        const spec = COGNITIVE_DIMENSION_SPECS[dim];
        expect(spec).toBeDefined();
        expect(spec.dimension).toBe(dim);
        expect(spec.title.length).toBeGreaterThan(0);
        expect(spec.coreQuestion.length).toBeGreaterThan(0);
        expect(spec.mappedPillarId).toBeGreaterThanOrEqual(1);
        expect(spec.mappedPillarId).toBeLessThanOrEqual(7);
        expect(spec.principles.length).toBeGreaterThanOrEqual(3);
        expect(spec.antipatterns.length).toBeGreaterThanOrEqual(3);
        expect(spec.breakthroughExamples.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("maps all 6 cognitive flavor profiles with archetypes and guidance", () => {
      for (const flavorId of COGNITIVE_FLAVOR_IDS) {
        const profile = COGNITIVE_FLAVOR_PROFILES[flavorId];
        expect(profile).toBeDefined();
        expect(profile.id).toBe(flavorId);
        expect(profile.name.length).toBeGreaterThan(0);
        expect(profile.archetype.length).toBeGreaterThan(0);
        expect(profile.coreMotto.length).toBeGreaterThan(0);
        expect(profile.promptGuidance.length).toBeGreaterThan(0);
        expect(profile.evaluationFocus.length).toBeGreaterThanOrEqual(2);
        expect(COGNITIVE_DIMENSIONS).toContain(profile.primaryDimension);
      }
    });
  });

  describe("Specification & Profile Lookups", () => {
    it("looks up dimension specs correctly", () => {
      const spec = getCognitiveDimensionSpec("simpler");
      expect(spec.dimension).toBe("simpler");
      expect(spec.title).toContain("Simplification");
    });

    it("throws HarnessError on unknown dimension", () => {
      expect(() =>
        getCognitiveDimensionSpec("unknown_dim" as unknown as CognitiveDimension),
      ).toThrow(HarnessError);
    });

    it("looks up flavor profiles correctly", () => {
      const profile = getCognitiveFlavorProfile("FIRST_PRINCIPLES");
      expect(profile.id).toBe("FIRST_PRINCIPLES");
      expect(profile.primaryDimension).toBe("simpler");
    });

    it("throws HarnessError on unknown flavor ID", () => {
      expect(() =>
        getCognitiveFlavorProfile("UNKNOWN_FLAVOR" as unknown as CognitiveFlavorId),
      ).toThrow(HarnessError);
    });
  });

  describe("System State Evaluation & Scoring", () => {
    it("evaluates optimal clean system state with high health score", () => {
      const evaluation = evaluateCognitiveState({
        totalLinesOfCode: 5000,
        sourceFilesCount: 20,
        supervisoryFileEditsCount: 0,
        anyTypesCount: 0,
        suppressionsCount: 0,
        criticalPathSpan: 2,
        totalWorkUnits: 4,
        activeConcurrency: 2,
        missingViewportCoverageCount: 0,
        unboundedOutputDetected: false,
        unprovenGatesCount: 0,
        qualitativePassesCount: 0,
        idleLoopDetected: false,
      });

      expect(evaluation.overallCognitiveHealthScore).toBe(100);
      expect(evaluation.frictionFindings).toHaveLength(0);
      expect(evaluation.dimensionScores.simpler.grade).toBe("OPTIMAL");
      expect(evaluation.dimensionScores.higher_quality.grade).toBe("OPTIMAL");
      expect(evaluation.dimensionScores.faster.grade).toBe("OPTIMAL");
      expect(evaluation.dimensionScores.more_visual.grade).toBe("OPTIMAL");
      expect(evaluation.dimensionScores.more_token_efficient.grade).toBe("OPTIMAL");
      expect(evaluation.dimensionScores.better.grade).toBe("OPTIMAL");
    });

    it("detects friction points and reduces dimensional scores on defects", () => {
      const evaluation = evaluateCognitiveState(
        {
          totalLinesOfCode: 25000,
          sourceFilesCount: 120,
          supervisoryFileEditsCount: 2,
          anyTypesCount: 5,
          suppressionsCount: 3,
          criticalPathSpan: 2,
          totalWorkUnits: 12,
          activeConcurrency: 1,
          missingViewportCoverageCount: 4,
          unboundedOutputDetected: true,
          unprovenGatesCount: 2,
          qualitativePassesCount: 3,
          idleLoopDetected: true,
        },
        "ADVERSARIAL_SCEPTICISM",
      );

      expect(evaluation.overallCognitiveHealthScore).toBeLessThan(70);
      expect(evaluation.frictionFindings.length).toBeGreaterThanOrEqual(8);
      expect(evaluation.primaryFlavor).toBe("ADVERSARIAL_SCEPTICISM");

      // Verify specific friction findings
      const findingTypes = evaluation.frictionFindings.map((f) => f.id);
      expect(findingTypes).toContain("FRIC-SIMP-001");
      expect(findingTypes).toContain("FRIC-BETT-001");
      expect(findingTypes).toContain("FRIC-FAST-001");
      expect(findingTypes).toContain("FRIC-FAST-002");
      expect(findingTypes).toContain("FRIC-VISU-001");
      expect(findingTypes).toContain("FRIC-TOKE-001");
      expect(findingTypes).toContain("FRIC-QUAL-001");
      expect(findingTypes).toContain("FRIC-QUAL-002");
      expect(findingTypes).toContain("FRIC-QUAL-003");
      expect(findingTypes).toContain("FRIC-QUAL-004");

      // Verify breakthrough proposals synthesized for low-scoring dimensions
      expect(evaluation.breakthroughProposals.length).toBeGreaterThanOrEqual(2);
      const proposalDimensions = evaluation.breakthroughProposals.map((p) => p.targetDimension);
      expect(proposalDimensions).toContain("higher_quality");
      expect(proposalDimensions).toContain("faster");
      expect(proposalDimensions).toContain("simpler");
    });
  });

  describe("Prompt & Brief Formatters", () => {
    it("formats cognitive prompt section with full guidance and 6 dimensions", () => {
      const prompt = formatCognitivePromptSection({
        flavorId: "FIRST_PRINCIPLES",
        role: "mind",
      });

      expect(prompt).toContain("First-Principles Cognitive Flavor & Self-Questioning");
      expect(prompt).toContain(CANONICAL_SELF_QUESTIONING_QUESTION);
      expect(prompt).toContain("6 First-Principles Cognitive Dimensions:");
      expect(prompt).toContain("SIMPLER");
      expect(prompt).toContain("BETTER");
      expect(prompt).toContain("FASTER");
      expect(prompt).toContain("MORE_VISUAL");
      expect(prompt).toContain("MORE_TOKEN_EFFICIENT");
      expect(prompt).toContain("HIGHER_QUALITY");
      expect(prompt).toContain("Role Guidance (MIND):");
      expect(prompt).toContain("infinite observe-only consciousness");
    });

    it("formats compact prompt section when requested", () => {
      const prompt = formatCognitivePromptSection({
        flavorId: "RADICAL_OBSERVABILITY",
        compact: true,
      });

      expect(prompt).toContain("First-Principles Cognitive Flavor & Self-Questioning");
      expect(prompt).toContain(CANONICAL_SELF_QUESTIONING_QUESTION);
      expect(prompt).not.toContain("Operational Directives:");
    });

    it("formats role guidance across different supervisory and worker roles", () => {
      const orchPrompt = formatCognitivePromptSection({ role: "orchestrator" });
      expect(orchPrompt).toContain("Role Guidance (ORCHESTRATOR):");

      const coordPrompt = formatCognitivePromptSection({ role: "coordinator" });
      expect(coordPrompt).toContain("Role Guidance (COORDINATOR):");

      const implPrompt = formatCognitivePromptSection({ role: "implementer" });
      expect(implPrompt).toContain("Role Guidance (IMPLEMENTER):");

      const valPrompt = formatCognitivePromptSection({ role: "validator" });
      expect(valPrompt).toContain("Role Guidance (VALIDATOR):");
    });

    it("formats markdown brief of cognitive evaluation", () => {
      const evaluation = evaluateCognitiveState({
        totalLinesOfCode: 30000,
        anyTypesCount: 3,
      });

      const brief = formatCognitiveEvaluationBrief(evaluation);
      expect(brief).toContain("Cognitive Flavor Brief: FIRST_PRINCIPLES");
      expect(brief).toContain("Health Score:");
      expect(brief).toContain("Dimensional Posture:");
      expect(brief).toContain("simpler");
      expect(brief).toContain("higher_quality");
    });
  });
});
