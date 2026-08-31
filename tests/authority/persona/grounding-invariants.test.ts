import { describe, expect, test } from "bun:test";
import {
  COGNITIVE_PILLARS,
  COGNITIVE_PILLARS_COUNT,
  COGNITIVE_PILLARS_MAP,
  formatPillarsBrief,
  formatPillarsMarkdown,
  getAllCognitivePillars,
  getCognitivePillar,
  getPillarAuditQuestions,
  PILLAR_1_CLI_FIRST,
  PILLAR_2_VISUAL_TRUTH,
  PILLAR_3_THREAD_AUTHORITY,
  PILLAR_4_PERPETUAL_SELF_EVOLUTION,
  PILLAR_5_GRAPH_INTEROPERABILITY,
  PILLAR_6_FIRST_PRINCIPLES,
  PILLAR_7_INFINITE_CADENCE,
  type CognitivePillarId,
} from "../../../olt/scripts/src/authority/pillars.ts";

describe("Persona Grounding - Cognitive Pillars & Invariants", () => {
  test("defines exactly 7 cognitive pillars", () => {
    expect(COGNITIVE_PILLARS_COUNT).toBe(7);
    expect(COGNITIVE_PILLARS).toHaveLength(7);
    expect(getAllCognitivePillars()).toHaveLength(7);
  });

  test("each pillar has complete metadata, invariants, and supervisory implications", () => {
    for (let id = 1; id <= 7; id++) {
      const pillar = COGNITIVE_PILLARS_MAP[id as 1 | 2 | 3 | 4 | 5 | 6 | 7];
      expect(pillar).toBeDefined();
      expect(pillar.id).toBe(id as CognitivePillarId);
      expect(pillar.code.length).toBeGreaterThan(0);
      expect(pillar.title.length).toBeGreaterThan(0);
      expect(pillar.shortSummary.length).toBeGreaterThan(0);
      expect(pillar.description.length).toBeGreaterThan(0);
      expect(pillar.keyInvariants.length).toBeGreaterThanOrEqual(3);
      expect(pillar.selfAuditQuestion.length).toBeGreaterThan(0);
      expect(pillar.supervisoryImplications.mind.length).toBeGreaterThan(0);
      expect(pillar.supervisoryImplications.orchestrator.length).toBeGreaterThan(0);
      expect(pillar.supervisoryImplications.coordinator.length).toBeGreaterThan(0);
    }
  });

  test("pillar definitions match core architectural specifications", () => {
    expect(PILLAR_1_CLI_FIRST.id).toBe(1);
    expect(PILLAR_1_CLI_FIRST.code).toBe("CLI_FIRST_TOKEN_LEVERAGE");
    expect(PILLAR_1_CLI_FIRST.title).toBe("CLI-First Token Leverage");

    expect(PILLAR_2_VISUAL_TRUTH.id).toBe(2);
    expect(PILLAR_2_VISUAL_TRUTH.code).toBe("VISUAL_TRUTH_AND_RADICAL_OBSERVABILITY");
    expect(PILLAR_2_VISUAL_TRUTH.title).toBe("Visual Truth & Radical Observability");

    expect(PILLAR_3_THREAD_AUTHORITY.id).toBe(3);
    expect(PILLAR_3_THREAD_AUTHORITY.code).toBe("THREAD_AUTHORITY_AND_ZERO_MAIN_THREAD_SPILLOVER");
    expect(PILLAR_3_THREAD_AUTHORITY.title).toBe("Thread Authority & Zero Main-Thread Spillover");

    expect(PILLAR_4_PERPETUAL_SELF_EVOLUTION.id).toBe(4);
    expect(PILLAR_4_PERPETUAL_SELF_EVOLUTION.code).toBe("PERPETUAL_SELF_EVOLUTION");

    expect(PILLAR_5_GRAPH_INTEROPERABILITY.id).toBe(5);
    expect(PILLAR_5_GRAPH_INTEROPERABILITY.code).toBe(
      "GRAPH_VISUALIZER_UI_AND_EXTERNAL_INTEROPERABILITY",
    );

    expect(PILLAR_6_FIRST_PRINCIPLES.id).toBe(6);
    expect(PILLAR_6_FIRST_PRINCIPLES.code).toBe(
      "FIRST_PRINCIPLES_INNOVATION_AND_RADICAL_SIMPLIFICATION",
    );

    expect(PILLAR_7_INFINITE_CADENCE.id).toBe(7);
    expect(PILLAR_7_INFINITE_CADENCE.code).toBe(
      "INFINITE_BORDERLESS_CADENCE_AND_TOPOLOGICAL_CONCURRENCY",
    );
  });

  test("getCognitivePillar resolves pillars by id, string number, code, title, and aliases", () => {
    expect(getCognitivePillar(1)).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("1")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("CLI_FIRST_TOKEN_LEVERAGE")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("cli_first_token_leverage")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("cli-first-token-leverage")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("pillar 1")).toBe(PILLAR_1_CLI_FIRST);
    expect(getCognitivePillar("pillar-1")).toBe(PILLAR_1_CLI_FIRST);

    expect(getCognitivePillar(2)).toBe(PILLAR_2_VISUAL_TRUTH);
    expect(getCognitivePillar("visual truth")).toBe(PILLAR_2_VISUAL_TRUTH);

    expect(getCognitivePillar(3)).toBe(PILLAR_3_THREAD_AUTHORITY);
    expect(getCognitivePillar("thread authority")).toBe(PILLAR_3_THREAD_AUTHORITY);

    expect(getCognitivePillar(4)).toBe(PILLAR_4_PERPETUAL_SELF_EVOLUTION);
    expect(getCognitivePillar(5)).toBe(PILLAR_5_GRAPH_INTEROPERABILITY);
    expect(getCognitivePillar(6)).toBe(PILLAR_6_FIRST_PRINCIPLES);
    expect(getCognitivePillar(7)).toBe(PILLAR_7_INFINITE_CADENCE);

    expect(getCognitivePillar(0)).toBeUndefined();
    expect(getCognitivePillar(8)).toBeUndefined();
    expect(getCognitivePillar("invalid-pillar-identifier")).toBeUndefined();
  });

  test("getPillarAuditQuestions returns all 7 questions with role-specific mandates", () => {
    const generalQuestions = getPillarAuditQuestions();
    expect(generalQuestions).toHaveLength(7);
    expect(generalQuestions[0]).toContain("Am I leveraging high-density structured CLI tools");

    const mindQuestions = getPillarAuditQuestions("mind");
    expect(mindQuestions).toHaveLength(7);
    expect(mindQuestions[0]).toContain("[MIND mandate:");

    const orchestratorQuestions = getPillarAuditQuestions("orchestrator");
    expect(orchestratorQuestions).toHaveLength(7);
    expect(orchestratorQuestions[1]).toContain("[ORCHESTRATOR mandate:");

    const coordinatorQuestions = getPillarAuditQuestions("coordinator");
    expect(coordinatorQuestions).toHaveLength(7);
    expect(coordinatorQuestions[2]).toContain("[COORDINATOR mandate:");
  });

  test("formatPillarsMarkdown formats markdown documentation correctly", () => {
    const fullMarkdown = formatPillarsMarkdown();
    expect(fullMarkdown).toContain("### 🧠 The 7 Cognitive Pillars");
    expect(fullMarkdown).toContain("#### Pillar 1: CLI-First Token Leverage");
    expect(fullMarkdown).toContain(
      "#### Pillar 7: Infinite Borderless Cadence & Topological Concurrency",
    );
    expect(fullMarkdown).toContain("**Key Invariants:**");
    expect(fullMarkdown).toContain("**Reflexive Audit Question:**");

    const roleMarkdown = formatPillarsMarkdown({ supervisoryRole: "coordinator" });
    expect(roleMarkdown).toContain("**COORDINATOR Mandate:**");

    const compactMarkdown = formatPillarsMarkdown({ compact: true });
    expect(compactMarkdown).toContain("#### Pillar 1: CLI-First Token Leverage");
    expect(compactMarkdown).not.toContain("**Key Invariants:**");

    const brief = formatPillarsBrief();
    expect(brief).toContain("- **Pillar 1 (CLI-First Token Leverage)**:");
    expect(brief).toContain(
      "- **Pillar 7 (Infinite Borderless Cadence & Topological Concurrency)**:",
    );
  });
});
