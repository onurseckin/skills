import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  escapeRegExp,
  extractFileAnchors,
  extractSymbolsFromSource,
  findAnchorByPattern,
  findBalancedBlock,
} from "../../../olt/scripts/src/cli/briefing/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../commands/fixtures/full-lifecycle-fixture.ts";

describe("Domain 17: Zero-Exploration Exact-Anchor Briefing Engine - AST & Patterns", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });
  afterEach(() => {
    cleanupVirtualCliFS();
  });
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
      const root = "/virtual/briefing-doc";
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
      const root = "/virtual/briefing-pat";
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
      expect(fn?.endLine).toBe(8);

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
});
