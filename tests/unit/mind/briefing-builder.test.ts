import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnchorSymbol,
  type ExactAnchor,
  buildExactAnchorBriefing,
  createDropInAnchor,
  deriveRecommendedTestCommands,
  extractFileAnchors,
  extractFileSymbols,
  extractSymbolsFromSource,
  findAnchorByPattern,
  formatExactAnchorBriefingMarkdown,
} from "../../../orchestrating-long-tasks/scripts/src/mind/briefing-builder.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

describe("briefing-builder unit test suite", () => {
  describe("extractSymbolsFromSource", () => {
    it("extracts comprehensive TypeScript declarations (functions, classes, interfaces, types, enums, vars)", () => {
      const source = `
/**
 * Global helper function for summation.
 */
export function calculateSum(a: number, b: number): number {
  return a + b;
}

function internalHelper(): void {}

/**
 * Service class for math operations.
 */
export class MathService {
  public precision: number;

  /**
   * Constructs the MathService.
   */
  constructor(precision: number) {
    this.precision = precision;
  }

  /**
   * Multiplies two numbers.
   */
  public multiply(x: number, y: number): number {
    return x * y;
  }
}

/**
 * Configuration options interface.
 */
export interface ServiceConfig {
  readonly timeoutMs: number;
  execute(query: string): boolean;
}

/**
 * Status union type.
 */
export type ServiceStatus = "idle" | "running" | "stopped" | "error" | "recovering";

/**
 * Long status type alias for testing signature truncation.
 */
export type LongStatusType = "status_alpha" | "status_beta" | "status_gamma" | "status_delta" | "status_epsilon" | "status_zeta";

export enum OperationMode {
  Fast = "fast",
  Safe = "safe",
}

export const arrowHandler = (msg: string): string => msg;
export const regularConst: number = 42;
export let mutableVar: string = "initial";
`;

      const symbols = extractSymbolsFromSource(source, "service.ts");
      expect(symbols.length).toBeGreaterThan(0);

      // Exported function with docstring
      const sumFn = symbols.find((s: AnchorSymbol): boolean => s.name === "calculateSum");
      expect(sumFn).toBeDefined();
      expect(sumFn?.kind).toBe("function");
      expect(sumFn?.exported).toBe(true);
      expect(sumFn?.startLine).toBeGreaterThan(0);
      expect(sumFn?.endLine).toBeGreaterThanOrEqual(sumFn?.startLine ?? 0);
      expect(sumFn?.signature).toBe("export function calculateSum(a: number, b: number): number");
      expect(sumFn?.docstring).toBe("Global helper function for summation.");

      // Non-exported function
      const intHelper = symbols.find((s: AnchorSymbol): boolean => s.name === "internalHelper");
      expect(intHelper).toBeDefined();
      expect(intHelper?.kind).toBe("function");
      expect(intHelper?.exported).toBe(false);

      // Class and members
      const cls = symbols.find((s: AnchorSymbol): boolean => s.name === "MathService");
      expect(cls).toBeDefined();
      expect(cls?.kind).toBe("class");
      expect(cls?.exported).toBe(true);
      expect(cls?.docstring).toBe("Service class for math operations.");

      const prop = symbols.find((s: AnchorSymbol): boolean => s.name === "MathService.precision");
      expect(prop).toBeDefined();
      expect(prop?.kind).toBe("property");

      const ctor = symbols.find((s: AnchorSymbol): boolean => s.name === "MathService.constructor");
      expect(ctor).toBeDefined();
      expect(ctor?.kind).toBe("method");
      expect(ctor?.docstring).toBe("Constructs the MathService.");

      const method = symbols.find((s: AnchorSymbol): boolean => s.name === "MathService.multiply");
      expect(method).toBeDefined();
      expect(method?.kind).toBe("method");
      expect(method?.docstring).toBe("Multiplies two numbers.");

      // Interface and members
      const iface = symbols.find((s: AnchorSymbol): boolean => s.name === "ServiceConfig");
      expect(iface).toBeDefined();
      expect(iface?.kind).toBe("interface");
      expect(iface?.exported).toBe(true);
      expect(iface?.docstring).toBe("Configuration options interface.");

      const ifaceProp = symbols.find(
        (s: AnchorSymbol): boolean => s.name === "ServiceConfig.timeoutMs",
      );
      expect(ifaceProp).toBeDefined();
      expect(ifaceProp?.kind).toBe("property");

      const ifaceMethod = symbols.find(
        (s: AnchorSymbol): boolean => s.name === "ServiceConfig.execute",
      );
      expect(ifaceMethod).toBeDefined();
      expect(ifaceMethod?.kind).toBe("method");

      // Type aliases
      const typeShort = symbols.find((s: AnchorSymbol): boolean => s.name === "ServiceStatus");
      expect(typeShort).toBeDefined();
      expect(typeShort?.kind).toBe("type");
      expect(typeShort?.exported).toBe(true);

      const typeLong = symbols.find((s: AnchorSymbol): boolean => s.name === "LongStatusType");
      expect(typeLong).toBeDefined();
      expect(typeLong?.kind).toBe("type");
      expect(typeLong?.signature).toContain("...");

      // Enum and members
      const enumSym = symbols.find((s: AnchorSymbol): boolean => s.name === "OperationMode");
      expect(enumSym).toBeDefined();
      expect(enumSym?.kind).toBe("enum");
      expect(enumSym?.exported).toBe(true);

      const enumMember = symbols.find(
        (s: AnchorSymbol): boolean => s.name === "OperationMode.Fast",
      );
      expect(enumMember).toBeDefined();
      expect(enumMember?.kind).toBe("property");

      // Variables & Arrow functions
      const arrowSym = symbols.find((s: AnchorSymbol): boolean => s.name === "arrowHandler");
      expect(arrowSym).toBeDefined();
      expect(arrowSym?.kind).toBe("function");

      const constSym = symbols.find((s: AnchorSymbol): boolean => s.name === "regularConst");
      expect(constSym).toBeDefined();
      expect(constSym?.kind).toBe("const");
      expect(constSym?.signature).toBe("regularConst: number");

      const varSym = symbols.find((s: AnchorSymbol): boolean => s.name === "mutableVar");
      expect(varSym).toBeDefined();
      expect(varSym?.kind).toBe("variable");
    });

    it("parses TSX and JSX files with JSX syntax", () => {
      const tsxSource = `
import React from "react";

export function ComponentButton(props: { label: string }): JSX.Element {
  return <button className="btn">{props.label}</button>;
}
`;
      const symbols = extractSymbolsFromSource(tsxSource, "Component.tsx");
      const btn = symbols.find((s: AnchorSymbol): boolean => s.name === "ComponentButton");
      expect(btn).toBeDefined();
      expect(btn?.kind).toBe("function");
      expect(btn?.exported).toBe(true);
    });

    it("extracts symbols from Python sources with export rules", () => {
      const pySource = `
def public_function(a, b):
    return a + b

async def async_fetch():
    return None

def _private_function():
    pass

class DataModel:
    pass

class _InternalModel:
    pass
`;
      const symbols = extractSymbolsFromSource(pySource, "module.py");
      expect(symbols.length).toBe(5);

      const pubFn = symbols.find((s: AnchorSymbol): boolean => s.name === "public_function");
      expect(pubFn).toBeDefined();
      expect(pubFn?.kind).toBe("function");
      expect(pubFn?.exported).toBe(true);

      const asyncFn = symbols.find((s: AnchorSymbol): boolean => s.name === "async_fetch");
      expect(asyncFn).toBeDefined();
      expect(asyncFn?.kind).toBe("function");
      expect(asyncFn?.exported).toBe(true);

      const privFn = symbols.find((s: AnchorSymbol): boolean => s.name === "_private_function");
      expect(privFn).toBeDefined();
      expect(privFn?.kind).toBe("function");
      expect(privFn?.exported).toBe(false);

      const cls = symbols.find((s: AnchorSymbol): boolean => s.name === "DataModel");
      expect(cls).toBeDefined();
      expect(cls?.kind).toBe("class");
      expect(cls?.exported).toBe(true);

      const privCls = symbols.find((s: AnchorSymbol): boolean => s.name === "_InternalModel");
      expect(privCls).toBeDefined();
      expect(privCls?.kind).toBe("class");
      expect(privCls?.exported).toBe(false);
    });

    it("extracts symbols from Markdown header sources", () => {
      const mdSource = `
# Title Overview
Intro text...

## Architecture Design
Details here...

### Invariant Checks
Rules...
`;
      const symbols = extractSymbolsFromSource(mdSource, "DOCS.md");
      expect(symbols.length).toBe(3);
      expect(symbols[0].name).toBe("Title Overview");
      expect(symbols[0].kind).toBe("other");
      expect(symbols[0].startLine).toBe(2);
      expect(symbols[1].name).toBe("Architecture Design");
      expect(symbols[2].name).toBe("Invariant Checks");
    });

    it("extracts symbols from Shell script functions", () => {
      const shSource = `
#!/usr/bin/env bash

function deploy_app() {
  echo "deploying"
}

run_tests() {
  bun test
}
`;
      const symbols = extractSymbolsFromSource(shSource, "deploy.sh");
      expect(symbols.length).toBe(2);
      expect(symbols[0].name).toBe("deploy_app");
      expect(symbols[0].kind).toBe("function");
      expect(symbols[0].exported).toBe(true);
      expect(symbols[1].name).toBe("run_tests");
      expect(symbols[1].kind).toBe("function");
      expect(symbols[1].exported).toBe(true);
    });

    it("handles empty source and non-matching generic files gracefully", () => {
      expect(extractSymbolsFromSource("", "empty.ts")).toEqual([]);
      expect(extractSymbolsFromSource("", "empty.py")).toEqual([]);
      expect(extractSymbolsFromSource("some random raw text without symbols", "notes.txt")).toEqual(
        [],
      );
    });
  });

  describe("extractFileSymbols", () => {
    it("returns empty array for non-existent file path", () => {
      const symbols = extractFileSymbols("non-existent-file-path-xyz-123.ts");
      expect(symbols).toEqual([]);
    });

    it("filters symbols by exact match, case-insensitivity, and dot parts", () => {
      const root = scratchRoot("extract-file-symbols");
      const filePath = join(root, "sample.ts");
      const content = `
export class TokenBucket {
  public refill(): void {}
  public consume(tokens: number): boolean { return true; }
}

export function createBucket(): TokenBucket {
  return new TokenBucket();
}
`;
      writeFileSync(filePath, content, "utf-8");

      // No targetSymbols -> all symbols
      const all = extractFileSymbols(filePath, undefined, root);
      expect(all.length).toBe(4);

      // Empty targetSymbols -> all symbols
      const allEmpty = extractFileSymbols(filePath, [], root);
      expect(allEmpty.length).toBe(4);

      // Exact match for class
      const classOnly = extractFileSymbols(filePath, ["TokenBucket"], root);
      expect(classOnly.length).toBe(1);
      expect(classOnly[0].name).toBe("TokenBucket");

      // Dot part match for method
      const methodOnly = extractFileSymbols(filePath, ["consume"], root);
      expect(methodOnly.length).toBe(1);
      expect(methodOnly[0].name).toBe("TokenBucket.consume");

      // Case-insensitive match
      const caseInsensitive = extractFileSymbols(filePath, ["CREATEBUCKET"], root);
      expect(caseInsensitive.length).toBe(1);
      expect(caseInsensitive[0].name).toBe("createBucket");

      // Unmatched symbol
      const unmatched = extractFileSymbols(filePath, ["NonExistentSymbol"], root);
      expect(unmatched).toEqual([]);
    });
  });

  describe("createDropInAnchor", () => {
    it("creates drop-in replacement anchor with default description", () => {
      const anchor = createDropInAnchor("src/core.ts", 15, 25, "const active = true;");
      expect(anchor.filePath).toBe("src/core.ts");
      expect(anchor.startLine).toBe(15);
      expect(anchor.endLine).toBe(25);
      expect(anchor.contextSnippet).toBe("const active = true;");
      expect(anchor.replacementTarget).toBe("const active = true;");
      expect(anchor.description).toBe("Drop-in replacement for lines 15–25");
    });

    it("creates drop-in replacement anchor with custom description", () => {
      const anchor = createDropInAnchor(
        "src/core.ts",
        10,
        12,
        "function compute() {}",
        "Custom replacement directive",
      );
      expect(anchor.description).toBe("Custom replacement directive");
    });
  });

  describe("findAnchorByPattern", () => {
    it("returns undefined for non-existent file", () => {
      const anchor = findAnchorByPattern("missing-file.ts", "somePattern");
      expect(anchor).toBeUndefined();
    });

    it("returns undefined when pattern is not found", () => {
      const root = scratchRoot("find-anchor-pattern-not-found");
      const filePath = join(root, "file.ts");
      writeFileSync(filePath, "const x = 1;\nconst y = 2;\n", "utf-8");

      const anchor = findAnchorByPattern(filePath, "definitelyNotHere", root);
      expect(anchor).toBeUndefined();
    });

    it("finds pattern with block end delimiter scanning", () => {
      const root = scratchRoot("find-anchor-pattern-block");
      const filePath = join(root, "file.ts");
      const content = [
        "// Header comment",
        "export function executeAction() {",
        "  const step = 1;",
        "  return step;",
        "}",
        "export const next = 2;",
      ].join("\n");
      writeFileSync(filePath, content, "utf-8");

      const anchor = findAnchorByPattern(filePath, /export function executeAction/, root);
      expect(anchor).toBeDefined();
      expect(anchor?.startLine).toBe(2);
      expect(anchor?.endLine).toBe(5);
      expect(anchor?.contextSnippet).toContain("export function executeAction() {");
      expect(anchor?.contextSnippet).toContain("}");
      expect(anchor?.replacementTarget).toBe(anchor?.contextSnippet);
      expect(anchor?.description).toContain(
        "Pattern match anchor for export function executeAction",
      );
    });

    it("handles string pattern and fallback line window when no block end delimiter", () => {
      const root = scratchRoot("find-anchor-pattern-fallback");
      const filePath = join(root, "file.txt");
      const lines = [
        "line 1",
        "TARGET_KEYWORD: value",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
      ];
      writeFileSync(filePath, lines.join("\n"), "utf-8");

      const anchor = findAnchorByPattern(filePath, "TARGET_KEYWORD", root);
      expect(anchor).toBeDefined();
      expect(anchor?.startLine).toBe(2);
      expect(anchor?.endLine).toBe(6);
    });
  });

  describe("extractFileAnchors", () => {
    it("returns empty array for non-existent file", () => {
      const anchors = extractFileAnchors("non-existent-target.ts");
      expect(anchors).toEqual([]);
    });

    it("extracts exact line ranges, symbol locations, and snippet truncations", () => {
      const root = scratchRoot("extract-file-anchors-symbols");
      const filePath = join(root, "long-file.ts");
      const longBody = Array.from(
        { length: 30 },
        (_: unknown, i: number): string => `  const step_${i} = ${i};`,
      ).join("\n");
      const content = `
export function shortFn(): number {
  return 1;
}

export function longFn(): void {
${longBody}
}
`;
      writeFileSync(filePath, content, "utf-8");

      // Extract specific symbol with default maxSnippetLines
      const shortAnchors = extractFileAnchors(filePath, ["shortFn"], { baseDir: root });
      expect(shortAnchors.length).toBe(1);
      expect(shortAnchors[0].symbolName).toBe("shortFn");
      expect(shortAnchors[0].symbolKind).toBe("function");
      expect(shortAnchors[0].startLine).toBe(2);
      expect(shortAnchors[0].endLine).toBe(4);
      expect(shortAnchors[0].contextSnippet).toContain("return 1;");
      expect(shortAnchors[0].replacementTarget).toContain("return 1;");
      expect(shortAnchors[0].description).toBe("function `shortFn` (lines 2–4)");

      // Extract long function with custom maxSnippetLines to verify truncation in contextSnippet
      const longAnchors = extractFileAnchors(filePath, ["longFn"], {
        baseDir: root,
        maxSnippetLines: 10,
      });
      expect(longAnchors.length).toBe(1);
      expect(longAnchors[0].symbolName).toBe("longFn");
      expect(longAnchors[0].contextSnippet).toContain("// ... (");
      expect(longAnchors[0].contextSnippet).toContain("more lines)");
      expect(longAnchors[0].replacementTarget).toContain("step_29"); // full replacement target untouched
    });

    it("falls back to pattern matching when target symbol is not found in AST", () => {
      const root = scratchRoot("extract-file-anchors-fallback-pattern");
      const filePath = join(root, "config.json");
      const content = `{\n  "version": "1.0.0",\n  "featureFlag": true\n}\n`;
      writeFileSync(filePath, content, "utf-8");

      const anchors = extractFileAnchors(filePath, ["featureFlag"], { baseDir: root });
      expect(anchors.length).toBe(1);
      expect(anchors[0].contextSnippet).toContain("featureFlag");
      expect(anchors[0].startLine).toBe(3);
    });

    it("falls back to full file anchor when no symbols or patterns match", () => {
      const root = scratchRoot("extract-file-anchors-fallback-full");
      const filePath = join(root, "plain.txt");
      const content = "line 1\nline 2\nline 3";
      writeFileSync(filePath, content, "utf-8");

      const anchors = extractFileAnchors(filePath, undefined, { baseDir: root });
      expect(anchors.length).toBe(1);
      expect(anchors[0].startLine).toBe(1);
      expect(anchors[0].endLine).toBe(3);
      expect(anchors[0].contextSnippet).toBe(content);
      expect(anchors[0].replacementTarget).toBe(content);
      expect(anchors[0].description).toContain("File anchor for");
    });
  });

  describe("deriveRecommendedTestCommands", () => {
    it("derives test commands from direct test files and gate commands", () => {
      const cmds = deriveRecommendedTestCommands(
        ["tests/unit/mind/briefing-builder.test.ts", "tests/core.spec.ts"],
        [
          "bun test tests/unit/mind/briefing-builder.test.ts",
          "npm test",
          "pytest tests/",
          "echo non-test-gate",
        ],
      );

      expect(cmds).toContain("bun test tests/unit/mind/briefing-builder.test.ts");
      expect(cmds).toContain("npm test");
      expect(cmds).toContain("pytest tests/");
      expect(cmds).not.toContain("echo non-test-gate");
      expect(cmds).toContain("bun test tests/core.spec.ts");
      expect(cmds).toContain("bun run typecheck");
      expect(cmds).toContain("bun run lint");
    });

    it("locates matching unit test file for non-test target source files", () => {
      const cmds = deriveRecommendedTestCommands([
        "orchestrating-long-tasks/scripts/src/mind/briefing-builder.ts",
      ]);
      expect(cmds).toContain("bun test tests/unit/mind/briefing-builder.test.ts");
      expect(cmds).toContain("bun run typecheck");
      expect(cmds).toContain("bun run lint");
    });

    it("deduplicates test commands", () => {
      const cmds = deriveRecommendedTestCommands(
        ["tests/unit/mind/briefing-builder.test.ts"],
        ["bun test tests/unit/mind/briefing-builder.test.ts"],
      );
      const testCmdCount = cmds.filter(
        (c: string): boolean => c === "bun test tests/unit/mind/briefing-builder.test.ts",
      ).length;
      expect(testCmdCount).toBe(1);
    });
  });

  describe("formatExactAnchorBriefingMarkdown", () => {
    it("formats a zero-exploration exact-anchor briefing with all mandatory sections and directives", () => {
      const sampleAnchor: ExactAnchor = {
        filePath: "src/calculator.ts",
        symbolName: "add",
        symbolKind: "function",
        startLine: 10,
        endLine: 15,
        contextSnippet: "export function add(a: number, b: number): number {\n  return a + b;\n}",
        replacementTarget:
          "export function add(a: number, b: number): number {\n  return a + b;\n}",
        description: "function `add` (lines 10–15)",
      };

      const sampleSymbol: AnchorSymbol = {
        name: "add",
        kind: "function",
        startLine: 10,
        endLine: 15,
        signature: "export function add(a: number, b: number): number",
        exported: true,
      };

      const markdown = formatExactAnchorBriefingMarkdown({
        taskId: "task-01-calc",
        label: "Implement Add Operation",
        writeScope: ["src/calculator.ts"],
        targetFiles: ["src/calculator.ts"],
        anchors: [sampleAnchor],
        symbols: [sampleSymbol],
        gateCommands: ["bun test tests/calc.test.ts"],
        acceptanceCriteria: ["All tests pass with 0 errors"],
        recommendedCommands: ["bun test tests/calc.test.ts", "bun run typecheck"],
        waitMsMandate: 10000,
      });

      // Verification of header and task info
      expect(markdown).toContain("### 🌌 Zero-Exploration Exact-Anchor Briefing: task-01-calc");
      expect(markdown).toContain("- **Task ID**: `task-01-calc`");
      expect(markdown).toContain("- **Label**: Implement Add Operation");
      expect(markdown).toContain("- **Assigned Write Scope**: `src/calculator.ts`");
      expect(markdown).toContain("Modifying any other file is a critical integrity violation.");
      expect(markdown).toContain("- **Target Files**: `src/calculator.ts`");

      // Verification of Anchors & Replacement targets
      expect(markdown).toContain("#### 📌 Exact Code Anchors & Replacement Targets");
      expect(markdown).toContain("##### File: `src/calculator.ts`");
      expect(markdown).toContain("- **Anchor**: function `add` (lines 10–15)");
      expect(markdown).toContain("```typescript");
      expect(markdown).toContain("export function add(a: number, b: number): number");

      // Verification of Symbol Map
      expect(markdown).toContain("#### 🗺️ Symbol Map");
      expect(markdown).toContain(
        "| `add` | `function` | 10–15 | Yes | `export function add(a: number, b: number): number` |",
      );

      // Verification of Commands & Criteria
      expect(markdown).toContain("#### 🧪 Recommended Verification Commands");
      expect(markdown).toContain("- `bun test tests/calc.test.ts`");
      expect(markdown).toContain("- `bun run typecheck`");

      expect(markdown).toContain("#### 🚪 Gate Commands");
      expect(markdown).toContain("- `bun test tests/calc.test.ts`");

      expect(markdown).toContain("#### ✅ Acceptance Criteria");
      expect(markdown).toContain("- All tests pass with 0 errors");

      // Mandatory Directives: WaitMsBeforeAsync mandate, scope, types, task submission
      expect(markdown).toContain("#### ⚡ Mandatory Execution Directives");
      expect(markdown).toContain(
        "1. **WaitMsBeforeAsync Mandate**: Always specify `WaitMsBeforeAsync: 10000` on all `run_command` invocations for deterministic synchronous execution.",
      );
      expect(markdown).toContain(
        "2. **Disjoint Write Scope Invariant**: Confine 100% of code modifications strictly to assigned write scope (`src/calculator.ts`).",
      );
      expect(markdown).toContain(
        "3. **Zero 'any' / Zero Suppressions**: 0 `any` annotations, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 `eslint-disable`.",
      );
      expect(markdown).toContain(
        '4. **Task Submission**: Submit completed task via `bun ./orchestrating-long-tasks/scripts/harness.ts task:submit --run <run> --task task-01-calc --agent <agent> --token <token> --summary "<summary>"`.',
      );
    });

    it("formats markdown when anchors and symbols are empty and writeScope is empty", () => {
      const markdown = formatExactAnchorBriefingMarkdown({
        taskId: "task-empty",
        label: "Empty Task",
        writeScope: [],
        targetFiles: [],
        anchors: [],
        symbols: [],
        gateCommands: [],
        acceptanceCriteria: [],
        recommendedCommands: [],
        waitMsMandate: 10000,
      });

      expect(markdown).toContain("- **Assigned Write Scope**: `none`");
      expect(markdown).toContain(
        "- No existing file anchors extracted. Target files may be newly created within your assigned write scope.",
      );
      expect(markdown).not.toContain("#### 🗺️ Symbol Map");
      expect(markdown).not.toContain("#### 🧪 Recommended Verification Commands");
      expect(markdown).not.toContain("#### 🚪 Gate Commands");
    });
  });

  describe("buildExactAnchorBriefing", () => {
    it("builds a complete briefing object with exact anchors, symbols, default criteria, and 10000 waitMsMandate", () => {
      const briefing = buildExactAnchorBriefing({
        taskId: "task-test-briefing-builder",
        label: "Unit test suite for briefing-builder",
        writeScope: ["orchestrating-long-tasks/scripts/src/mind/briefing-builder.ts"],
        targetSymbols: ["extractSymbolsFromSource", "buildExactAnchorBriefing"],
      });

      expect(briefing.taskId).toBe("task-test-briefing-builder");
      expect(briefing.label).toBe("Unit test suite for briefing-builder");
      expect(briefing.waitMsMandate).toBe(10000);
      expect(briefing.writeScope).toEqual([
        "orchestrating-long-tasks/scripts/src/mind/briefing-builder.ts",
      ]);
      expect(briefing.targetFiles).toEqual([
        "orchestrating-long-tasks/scripts/src/mind/briefing-builder.ts",
      ]);

      // Anchors & symbols
      expect(briefing.anchors.length).toBeGreaterThanOrEqual(2);
      expect(briefing.symbols.length).toBeGreaterThanOrEqual(2);
      expect(
        briefing.symbols.some((s: AnchorSymbol): boolean => s.name === "extractSymbolsFromSource"),
      ).toBe(true);
      expect(
        briefing.symbols.some((s: AnchorSymbol): boolean => s.name === "buildExactAnchorBriefing"),
      ).toBe(true);

      // Default acceptance criteria check
      expect(briefing.acceptanceCriteria).toEqual([
        "Strict type safety: 0 'any' types, 0 compiler suppressions (@ts-ignore, @ts-expect-error, eslint-disable).",
        "Strict disjoint write scope: Only modify files in assigned write scope (orchestrating-long-tasks/scripts/src/mind/briefing-builder.ts).",
        "All verification commands pass cleanly with exit code 0.",
        "Mandate WaitMsBeforeAsync: 10000 on all run_command invocations.",
      ]);

      // Recommended commands
      expect(briefing.recommendedCommands).toContain(
        "bun test tests/unit/mind/briefing-builder.test.ts",
      );
      expect(briefing.recommendedCommands).toContain("bun run typecheck");
      expect(briefing.recommendedCommands).toContain("bun run lint");

      // Markdown output
      expect(briefing.markdown).toContain(
        "Zero-Exploration Exact-Anchor Briefing: task-test-briefing-builder",
      );
      expect(briefing.markdown).toContain("WaitMsBeforeAsync: 10000");
    });

    it("respects custom targetFiles, gateCommands, and acceptanceCriteria overrides", () => {
      const root = scratchRoot("build-briefing-custom");
      const testFilePath = join(root, "custom.ts");
      writeFileSync(testFilePath, "export function customOp(): void {}\n", "utf-8");

      const briefing = buildExactAnchorBriefing({
        taskId: "task-custom",
        label: "Custom Task",
        writeScope: ["custom/"],
        targetFiles: [testFilePath],
        gateCommands: ["bun test tests/custom.test.ts"],
        acceptanceCriteria: ["Custom criterion 1", "Custom criterion 2"],
        recommendedCommands: ["bun test tests/custom.test.ts"],
        baseDir: root,
      });

      expect(briefing.targetFiles).toEqual([testFilePath]);
      expect(briefing.gateCommands).toEqual(["bun test tests/custom.test.ts"]);
      expect(briefing.acceptanceCriteria).toEqual(["Custom criterion 1", "Custom criterion 2"]);
      expect(briefing.recommendedCommands).toEqual(["bun test tests/custom.test.ts"]);
      expect(briefing.markdown).toContain("- Custom criterion 1");
      expect(briefing.markdown).toContain("- Custom criterion 2");
    });
  });
});
