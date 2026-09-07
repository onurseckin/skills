import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import ts from "typescript";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import { origRead } from "../../../olt/scripts/src/testing/virtual-fs/handlers.ts";

const mockFs = {
  readFileSync: (filePath: string, encoding: BufferEncoding = "utf-8"): string =>
    origRead(filePath, encoding),
};

export interface ExtractedHandlerFlags {
  readonly readFlags: readonly string[];
  readonly assertedFlags: readonly string[];
  readonly supportedFlags: readonly string[];
}

export function extractHandlerFlags(sourceCode: string, fileName: string): ExtractedHandlerFlags {
  const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);
  const read = new Set<string>();
  const asserted = new Set<string>();
  const localArrays = new Map<string, readonly string[]>();

  function scanLocals(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      const items = node.initializer.elements
        .filter((el): el is ts.StringLiteral => ts.isStringLiteral(el))
        .map((el) => el.text);
      localArrays.set(node.name.text, items);
    }
    ts.forEachChild(node, scanLocals);
  }
  scanLocals(sourceFile);

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fnName = node.expression.text;
      if (
        fnName === "textFlag" ||
        fnName === "boolFlag" ||
        fnName === "listFlag" ||
        fnName === "integerFlag" ||
        fnName === "parseOptionalText" ||
        fnName === "readFlag"
      ) {
        const arg = node.arguments[1];
        if (arg !== undefined && ts.isStringLiteral(arg)) {
          read.add(arg.text);
        }
      } else if (fnName === "assertFlags") {
        const arg = node.arguments[1];
        if (arg !== undefined && ts.isArrayLiteralExpression(arg)) {
          for (const el of arg.elements) {
            if (ts.isStringLiteral(el)) {
              asserted.add(el.text);
            }
          }
        } else if (arg !== undefined && ts.isIdentifier(arg) && localArrays.has(arg.text)) {
          const items = localArrays.get(arg.text);
          if (items !== undefined) {
            for (const item of items) {
              asserted.add(item);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  const readList = Array.from(read).sort();
  const assertedList = Array.from(asserted).sort();
  const supportedList = Array.from(new Set([...read, ...asserted])).sort();

  return {
    readFlags: readList,
    assertedFlags: assertedList,
    supportedFlags: supportedList,
  };
}

describe("Registry Handler Flag Conformance AST Invariant", () => {
  const commandsDir = resolve(import.meta.dir, "../../../olt/scripts/src/cli/commands");

  it("asserts bidirectional flag conformance for defect:audit (Item 4)", () => {
    const spec = findCommand("defect:audit");
    expect(spec).toBeDefined();
    if (spec === undefined) return;

    const sourcePath = join(commandsDir, "defect-audit.ts");
    const sourceCode = mockFs.readFileSync(sourcePath, "utf-8");
    const extracted = extractHandlerFlags(sourceCode, "defect-audit.ts");

    const declaredFlags = spec.flags.map((f) => f.name).sort();
    const missingInHandler = declaredFlags.filter((f) => !extracted.supportedFlags.includes(f));
    const missingInRegistry = extracted.supportedFlags.filter((f) => !declaredFlags.includes(f));

    expect(missingInHandler).toEqual([]);
    expect(missingInRegistry).toEqual([]);
    expect(declaredFlags).toEqual(extracted.assertedFlags);

    const previouslyDeadFlags = [
      { name: "auto-promote", type: "bool" },
      { name: "promote", type: "string" },
      { name: "generate-tests", type: "bool" },
      { name: "output-tests", type: "string" },
      { name: "completed-file", type: "string" },
      { name: "dry-run", type: "bool" },
    ] as const;

    for (const deadFlag of previouslyDeadFlags) {
      expect(extracted.readFlags).toContain(deadFlag.name);
      expect(extracted.assertedFlags).toContain(deadFlag.name);
      const regFlag = spec.flags.find((f) => f.name === deadFlag.name);
      expect(regFlag).toBeDefined();
      expect(regFlag?.type).toBe(deadFlag.type);
      expect(regFlag?.required).toBe(false);
    }
  });

  it("asserts bidirectional flag conformance across audited CLI commands", () => {
    const auditedCommandPairs: readonly [string, string][] = [
      ["defect:audit", "defect-audit.ts"],
      ["meta-audit", "meta-audit.ts"],
      ["task:abandon", "task-abandon.ts"],
      ["quota:check", "quota-check.ts"],
      ["quota:freeze", "quota-freeze.ts"],
      ["test:summary", "test-summary.ts"],
      ["mind:candidate", "mind-candidate.ts"],
      ["mind:escalate", "mind-escalate.ts"],
      ["mind:halt", "mind-halt.ts"],
      ["msg:send", "msg-send.ts"],
      ["msg:listen", "msg-listen.ts"],
      ["msg:list", "msg-list.ts"],
      ["msg:health", "msg-health.ts"],
      ["role:list", "role-list.ts"],
      ["role:profile", "role-profile.ts"],
      ["role:cheat-sheet", "role-cheat-sheet.ts"],
      ["hygiene:audit", "hygiene-audit.ts"],
      ["hygiene:fix", "hygiene-fix.ts"],
    ];

    for (const [commandName, fileName] of auditedCommandPairs) {
      const spec = findCommand(commandName);
      expect(spec).toBeDefined();
      if (spec === undefined) continue;

      const sourcePath = join(commandsDir, fileName);
      const sourceCode = mockFs.readFileSync(sourcePath, "utf-8");
      const extracted = extractHandlerFlags(sourceCode, fileName);

      const declaredFlags = spec.flags.map((f) => f.name).sort();
      const missingInHandler = declaredFlags.filter((f) => !extracted.supportedFlags.includes(f));
      const missingInRegistry = extracted.supportedFlags.filter((f) => !declaredFlags.includes(f));

      expect(missingInHandler).toEqual([]);
      expect(missingInRegistry).toEqual([]);
    }
  });

  it("asserts exact match between assertFlags and registry declaration for defect:audit and meta-audit", () => {
    const strictCommands = [
      { name: "defect:audit", file: "defect-audit.ts" },
      { name: "meta-audit", file: "meta-audit.ts" },
    ];

    for (const { name, file } of strictCommands) {
      const spec = findCommand(name);
      expect(spec).toBeDefined();
      if (spec === undefined) continue;

      const sourcePath = join(commandsDir, file);
      const sourceCode = mockFs.readFileSync(sourcePath, "utf-8");
      const extracted = extractHandlerFlags(sourceCode, file);

      const declaredFlags = spec.flags.map((f) => f.name).sort();
      expect(extracted.assertedFlags).toEqual(declaredFlags);
    }
  });
});
