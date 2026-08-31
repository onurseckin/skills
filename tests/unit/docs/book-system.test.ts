import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

describe("OLT Book System and Canonical Guidelines Validation Suite", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const bookDir = join(repoRoot, "docs", "book");
  const canonicalGuidelinesPath = join(repoRoot, "olt", "docs", "guidelines.md");
  const rootSkillGuidelinesPath = join(repoRoot, "docs", "SKILL_COLLECTION_GUIDELINES.md");
  const oltGuidelinesPath = join(repoRoot, "docs", "olt", "GUIDELINES.md");

  const expectedChapters = [
    "01-quickstart-and-getting-started.md",
    "02-core-philosophy-and-brent-parallelism.md",
    "03-tier-0-governance-and-autonomous-mind.md",
    "04-toolchain-discovery-and-policy-engine.md",
    "05-mandatory-companion-auditors.md",
    "06-lifecycle-hooks-and-audio-engine.md",
    "07-host-aware-quota-engine-and-graceful-freeze.md",
    "08-verification-and-socratic-gating.md",
    "09-full-cli-command-reference.md",
    "10-troubleshooting-and-anti-blunder-compendium.md",
  ] as const;

  it("verifies all 10 chapter files exist in docs/book/ and exceed 1000 bytes", () => {
    expect(existsSync(bookDir)).toBe(true);

    for (const chapter of expectedChapters) {
      const chapterPath = join(bookDir, chapter);
      expect(existsSync(chapterPath)).toBe(true);

      const stats = statSync(chapterPath);
      expect(stats.isFile()).toBe(true);
      expect(stats.size).toBeGreaterThan(1000);

      const content = readFileSync(chapterPath, "utf-8");
      expect(content.trim().startsWith("#") || content.trim().startsWith("[")).toBe(true);
    }
  });

  it("verifies docs/book/README.md and docs/book/SUMMARY.md exist and exceed 1000 bytes", () => {
    const readmePath = join(bookDir, "README.md");
    const summaryPath = join(bookDir, "SUMMARY.md");

    expect(existsSync(readmePath)).toBe(true);
    expect(statSync(readmePath).size).toBeGreaterThan(1000);

    expect(existsSync(summaryPath)).toBe(true);
    expect(statSync(summaryPath).size).toBeGreaterThan(1000);

    const readmeContent = readFileSync(readmePath, "utf-8");
    expect(readmeContent).toContain("The OLT Book");

    const summaryContent = readFileSync(summaryPath, "utf-8");
    for (const chapter of expectedChapters) {
      expect(summaryContent).toContain(chapter);
    }
  });

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

  it("verifies canonical guidelines in olt/docs/ and clean referencing by legacy entrypoints", () => {
    expect(existsSync(canonicalGuidelinesPath)).toBe(true);
    expect(statSync(canonicalGuidelinesPath).size).toBeGreaterThan(1000);

    const canonicalContent = readFileSync(canonicalGuidelinesPath, "utf-8");
    expect(canonicalContent).toContain("Canonical Authoring and Governance Guidelines");

    expect(existsSync(rootSkillGuidelinesPath)).toBe(true);
    const rootSkillContent = readFileSync(rootSkillGuidelinesPath, "utf-8");
    expect(rootSkillContent).toContain("olt/docs/guidelines.md");

    expect(existsSync(oltGuidelinesPath)).toBe(true);
    const oltGuidelinesContent = readFileSync(oltGuidelinesPath, "utf-8");
    expect(oltGuidelinesContent).toContain("olt/docs/guidelines.md");
  });

  it("verifies Diataxis 4-quadrant adherence and taxonomy coverage", () => {
    const bookReadme = readFileSync(join(bookDir, "README.md"), "utf-8");
    expect(bookReadme).toContain("Diátaxis");
    expect(bookReadme).toContain("Tutorials");
    expect(bookReadme).toContain("Explanations");
    expect(bookReadme).toContain("How-To Guides");
    expect(bookReadme).toContain("Reference");

    const canonicalGuidelines = readFileSync(canonicalGuidelinesPath, "utf-8");
    expect(canonicalGuidelines).toContain("Diataxis");
  });

  it("verifies clean 4-way navigation mesh and zero emojis in governance navigation bars", () => {
    const rootSkillContent = readFileSync(rootSkillGuidelinesPath, "utf-8");
    const rootFirstLine = rootSkillContent.split("\n").find((l) => l.includes("[Previous:")) ?? "";
    expect(rootFirstLine.length).toBeGreaterThan(0);
    expect(/\p{Extended_Pictographic}/u.test(rootFirstLine)).toBe(false);

    const oltGuidelinesContent = readFileSync(oltGuidelinesPath, "utf-8");
    const oltFirstLine = oltGuidelinesContent.split("\n").find((l) => l.includes("[Previous:")) ?? "";
    expect(oltFirstLine.length).toBeGreaterThan(0);
    expect(/\p{Extended_Pictographic}/u.test(oltFirstLine)).toBe(false);
  });
});
