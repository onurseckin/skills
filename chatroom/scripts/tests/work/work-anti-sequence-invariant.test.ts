import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";
import { mineSpec } from "../../src/cli/index.ts";
import * as registryModule from "../../src/cli/registry/index.ts";
import {
  CHAT_COMMANDS,
  type CommandSpec,
  taskSpec,
  topicSpec,
} from "../../src/cli/registry/index.ts";

const FORBIDDEN_SEQUENCE_FLAGS = new Set([
  "seq",
  "sequence",
  "since",
  "until",
  "from-seq",
  "to-seq",
  "offset",
  "cursor-seq",
]);

function hasForbiddenFlag(spec: CommandSpec): boolean {
  for (const flag of spec.flags) {
    const lower = flag.name.toLowerCase();
    if (lower === "reader" || FORBIDDEN_SEQUENCE_FLAGS.has(lower)) return true;
  }
  return false;
}

async function extractExportedSpecNames(filePath: string): Promise<readonly string[]> {
  const content = await Bun.file(filePath).text();
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const specNames: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const el of node.exportClause.elements) {
        if (!el.isTypeOnly && el.name.text.endsWith("Spec")) {
          specNames.push(el.name.text);
        }
      }
    } else if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text.endsWith("Spec")) {
            specNames.push(decl.name.text);
          }
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name && node.name.text.endsWith("Spec")) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExported) {
        specNames.push(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return specNames;
}

async function loadRegistryExportedSpecs(): Promise<readonly CommandSpec[]> {
  const registryPath = resolve(import.meta.dir, "../../src/cli/registry/index.ts");
  const names = await extractExportedSpecNames(registryPath);
  const reg = registryModule as Readonly<Record<string, unknown>>;
  return names.map((name) => {
    const val = reg[name];
    if (!val || typeof val !== "object" || !("name" in val) || !("flags" in val)) {
      throw new Error(`Export '${name}' is not a valid CommandSpec`);
    }
    return val as CommandSpec;
  });
}

function findUnwiredSpecs(
  allExportedSpecs: readonly CommandSpec[],
  registeredCommands: readonly CommandSpec[],
): readonly CommandSpec[] {
  const registeredNames = new Set(registeredCommands.map((cmd) => cmd.name));
  return allExportedSpecs.filter((spec) => !registeredNames.has(spec.name));
}

describe("Work Tracking Anti-Sequence Number Invariant", () => {
  it("Property 3: ANTI-SEQUENCE-NUMBER INVARIANT - no agent-facing command declares seq flags or names another member's cursor", async () => {
    const allExportedSpecs = await loadRegistryExportedSpecs();
    expect(allExportedSpecs.length).toBeGreaterThan(0);
    const unwiredSpecs = findUnwiredSpecs(allExportedSpecs, CHAT_COMMANDS);
    expect(unwiredSpecs).toHaveLength(0);

    for (const spec of allExportedSpecs) {
      expect(CHAT_COMMANDS).toContain(spec);
      expect(CHAT_COMMANDS.some((cmd) => cmd.name === spec.name)).toBe(true);
    }

    for (const cmd of CHAT_COMMANDS) {
      const flagNames = cmd.flags.map((flag) => flag.name.toLowerCase());
      expect(flagNames).not.toContain("reader");
    }

    const agentFacing = CHAT_COMMANDS.filter((cmd) => cmd.name !== "chat:inspect");
    for (const cmd of agentFacing) {
      for (const flag of cmd.flags) {
        expect(FORBIDDEN_SEQUENCE_FLAGS.has(flag.name.toLowerCase())).toBe(false);
      }
    }

    for (const spec of [taskSpec, topicSpec, mineSpec]) {
      const flagNames = spec.flags.map((f) => f.name.toLowerCase());
      expect(flagNames).not.toContain("reader");
      for (const f of flagNames) {
        expect(FORBIDDEN_SEQUENCE_FLAGS.has(f)).toBe(false);
      }
    }
  });

  it("Property 3 VACUITY PROOF: neutered command specs with reader or seq flags trigger violation (red) while registry commands pass (green)", async () => {
    const neuteredWithReader: CommandSpec = {
      ...taskSpec,
      flags: [
        ...taskSpec.flags,
        {
          name: "reader",
          type: "string",
          description: "foreign cursor",
          required: false,
          repeatable: false,
        },
      ],
    };
    const neuteredWithSeq: CommandSpec = {
      ...taskSpec,
      flags: [
        ...taskSpec.flags,
        {
          name: "seq",
          type: "int",
          description: "leaked sequence",
          required: false,
          repeatable: false,
        },
      ],
    };
    const neuteredWithSince: CommandSpec = {
      ...topicSpec,
      flags: [
        ...topicSpec.flags,
        {
          name: "since",
          type: "int",
          description: "leaked since",
          required: false,
          repeatable: false,
        },
      ],
    };
    const neuteredMineWithSeq: CommandSpec = {
      ...mineSpec,
      flags: [
        ...mineSpec.flags,
        {
          name: "seq",
          type: "int",
          description: "leaked sequence",
          required: false,
          repeatable: false,
        },
      ],
    };

    expect(hasForbiddenFlag(neuteredWithReader)).toBe(true);
    expect(hasForbiddenFlag(neuteredWithSeq)).toBe(true);
    expect(hasForbiddenFlag(neuteredWithSince)).toBe(true);
    expect(hasForbiddenFlag(neuteredMineWithSeq)).toBe(true);

    const agentFacing = CHAT_COMMANDS.filter((cmd) => cmd.name !== "chat:inspect");
    for (const cmd of agentFacing) {
      expect(hasForbiddenFlag(cmd)).toBe(false);
    }
    for (const spec of [taskSpec, topicSpec, mineSpec]) {
      expect(hasForbiddenFlag(spec)).toBe(false);
    }

    const registeredCommands = CHAT_COMMANDS;
    const syntheticSpec: CommandSpec = {
      ...taskSpec,
      name: "chat:synthetic-unwired",
      aliases: ["synthetic"],
    };
    const exportedSpecs = await loadRegistryExportedSpecs();
    const allExportedSpecs = [...exportedSpecs, syntheticSpec];
    expect(findUnwiredSpecs(allExportedSpecs, registeredCommands).length).toBeGreaterThan(0);
    expect(findUnwiredSpecs(exportedSpecs, registeredCommands).length).toBe(0);
  });
});
