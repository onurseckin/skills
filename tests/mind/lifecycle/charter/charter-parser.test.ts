import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { parseCharterFromYaml } from "../../../../olt/scripts/src/mind/lifecycle/charter/parser.ts";

describe("Charter Parser Coverage Suite", () => {
  const sampleSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

  it("parses valid charter manifest with goals, non-goals, and stability checks", () => {
    const doc = {
      identity: "Core Architect Agent",
      goals: [
        { id: "g1", statement: "Maintain system stability" },
        "- [G2]: Complete task execution",
      ],
      non_goals: ["- Out-of-scope refactoring", "Manual migrations"],
      repo_roots: ["`packages/core`", "- packages/cli"],
      stability: [{ command: "bun test", expectedExit: 0 }, "- `bun lint` -> exit 0"],
      budgets: {
        cadence: "infinite_borderless",
        max_agents_in_flight: 4,
      },
      prohibitions: ["- Never push directly to main", "- Never modify secrets"],
      escalation: "Escalate to human supervisor on deadlock",
      open_questions: ["Should we enable streaming logs?"],
    };

    const parsed = parseCharterFromYaml(doc, "raw-charter-text", sampleSha);
    expect(parsed.identity).toBe("Core Architect Agent");
    expect(parsed.goals).toEqual([
      { id: "G1", statement: "Maintain system stability" },
      { id: "G2", statement: "Complete task execution" },
    ]);
    expect(parsed.goalIds).toEqual(["G1", "G2"]);
    expect(parsed.nonGoals).toEqual(["Out-of-scope refactoring", "Manual migrations"]);
    expect(parsed.repoRoots).toEqual(["packages/core", "packages/cli"]);
    expect(parsed.stability).toEqual([
      { command: "bun test", expectedExit: 0 },
      { command: "bun lint", expectedExit: 0 },
    ]);
    expect(parsed.budgets?.max_agents_in_flight).toBe(4);
    expect(parsed.prohibitions).toContain("Never push directly to main");
    expect(parsed.escalation).toBe("Escalate to human supervisor on deadlock");
    expect(parsed.openQuestions).toEqual(["Should we enable streaming logs?"]);
    expect(parsed.rawText).toBe("raw-charter-text");
    expect(parsed.sha256).toBe(sampleSha);
  });

  it("handles nested charter object and single string repoRoots / prohibitions", () => {
    const doc = {
      charter: {
        identity: "Subordinate Worker",
        goals: [{ id: "G_FIX", statement: "Fix defects" }],
        nonGoals: ["Do not break tests"],
        repoRoots: "`src/`",
        prohibitions: "Never edit production DB",
      },
    };

    const parsed = parseCharterFromYaml(doc, "nested-yaml", sampleSha);
    expect(parsed.identity).toBe("Subordinate Worker");
    expect(parsed.goals[0]?.id).toBe("G_FIX");
    expect(parsed.repoRoots).toEqual(["src/"]);
    expect(parsed.prohibitions).toBe("Never edit production DB");
  });

  it("defaults repoRoots to ['.'] when unspecified", () => {
    const doc = {
      identity: "Default Root Worker",
      goals: [{ id: "G1", statement: "Build app" }],
      non_goals: ["Skip docs"],
    };
    const parsed = parseCharterFromYaml(doc, "", sampleSha);
    expect(parsed.repoRoots).toEqual(["."]);
  });

  it("throws HarnessError on missing identity", () => {
    const doc = {
      goals: [{ id: "G1", statement: "Goal" }],
      non_goals: ["None"],
    };
    expect(() => parseCharterFromYaml(doc, "", sampleSha)).toThrow(HarnessError);
  });

  it("throws HarnessError on missing or invalid goals", () => {
    expect(() =>
      parseCharterFromYaml({ identity: "Test", goals: [], non_goals: ["None"] }, "", sampleSha),
    ).toThrow(HarnessError);

    expect(() =>
      parseCharterFromYaml(
        { identity: "Test", goals: ["Invalid Goal Format"], non_goals: ["None"] },
        "",
        sampleSha,
      ),
    ).toThrow(HarnessError);
  });

  it("throws HarnessError on missing or empty non_goals", () => {
    expect(() =>
      parseCharterFromYaml(
        { identity: "Test", goals: [{ id: "G1", statement: "Goal" }] },
        "",
        sampleSha,
      ),
    ).toThrow(HarnessError);

    expect(() =>
      parseCharterFromYaml(
        { identity: "Test", goals: [{ id: "G1", statement: "Goal" }], non_goals: ["  ", ""] },
        "",
        sampleSha,
      ),
    ).toThrow(HarnessError);
  });
});
