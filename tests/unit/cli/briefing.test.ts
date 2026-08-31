import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnchorSymbol,
  type ExactAnchor,
  buildExactAnchorBriefing,
  extractFileAnchors,
  extractSymbolsFromSource,
  findAnchorByPattern,
  escapeRegExp,
  findBalancedBlock,
  expandWriteScope,
  isTargetFilePath,
  compactSnippet,
  applyTokenEconomy,
} from "../../../olt/scripts/src/cli/briefing/index.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("Domain 17: Zero-Exploration Exact-Anchor Briefing Engine", () => {
  describe("Challenge 1: AST Anchor Drift & Trivia/Docstring Enclosure", () => {
    it("differentiates enclosingStartLine (with JSDoc) and declarationStartLine", () => {
      const source = `
/**
 * Processes payment transactions securely.
 * @param amount Payment amount in cents.
 */
export function processPayment(amount: number): boolean {
  return amount > 0;
}

/**
 * Account storage model.
 */
export class AccountModel {
  /**
   * User identifier.
   */
  public id: string = "";
}
`;
      const symbols = extractSymbolsFromSource(source, "payment.ts");
      const fn = symbols.find((s) => s.name === "processPayment");
      expect(fn).toBeDefined();
      expect(fn?.enclosingStartLine).toBe(2);
      expect(fn?.declarationStartLine).toBe(6);
      expect(fn?.startLine).toBe(6);
      expect(fn?.docstring).toContain("Processes payment transactions securely.");

      const cls = symbols.find((s) => s.name === "AccountModel");
      expect(cls).toBeDefined();
      expect(cls?.enclosingStartLine).toBe(10);
      expect(cls?.declarationStartLine).toBe(13);
    });

    it("respects includeDocstrings option in extractFileAnchors", () => {
      const root = scratchRoot("trivia-docstring-enclosure");
      mkdirSync(root, { recursive: true });
      const filePath = join(root, "service.ts");
      const content = `/**
 * Core authentication service.
 */
export function authenticateUser(token: string): boolean {
  return token.length > 0;
}
`;
      writeFileSync(filePath, content, "utf-8");

      const withDocs = extractFileAnchors(filePath, ["authenticateUser"], {
        baseDir: root,
        includeDocstrings: true,
      });
      expect(withDocs.length).toBe(1);
      expect(withDocs[0]?.startLine).toBe(1);
      expect(withDocs[0]?.contextSnippet).toContain("Core authentication service.");

      const withoutDocs = extractFileAnchors(filePath, ["authenticateUser"], {
        baseDir: root,
        includeDocstrings: false,
      });
      expect(withoutDocs.length).toBe(1);
      expect(withoutDocs[0]?.startLine).toBe(4);
      expect(withoutDocs[0]?.contextSnippet.startsWith("export function authenticateUser")).toBe(
        true,
      );
    });

    it("handles destructured bindings and multi-declarator scope isolation", () => {
      const source = `
/**
 * Leading docstring for first declarator.
 */
export const first = 1, second = 2;

export const { alpha, beta } = { alpha: "a", beta: "b" };
`;
      const symbols = extractSymbolsFromSource(source, "bindings.ts");
      const firstSym = symbols.find((s) => s.name === "first");
      const secondSym = symbols.find((s) => s.name === "second");
      const alphaSym = symbols.find((s) => s.name === "alpha");
      const betaSym = symbols.find((s) => s.name === "beta");

      expect(firstSym).toBeDefined();
      expect(firstSym?.enclosingStartLine).toBe(2);
      expect(firstSym?.docstring).toContain("Leading docstring");

      expect(secondSym).toBeDefined();
      // Second declarator isolates from first docstring
      expect(secondSym?.enclosingStartLine).toBe(secondSym?.declarationStartLine);
      expect(secondSym?.docstring).toBeUndefined();

      expect(alphaSym).toBeDefined();
      expect(betaSym).toBeDefined();
      expect(alphaSym?.kind).toBe("const");
      expect(betaSym?.kind).toBe("const");
    });
  });

  describe("Challenge 2: Regex-Safe Symbol Fallback & Depth-Aware Block Scanning", () => {
    it("escapes regex metacharacters in symbol names and queries", () => {
      expect(escapeRegExp("calculate$Sum(a+b)")).toBe("calculate\\$Sum\\(a\\+b\\)");
      expect(escapeRegExp("type[T]|null?*^")).toBe("type\\[T\\]\\|null\\?\\*\\^");
    });

    it("tracks nested braces, strings with braces, and comments without slicing blocks", () => {
      const lines = [
        "export function complexOperation() {",
        "  const template = `brace inside template: { not a block }`;",
        '  const str = "{ also not a block }";',
        "  // comment with opening brace {",
        "  /* multi-line comment with { */",
        "  if (true) {",
        "    return { status: 'ok' };",
        "  }",
        "}",
        "export const nextLine = true;",
      ];

      const boundary = findBalancedBlock(lines, 0);
      expect(boundary.startLine).toBe(1);
      expect(boundary.endLine).toBe(9);
      expect(boundary.text).toContain("complexOperation");
      expect(boundary.text.endsWith("}")).toBe(true);
      expect(boundary.text).not.toContain("nextLine");
    });

    it("terminates early on semicolon-terminated single statement outside braces", () => {
      const lines = [
        "export const CONFIG_MAX_LIMIT = 5000;",
        "export const NEXT_LINE = 100;",
        "export function nextFunction() {}",
      ];
      const boundary = findBalancedBlock(lines, 0);
      expect(boundary.startLine).toBe(1);
      expect(boundary.endLine).toBe(1);
      expect(boundary.text).toBe("export const CONFIG_MAX_LIMIT = 5000;");
    });

    it("safely finds pattern anchor even when pattern has special characters", () => {
      const root = scratchRoot("regex-pattern-matching");
      mkdirSync(root, { recursive: true });
      const filePath = join(root, "patterns.ts");
      const content = `// Header
export const config$Map = {
  key: "value (test)"
};
`;
      writeFileSync(filePath, content, "utf-8");

      const anchor = findAnchorByPattern(filePath, "config$Map", root);
      expect(anchor).toBeDefined();
      expect(anchor?.startLine).toBe(2);
      expect(anchor?.endLine).toBe(4);
    });
  });

  describe("Challenge 3: Generic Languages Multi-Line Body Enclosure", () => {
    it("encloses Python multi-line functions and classes using indentation boundary tracking", () => {
      const pySource = `
def calculate_metrics(data):
    total = sum(data)
    average = total / len(data) if data else 0
    return {
        "total": total,
        "average": average
    }

class MetricsCalculator:
    def __init__(self):
        self.count = 0

    def compute(self, x):
        return x * 2

def standalone():
    pass
`;
      const symbols = extractSymbolsFromSource(pySource, "calculator.py");
      const fn = symbols.find((s) => s.name === "calculate_metrics");
      expect(fn).toBeDefined();
      expect(fn?.startLine).toBe(2);
      expect(fn?.endLine).toBe(8); // Lines 2 to 8

      const cls = symbols.find((s) => s.name === "MetricsCalculator");
      expect(cls).toBeDefined();
      expect(cls?.startLine).toBe(10);
      expect(cls?.endLine).toBe(15);
    });

    it("encloses Rust and Go function bodies with balanced braces", () => {
      const rsSource = `
pub fn compute_sum(a: i32, b: i32) -> i32 {
    let result = a + b;
    result
}
`;
      const rsSymbols = extractSymbolsFromSource(rsSource, "lib.rs");
      const rsFn = rsSymbols.find((s) => s.name === "compute_sum");
      expect(rsFn).toBeDefined();
      expect(rsFn?.startLine).toBe(2);
      expect(rsFn?.endLine).toBe(5);

      const goSource = `
func ProcessRequest(req string) (string, error) {
    if req == "" {
        return "", errors.New("empty")
    }
    return req, nil
}
`;
      const goSymbols = extractSymbolsFromSource(goSource, "handler.go");
      const goFn = goSymbols.find((s) => s.name === "ProcessRequest");
      expect(goFn).toBeDefined();
      expect(goFn?.startLine).toBe(2);
      expect(goFn?.endLine).toBe(7);
    });
  });

  describe("Challenge 4: Write-Scope Directory Expansion & Planned Path Disambiguation", () => {
    it("expands directory write-scopes into candidate files and filters out gitignored/scratch paths", () => {
      const root = scratchRoot("write-scope-expansion");
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
    });

    it("disambiguates planned code files from planned extensionless directory paths", () => {
      expect(isTargetFilePath("src/index.ts")).toBe(true);
      expect(isTargetFilePath("src/components/button.tsx")).toBe(true);
      expect(isTargetFilePath("src/modules/auth/service.ts")).toBe(true);
      expect(isTargetFilePath("src/modules/auth")).toBe(false); // extensionless planned dir
      expect(isTargetFilePath("src/cli/")).toBe(false);
      expect(isTargetFilePath("src/image.png")).toBe(false);
      expect(isTargetFilePath("package-lock.json")).toBe(true);
      expect(isTargetFilePath("bun.lockb")).toBe(false);

      const root = scratchRoot("planned-disambiguation");
      const expanded = expandWriteScope(
        ["src/modules/auth/service.ts", "src/modules/auth", "src/auth/"],
        root,
      );
      expect(expanded).toContain("src/modules/auth/service.ts");
      expect(expanded).not.toContain("src/modules/auth");
      expect(expanded).not.toContain("src/auth/");
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
      const root = scratchRoot("briefing-full-pipeline");
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
        gateCommands: ["bun test tests/unit/pipe.test.ts"],
      });

      expect(briefing.taskId).toBe("task-pipe-42");
      expect(briefing.markdown).toContain(
        "### 🌌 Zero-Exploration Exact-Anchor Briefing: task-pipe-42",
      );
      expect(briefing.markdown).toContain("runPipeline");
      expect(briefing.markdown).toContain("bun test tests/unit/pipe.test.ts");
      expect(briefing.symbols.some((s) => s.name === "runPipeline")).toBe(true);
      expect(briefing.anchors.length).toBeGreaterThan(0);
      expect(briefing.waitMsMandate).toBe(10000);
    });
  });
});
