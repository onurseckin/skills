import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

describe("Documentation Structure, Diátaxis Modules & Link Invariants", () => {
  const repoRoot = resolve(import.meta.dir, "../../..");
  const rootDocsDir = join(repoRoot, "docs");
  const skillDocsDir = join(rootDocsDir, "olt");
  const forbiddenCharterDocs = join(repoRoot, "docs", "CHARTER.md");
  const forbiddenReferenceCharter = join(repoRoot, "olt", "references", "CHARTER.md");
  const archDocsDir = join(skillDocsDir, "architecture");

  const expectedModules = [
    "01-foundations",
    "02-four-tier-hierarchy",
    "03-mind-product-owner",
    "04-continuous-preplanning-factory",
    "05-concurrency-straggler-sla",
    "06-topological-scheduler-dags",
    "07-distributed-leasing-execution",
    "08-adversarial-validation-repair",
    "09-falsifiable-evidence-gates",
    "10-durability-recovery-capsules",
    "11-worktree-branching-honesty",
    "12-flock-mailboxes-and-tui",
    "13-policy-rbac-failclosed-engine",
    "14-harness-cli-and-command-engine",
    "15-state-schemas-and-event-ledger",
    "16-error-catalog-and-blunders",
    "17-verification-engines-and-gates",
  ] as const;

  it("verifies forbidden legacy charter files do not exist", () => {
    expect(existsSync(forbiddenCharterDocs)).toBe(false);
    expect(existsSync(forbiddenReferenceCharter)).toBe(false);
  });

  it("verifies docs/olt contains README.md and all 17 educational modules", () => {
    expect(existsSync(skillDocsDir)).toBe(true);

    const masterReadme = join(skillDocsDir, "README.md");
    expect(existsSync(masterReadme)).toBe(true);
    const readmeContent = readFileSync(masterReadme, "utf8");
    expect(readmeContent.length).toBeGreaterThan(1000);
    expect(readmeContent).toContain("# Orchestrating Long Tasks");

    for (const mod of expectedModules) {
      const modDir = join(archDocsDir, mod);
      expect(existsSync(modDir)).toBe(true);
      expect(statSync(modDir).isDirectory()).toBe(true);

      const files = readdirSync(modDir).filter((f) => f.endsWith(".md"));
      expect(files.length).toBeGreaterThanOrEqual(1);

      for (const file of files) {
        const filePath = join(modDir, file);
        const content = readFileSync(filePath, "utf8");
        expect(content.length).toBeGreaterThan(200);
        expect(content.trim().startsWith("#") || content.trim().startsWith(">")).toBe(true);
      }
    }
  });

  it("verifies root docs/README.md is strictly reserved for repository-wide multi-skill collection guidelines", () => {
    const rootReadme = join(rootDocsDir, "README.md");
    expect(existsSync(rootReadme)).toBe(true);
    const content = readFileSync(rootReadme, "utf8");

    expect(content).toContain("Repository Documentation");
    expect(content).toContain("SKILL_COLLECTION_GUIDELINES.md");
    expect(content).toContain("strictly reserved");
    expect(content).toContain("repository-wide multi-skill collection guidelines");

    // Must NOT contain skill-specific execution commands or implementation runtime state
    expect(content).not.toContain("proposeBatch");
    expect(content).not.toContain("--role implementer");
    expect(content).not.toContain("--role repairer");
    expect(content).not.toContain("critic:start");
  });

  it("verifies all relative markdown links in docs/olt resolve to existing files", () => {
    function getMdFiles(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getMdFiles(full));
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(full);
        }
      }
      return files;
    }

    const mdFiles = getMdFiles(skillDocsDir);
    expect(mdFiles.length).toBeGreaterThanOrEqual(15);

    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let checkedCount = 0;

    for (const file of mdFiles) {
      const content = readFileSync(file, "utf8");
      let match;
      while ((match = linkRegex.exec(content)) !== null) {
        const [_, _text, url] = match;
        if (
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("mailto:") ||
          url.startsWith("file://")
        ) {
          continue;
        }
        const filePathPart = url.split("#")[0];
        if (!filePathPart) {
          continue;
        }
        const resolved = resolve(join(file, ".."), filePathPart);
        expect(existsSync(resolved)).toBe(true);
        checkedCount++;
      }
    }
    expect(checkedCount).toBeGreaterThan(10);
  });
});
