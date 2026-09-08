import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import * as yaml from "js-yaml";
import { LINE_LIMIT } from "../../scripts/modularity/inventory/physical-lines.ts";

interface RuleFrontmatter {
  readonly description: string;
  readonly globs: readonly string[];
  readonly alwaysApply: boolean;
}

const CANONICAL_RULE_FILES = [
  "typescript-style.md",
  "file-structure.md",
  "test-purity.md",
  "git-discipline.md",
  "chatroom-protocol.md",
] as const;

const rulesDir = join(import.meta.dir, "../../.agents/rules");

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function parseFrontmatter(content: string): RuleFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match || match[1] === undefined) {
    throw new Error("Missing or invalid frontmatter block");
  }
  const parsed = yaml.load(match[1]);
  if (!isRecord(parsed)) {
    throw new Error("Frontmatter must be a YAML mapping");
  }
  const { description, globs, alwaysApply } = parsed;
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error("Frontmatter description must be a non-empty string");
  }
  if (
    !Array.isArray(globs) ||
    globs.length === 0 ||
    !globs.every((g) => typeof g === "string" && g.trim().length > 0)
  ) {
    throw new Error("Frontmatter globs must be a non-empty array of strings");
  }
  if (typeof alwaysApply !== "boolean") {
    throw new Error("Frontmatter alwaysApply must be a boolean");
  }
  return {
    description,
    globs,
    alwaysApply,
  };
}

describe("rule drift control", () => {
  it("verifies all 5 canonical rule files exist in .agents/rules", async () => {
    for (const filename of CANONICAL_RULE_FILES) {
      const filePath = join(rulesDir, filename);
      const exists = await Bun.file(filePath).exists();
      expect(exists).toBe(true);
    }
  });

  it("verifies each rule file contains valid YAML frontmatter", async () => {
    for (const filename of CANONICAL_RULE_FILES) {
      const filePath = join(rulesDir, filename);
      const content = await Bun.file(filePath).text();
      const frontmatter = parseFrontmatter(content);
      expect(typeof frontmatter.description).toBe("string");
      expect(frontmatter.description.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(frontmatter.globs)).toBe(true);
      expect(frontmatter.globs.length).toBeGreaterThan(0);
      for (const pattern of frontmatter.globs) {
        expect(typeof pattern).toBe("string");
        expect(pattern.trim().length).toBeGreaterThan(0);
      }
      expect(typeof frontmatter.alwaysApply).toBe("boolean");
    }
  });

  it("verifies file-structure.md asserts exact LINE_LIMIT and fanout rules", async () => {
    const filePath = join(rulesDir, "file-structure.md");
    const content = await Bun.file(filePath).text();

    expect(content).toContain(`Maximum ${LINE_LIMIT} physical lines per source file`);
    expect(content).toContain("Maximum 10 direct .ts/.tsx files per directory");
    expect(content).toContain("scripts/modularity/inventory/physical-lines.ts:LINE_LIMIT");
    expect(content).toContain("scripts/modularity/inventory/fanout.ts:FANOUT_LIMIT");
    expect(LINE_LIMIT).toBe(400);
  });
});
