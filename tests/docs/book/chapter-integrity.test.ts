import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

describe("OLT Book System - Chapter Links & Governance Navigation Mesh", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const bookDir = join(repoRoot, "docs", "book");
  const rootSkillGuidelinesPath = join(repoRoot, "docs", "SKILL_COLLECTION_GUIDELINES.md");
  const oltGuidelinesPath = join(repoRoot, "docs", "olt", "GUIDELINES.md");

  it("verifies 100% relative link integrity across all docs/book/ markdown files", () => {
    const files = readdirSync(bookDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(12);

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let checkedLinks = 0;

    for (const file of files) {
      const filePath = join(bookDir, file);
      const content = readFileSync(filePath, "utf-8");
      let match = linkRegex.exec(content);

      while (match !== null) {
        const url = match[2];
        match = linkRegex.exec(content);

        if (
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("mailto:") ||
          url.startsWith("#")
        ) {
          continue;
        }

        const pathPart = url.split("#")[0];
        if (!pathPart) continue;

        const resolvedTarget = resolve(dirname(filePath), pathPart);
        expect(existsSync(resolvedTarget)).toBe(true);
        checkedLinks++;
      }
    }

    expect(checkedLinks).toBeGreaterThan(50);
  });

  it("verifies clean 4-way navigation mesh and zero emojis in governance navigation bars", () => {
    const rootSkillContent = readFileSync(rootSkillGuidelinesPath, "utf-8");
    const rootFirstLine = rootSkillContent.split("\n").find((l) => l.includes("[Previous:")) ?? "";
    expect(rootFirstLine.length).toBeGreaterThan(0);
    expect(/\p{Extended_Pictographic}/u.test(rootFirstLine)).toBe(false);

    const oltGuidelinesContent = readFileSync(oltGuidelinesPath, "utf-8");
    const oltFirstLine =
      oltGuidelinesContent.split("\n").find((l) => l.includes("[Previous:")) ?? "";
    expect(oltFirstLine.length).toBeGreaterThan(0);
    expect(/\p{Extended_Pictographic}/u.test(oltFirstLine)).toBe(false);
  });
});
