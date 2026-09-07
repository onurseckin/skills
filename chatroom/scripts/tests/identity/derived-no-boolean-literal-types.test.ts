import { Glob } from "bun";
import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import ts from "typescript";

interface BooleanLiteralViolation {
  readonly filePath: string;
  readonly typeName: string;
  readonly interfaceName: string;
  readonly propertyName: string;
  readonly typeText: string;
}

interface ArmProperty {
  readonly name: string;
  readonly literal: "true" | "false";
  readonly typeText: string;
}

function findBooleanLiteral(typeNode: ts.TypeNode): "true" | "false" | null {
  if (ts.isLiteralTypeNode(typeNode)) {
    if (typeNode.literal.kind === ts.SyntaxKind.TrueKeyword) return "true";
    if (typeNode.literal.kind === ts.SyntaxKind.FalseKeyword) return "false";
  }
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return findBooleanLiteral(typeNode.type);
  }
  let found: "true" | "false" | null = null;
  ts.forEachChild(typeNode, (child) => {
    if (!found && ts.isTypeNode(child)) {
      found = findBooleanLiteral(child);
    }
  });
  return found;
}

function getPropertyName(name: ts.PropertyName, sourceFile: ts.SourceFile): string {
  const text = name.getText(sourceFile);
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function unwrapArmType(typeNode: ts.TypeNode): ts.TypeNode {
  let cur = typeNode;
  while (ts.isParenthesizedTypeNode(cur)) {
    cur = cur.type;
  }
  return cur;
}

function findBooleanLiteralViolations(
  sourceCode: string,
  filePath: string,
): readonly BooleanLiteralViolation[] {
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
  const violations: BooleanLiteralViolation[] = [];

  function checkUnion(typeName: string, unionNode: ts.UnionTypeNode): void {
    const armPropLists: ArmProperty[][] = [];

    for (const arm of unionNode.types) {
      const unwrapped = unwrapArmType(arm);
      if (ts.isTypeLiteralNode(unwrapped)) {
        const props: ArmProperty[] = [];
        for (const member of unwrapped.members) {
          if (ts.isPropertySignature(member) && member.type) {
            const lit = findBooleanLiteral(member.type);
            if (lit) {
              props.push({
                name: getPropertyName(member.name, sourceFile),
                literal: lit,
                typeText: member.type.getText(sourceFile),
              });
            }
          }
        }
        armPropLists.push(props);
      } else {
        armPropLists.push([]);
      }
    }

    for (let i = 0; i < armPropLists.length; i++) {
      const currentProps = armPropLists[i]!;
      for (const prop of currentProps) {
        const opposite = prop.literal === "true" ? "false" : "true";
        const hasOppositeSibling = armPropLists.some(
          (otherArm, otherIdx) =>
            otherIdx !== i && otherArm.some((p) => p.name === prop.name && p.literal === opposite),
        );
        if (!hasOppositeSibling) {
          violations.push({
            filePath,
            typeName,
            interfaceName: typeName,
            propertyName: prop.name,
            typeText: prop.typeText,
          });
        }
      }
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      const typeName = node.name.text;
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.type) {
          const lit = findBooleanLiteral(member.type);
          if (lit) {
            violations.push({
              filePath,
              typeName,
              interfaceName: typeName,
              propertyName: getPropertyName(member.name, sourceFile),
              typeText: member.type.getText(sourceFile),
            });
          }
        }
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      const typeName = node.name.text;
      const unwrapped = unwrapArmType(node.type);
      if (ts.isUnionTypeNode(unwrapped)) {
        checkUnion(typeName, unwrapped);
      } else if (ts.isTypeLiteralNode(unwrapped)) {
        for (const member of unwrapped.members) {
          if (ts.isPropertySignature(member) && member.type) {
            const lit = findBooleanLiteral(member.type);
            if (lit) {
              violations.push({
                filePath,
                typeName,
                interfaceName: typeName,
                propertyName: getPropertyName(member.name, sourceFile),
                typeText: member.type.getText(sourceFile),
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function getInterfacePropertyNames(
  sourceCode: string,
  targetInterfaceName: string,
): readonly string[] {
  const sourceFile = ts.createSourceFile("temp.ts", sourceCode, ts.ScriptTarget.Latest, true);
  const propertyNames: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === targetInterfaceName) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member)) {
          propertyNames.push(member.name.getText(sourceFile));
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return propertyNames;
}

describe("Derived invariant: AST sibling-arm rule for boolean literal types", () => {
  it("enforces sibling-arm rule on synthetic types", () => {
    const interfaceViolation = `
      interface TestInterface {
        readonly bad: true;
      }
    `;
    const v1 = findBooleanLiteralViolations(interfaceViolation, "test1.ts");
    expect(v1).toHaveLength(1);
    expect(v1[0]?.propertyName).toBe("bad");

    const typeLiteralViolation = `
      type TestType = {
        readonly bad: false;
      };
    `;
    const v2 = findBooleanLiteralViolations(typeLiteralViolation, "test2.ts");
    expect(v2).toHaveLength(1);
    expect(v2[0]?.propertyName).toBe("bad");

    const unpairedUnionViolation = `
      type Unpaired =
        | { readonly kind: "a"; readonly drained: true }
        | { readonly kind: "b" };
    `;
    const v3 = findBooleanLiteralViolations(unpairedUnionViolation, "test3.ts");
    expect(v3).toHaveLength(1);
    expect(v3[0]?.propertyName).toBe("drained");

    const pairedUnionValid = `
      type Paired =
        | { readonly success: true; readonly val: string }
        | { readonly success: false; readonly err: string };
    `;
    const v4 = findBooleanLiteralViolations(pairedUnionValid, "test4.ts");
    expect(v4).toHaveLength(0);

    const normalBooleanValid = `
      interface NormalProps {
        readonly drained: boolean;
        readonly fsynced: boolean;
      }
    `;
    const v5 = findBooleanLiteralViolations(normalBooleanValid, "test5.ts");
    expect(v5).toHaveLength(0);
  });

  it("ensures 0 violations across all chatroom/scripts/src directories", async () => {
    const srcDir = resolve(import.meta.dir, "../../src");
    const glob = new Glob("**/*.ts");
    const relativePaths = Array.from(glob.scanSync({ cwd: srcDir }));

    const requiredDirs = ["identity", "core", "cursor", "daemon", "room", "cli", "testing"];

    for (const dir of requiredDirs) {
      const hasDirFiles = relativePaths.some((p) => p.startsWith(`${dir}/`));
      expect(hasDirFiles).toBe(true);
    }

    const allViolations: BooleanLiteralViolation[] = [];
    for (const relPath of relativePaths) {
      const fullPath = join(srcDir, relPath);
      const code = await Bun.file(fullPath).text();
      const violations = findBooleanLiteralViolations(code, relPath);
      allViolations.push(...violations);
    }

    expect(relativePaths.length).toBeGreaterThanOrEqual(50);
    expect(allViolations).toEqual([]);
  });

  it("specifically asserts that Identity interface does not contain verified: true", async () => {
    const resolvePath = resolve(import.meta.dir, "../../src/identity/resolve.ts");
    const resolveSource = await Bun.file(resolvePath).text();

    const identityProperties = getInterfacePropertyNames(resolveSource, "Identity");

    expect(identityProperties).toContain("id");
    expect(identityProperties).toContain("role");
    expect(identityProperties).toContain("host");
    expect(identityProperties).toContain("source");
    expect(identityProperties).not.toContain("verified");

    expect(resolveSource).not.toContain("verified: true");
    expect(resolveSource).not.toContain("readonly verified: true");
  });
});
