import { Glob } from "bun";
import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import ts from "typescript";

interface BooleanLiteralViolation {
  readonly filePath: string;
  readonly interfaceName: string;
  readonly propertyName: string;
  readonly typeText: string;
}

function containsBooleanLiteralType(typeNode: ts.TypeNode): boolean {
  if (ts.isLiteralTypeNode(typeNode)) {
    return (
      typeNode.literal.kind === ts.SyntaxKind.TrueKeyword ||
      typeNode.literal.kind === ts.SyntaxKind.FalseKeyword
    );
  }
  let found = false;
  ts.forEachChild(typeNode, (child) => {
    if (ts.isTypeNode(child) && containsBooleanLiteralType(child)) {
      found = true;
    }
  });
  return found;
}

function findInterfaceBooleanLiteralViolations(
  sourceCode: string,
  filePath: string,
): readonly BooleanLiteralViolation[] {
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
  const violations: BooleanLiteralViolation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isInterfaceDeclaration(node)) {
      const interfaceName = node.name.text;
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.type !== undefined) {
          if (containsBooleanLiteralType(member.type)) {
            violations.push({
              filePath,
              interfaceName,
              propertyName: member.name.getText(sourceFile),
              typeText: member.type.getText(sourceFile),
            });
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

describe("Derived invariant: no boolean literal types in identity and core interfaces", () => {
  it("ensures no interface declares any property with a literal boolean type (: true or : false)", async () => {
    const targetDirs = [
      resolve(import.meta.dir, "../../src/identity"),
      resolve(import.meta.dir, "../../src/core"),
    ];

    const allViolations: BooleanLiteralViolation[] = [];
    let fileCount = 0;

    for (const targetDir of targetDirs) {
      const glob = new Glob("**/*.ts");
      const relativePaths = Array.from(glob.scanSync({ cwd: targetDir }));

      for (const relPath of relativePaths) {
        fileCount += 1;
        const fullPath = join(targetDir, relPath);
        const code = await Bun.file(fullPath).text();
        const violations = findInterfaceBooleanLiteralViolations(code, relPath);
        allViolations.push(...violations);
      }
    }

    expect(fileCount).toBeGreaterThanOrEqual(8);
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
