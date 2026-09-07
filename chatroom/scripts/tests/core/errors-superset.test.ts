import { Glob } from "bun";
import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import ts from "typescript";
import { CHAT_ERROR_CODES } from "../../src/core/index.ts";

function extractThrownChatErrorCodes(sourceCode: string, fileName: string): readonly string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);
  const codes: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isThrowStatement(node) &&
      node.expression !== undefined &&
      ts.isNewExpression(node.expression)
    ) {
      const exprText = node.expression.expression.getText(sourceFile);
      if (
        exprText === "ChatError" &&
        node.expression.arguments !== undefined &&
        node.expression.arguments.length > 0
      ) {
        const firstArg = node.expression.arguments[0];
        if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
          codes.push(firstArg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return codes;
}

describe("ChatError error codes static invariant", () => {
  it("verifies CHAT_ERROR_CODES contains every thrown ChatError code across chatroom/scripts/src/", async () => {
    const srcDir = resolve(import.meta.dir, "../../src");
    const glob = new Glob("**/*.ts");
    const relativePaths = Array.from(glob.scanSync({ cwd: srcDir }));
    const thrownCodes = new Set<string>();

    for (const relPath of relativePaths) {
      const fullPath = join(srcDir, relPath);
      const code = await Bun.file(fullPath).text();
      for (const errorCode of extractThrownChatErrorCodes(code, relPath)) {
        thrownCodes.add(errorCode);
      }
    }

    expect(thrownCodes.size).toBeGreaterThan(0);
    const declaredCodes = new Set<string>(CHAT_ERROR_CODES);
    for (const thrownCode of thrownCodes) {
      expect(declaredCodes.has(thrownCode)).toBe(true);
    }
  });
});
