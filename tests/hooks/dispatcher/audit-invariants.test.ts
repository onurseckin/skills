import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Lifecycle Hooks - Invariant & Type Cleanliness Audit", () => {
  const sourceFiles = [
    join(process.cwd(), "olt/scripts/src/hooks/types.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/env.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/shell.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/audio.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/actions.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/dispatcher.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/index.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/config/constants.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/config/io.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/config/parser.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/config/resolver.ts"),
    join(process.cwd(), "olt/scripts/src/hooks/config/index.ts"),
    join(process.cwd(), "tests/hooks/dispatcher/audit-invariants.test.ts"),
  ];

  test("zero TypeScript any and zero suppressions across hook source files", () => {
    const anyAnnotation = new RegExp(":\\s*any\\b");
    const anyCast = new RegExp("as\\s+any\\b");
    const anyGeneric = new RegExp("<\\s*any\\s*>");
    const tsIgnore = "@" + "ts-ignore";
    const tsExpectError = "@" + "ts-expect-error";
    const tsNoCheck = "@" + "ts-nocheck";
    const suppressionDirectiveA = "eslint" + "-disable";
    const suppressionDirectiveB = "oxlint" + "-disable";

    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, "utf8");

      expect(content).not.toMatch(anyAnnotation);
      expect(content).not.toMatch(anyCast);
      expect(content).not.toMatch(anyGeneric);
      expect(content.includes(tsIgnore)).toBe(false);
      expect(content.includes(tsExpectError)).toBe(false);
      expect(content.includes(tsNoCheck)).toBe(false);
      expect(content.includes(suppressionDirectiveA)).toBe(false);
      expect(content.includes(suppressionDirectiveB)).toBe(false);
    }
  });

  test("zero comments across the hook source files", () => {
    const hookSources = sourceFiles.filter((p) => !p.includes("tests/hooks"));
    for (const filePath of hookSources) {
      const content = readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/\/\*/);
      expect(content).not.toMatch(/(^|[^:"])\/\/[^"]*$/m);
    }
  });
});
