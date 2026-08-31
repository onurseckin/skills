import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AnchorSymbol,
  type ExactAnchor,
  applyTokenEconomy,
  buildExactAnchorBriefing,
  compactSnippet,
  expandWriteScope,
  isTargetFilePath,
} from "../../../olt/scripts/src/cli/briefing/index.ts";

describe("Domain 17: Zero-Exploration Exact-Anchor Briefing Engine - Scope & Assembly", () => {
  describe("Challenge 4: Write-Scope Directory Expansion & Planned Path Disambiguation", () => {
    it("expands directory write-scopes into candidate files and filters out gitignored/scratch paths", () => {
      const root = mkdtempSync(join(tmpdir(), "briefing-scope-"));
      mkdirSync(join(root, "src"), { recursive: true });
      mkdirSync(join(root, "scratch"), { recursive: true });
      mkdirSync(join(root, ".git"), { recursive: true });
      mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });

      writeFileSync(join(root, "src", "index.ts"), "export const a = 1;");
      writeFileSync(join(root, "src", "util.ts"), "export const b = 2;");
      writeFileSync(join(root, "src", "asset.png"), "binary data");
      writeFileSync(join(root, "scratch", "temp.ts"), "scratch data");
      writeFileSync(join(root, ".git", "config"), "git config");
      writeFileSync(join(root, "node_modules", "pkg", "index.js"), "module data");

      const expanded = expandWriteScope(["src", "scratch"], root);
      expect(expanded).toContain("src/index.ts");
      expect(expanded).toContain("src/util.ts");
      expect(expanded).not.toContain("src/asset.png");
      expect(expanded).not.toContain("scratch/temp.ts");
      expect(expanded.some((f) => f.includes("node_modules"))).toBe(false);
      expect(expanded.some((f) => f.includes(".git"))).toBe(false);
      rmSync(root, { recursive: true, force: true });
    });

    it("disambiguates planned code files from planned extensionless directory paths", () => {
      expect(isTargetFilePath("src/index.ts")).toBe(true);
      expect(isTargetFilePath("src/components/button.tsx")).toBe(true);
      expect(isTargetFilePath("src/modules/auth/service.ts")).toBe(true);
      expect(isTargetFilePath("src/modules/auth")).toBe(false);
      expect(isTargetFilePath("src/cli/")).toBe(false);
      expect(isTargetFilePath("src/image.png")).toBe(false);
      expect(isTargetFilePath("package-lock.json")).toBe(true);
      expect(isTargetFilePath("bun.lockb")).toBe(false);

      const root = mkdtempSync(join(tmpdir(), "briefing-disambig-"));
      const expanded = expandWriteScope(
        ["src/modules/auth/service.ts", "src/modules/auth", "src/auth/"],
        root,
      );
      expect(expanded).toContain("src/modules/auth/service.ts");
      expect(expanded).not.toContain("src/modules/auth");
      expect(expanded).not.toContain("src/auth/");
      rmSync(root, { recursive: true, force: true });
    });
  });

  describe("Challenge 5: Semantic Priority Ranking in Token Economy Compaction", () => {
    it("compacts snippets with line limit and truncation note", () => {
      const longSnippet = Array.from({ length: 50 }, (_, i) => `const x_${i} = ${i};`).join("\n");
      const compacted = compactSnippet(longSnippet, 15);
      const lines = compacted.split("\n");
      expect(lines.length).toBeLessThanOrEqual(16);
      expect(compacted).toContain("truncated for brevity");
    });

    it("prioritizes target symbols and exported declarations when budget is constrained", () => {
      const anchors: ExactAnchor[] = Array.from({ length: 30 }, (_, i) => ({
        filePath: `file_${i}.ts`,
        symbolName: i === 0 ? "criticalTarget" : `symbol_${i}`,
        startLine: 1,
        endLine: 100,
        contextSnippet: Array.from({ length: 100 }, (_, j) => `// line ${j} of symbol ${i}`).join(
          "\n",
        ),
      }));

      const symbols: AnchorSymbol[] = [
        {
          name: "criticalTarget",
          kind: "function",
          startLine: 1,
          endLine: 50,
          signature: "export function criticalTarget(): void",
          exported: true,
        },
        ...Array.from({ length: 99 }, (_, i) => ({
          name: `symbol_${i + 1}`,
          kind: "variable" as const,
          startLine: 1,
          endLine: 10,
          signature: `let symbol_${i + 1}: number`,
          exported: false,
        })),
      ];

      const result = applyTokenEconomy(anchors, symbols, 500, 10, false, ["criticalTarget"]);
      expect(result.isCompacted).toBe(true);
      expect(result.estimatedTokens).toBeLessThanOrEqual(1000);
      expect(result.symbols.some((s) => s.name === "criticalTarget")).toBe(true);
      expect(result.anchors.some((a) => a.symbolName === "criticalTarget")).toBe(true);
    });

    it("generates full exact-anchor briefing through buildExactAnchorBriefing pipeline", () => {
      const root = mkdtempSync(join(tmpdir(), "briefing-pipeline-"));
      mkdirSync(join(root, "src"), { recursive: true });
      const filePath = join(root, "src", "service.ts");
      writeFileSync(
        filePath,
        `export function runPipeline(): boolean { return true; }\nexport function internalHelper(): void {}`,
        "utf-8",
      );

      const briefing = buildExactAnchorBriefing({
        taskId: "task-pipe-42",
        label: "Execute pipeline task",
        writeScope: ["src/service.ts"],
        targetSymbols: ["runPipeline"],
        baseDir: root,
        gateCommands: ["bun test tests/cli/pipe.test.ts"],
      });

      expect(briefing.taskId).toBe("task-pipe-42");
      expect(briefing.markdown).toContain(
        "### 🌌 Zero-Exploration Exact-Anchor Briefing: task-pipe-42",
      );
      expect(briefing.markdown).toContain("runPipeline");
      expect(briefing.markdown).toContain("bun test tests/cli/pipe.test.ts");
      expect(briefing.symbols.some((s) => s.name === "runPipeline")).toBe(true);
      expect(briefing.anchors.length).toBeGreaterThan(0);
      expect(briefing.waitMsMandate).toBe(10000);
      rmSync(root, { recursive: true, force: true });
    });
  });
});
