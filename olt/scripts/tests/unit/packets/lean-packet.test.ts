import { describe, it, expect } from "bun:test";
import { buildExactAnchorBriefing } from "../../../src/mind/briefing-builder.ts";

describe("Lean Packets (Exact Anchor Briefing)", () => {
  it("should generate a brief that is <= 30 lines when no anchors or symbols are present", () => {
    const briefing = buildExactAnchorBriefing({
      taskId: "test_task",
      label: "Test Task Label",
      writeScope: [
        "/Users/fake/repos/skills/src/file1.ts",
        "/Users/fake/repos/skills/src/file2.ts",
      ],
      targetFiles: ["/Users/fake/repos/skills/src/file1.ts"],
      targetSymbols: [],
      gateCommands: ["bun run typecheck"],
      acceptanceCriteria: ["Must pass tests"],
      recommendedCommands: ["bun test /Users/fake/repos/skills/src/file1.test.ts"],
    });

    const lines = briefing.markdown.split("\n").filter((line) => line.trim().length > 0);
    expect(lines.length).toBeLessThanOrEqual(30);
  });
});
