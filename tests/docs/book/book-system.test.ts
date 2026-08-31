import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

describe("OLT Book System - Chapters & Summary Verification", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const bookDir = join(repoRoot, "docs", "book");

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
});
