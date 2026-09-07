import { describe, expect, it } from "bun:test";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { type Envelope } from "../../src/core/index.ts";
import { type HealthPorts } from "../../src/daemon/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import { processAutoAcknowledge } from "../../src/work/index.ts";

function createHealthPorts(vfs: ChatVirtualFS): HealthPorts {
  return {
    existsSync: (target: string) => vfs.existsSync(target),
    readFileSync: (target: string, encoding: string) =>
      vfs.readFileSync(target, encoding) as string,
    writeFileSync: (target: string, content: string) => {
      const dir = dirname(target);
      if (!vfs.existsSync(dir)) {
        vfs.mkdirSync(dir, { recursive: true });
      }
      vfs.writeFileSync(target, content);
    },
  };
}

function writeVfs(vfs: ChatVirtualFS, filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!vfs.existsSync(dir)) {
    vfs.mkdirSync(dir, { recursive: true });
  }
  vfs.writeFileSync(filePath, content);
}

function extractAllStringLiterals(sourceFile: ts.SourceFile): readonly string[] {
  const literals: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return literals;
}

function extractStatusAssignments(sourceFile: ts.SourceFile): readonly string[] {
  const violations: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      if (ts.isPropertyAccessExpression(left) && left.name.text === "status") {
        violations.push(`Assignment to .status at position ${node.getStart()}`);
      }
      if (
        ts.isElementAccessExpression(left) &&
        left.argumentExpression !== undefined &&
        ts.isStringLiteral(left.argumentExpression) &&
        left.argumentExpression.text === "status"
      ) {
        violations.push(`Assignment to ['status'] at position ${node.getStart()}`);
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const propName = node.name.getText(sourceFile);
      if (propName === "status" || propName === '"status"' || propName === "'status'") {
        violations.push(`Property assignment { status: ... } at position ${node.getStart()}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return violations;
}

function extractEmittedSchemas(sourceFile: ts.SourceFile): readonly string[] {
  const schemas: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile);
      if (name === "schema" || name === '"schema"' || name === "'schema'") {
        if (ts.isStringLiteral(node.initializer)) {
          schemas.push(node.initializer.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return schemas;
}

function extractReachableCallNames(sourceFile: ts.SourceFile): readonly string[] {
  const callNames: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        callNames.push(node.expression.text);
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        callNames.push(node.expression.name.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return callNames;
}

describe("derived non-status-advance guard on read path", () => {
  it("asserts no function in read.ts or auto-ack.ts references chatroom.task.status.v1", async () => {
    const vfs = new ChatVirtualFS();
    const readPath = resolve(import.meta.dir, "../../src/cli/commands/read.ts");
    const autoAckPath = resolve(import.meta.dir, "../../src/work/auto-ack.ts");

    const readSource = await Bun.file(readPath).text();
    const autoAckSource = await Bun.file(autoAckPath).text();

    writeVfs(vfs, "/virtual/src/cli/commands/read.ts", readSource);
    writeVfs(vfs, "/virtual/src/work/auto-ack.ts", autoAckSource);

    const vfsReadSource = vfs.readFileSync("/virtual/src/cli/commands/read.ts", "utf8") as string;
    const vfsAutoAckSource = vfs.readFileSync("/virtual/src/work/auto-ack.ts", "utf8") as string;

    const readAst = ts.createSourceFile("read.ts", vfsReadSource, ts.ScriptTarget.Latest, true);
    const autoAckAst = ts.createSourceFile(
      "auto-ack.ts",
      vfsAutoAckSource,
      ts.ScriptTarget.Latest,
      true,
    );

    const readLiterals = extractAllStringLiterals(readAst);
    const autoAckLiterals = extractAllStringLiterals(autoAckAst);

    expect(readLiterals.includes("chatroom.task.status.v1")).toBe(false);
    expect(autoAckLiterals.includes("chatroom.task.status.v1")).toBe(false);

    const allLiterals = [...readLiterals, ...autoAckLiterals];
    for (const lit of allLiterals) {
      expect(lit).not.toBe("chatroom.task.status.v1");
    }
  });

  it("asserts auto-ack only emits chatroom.task.accepted.v1 and never status transitions", async () => {
    const vfs = new ChatVirtualFS();
    const autoAckPath = resolve(import.meta.dir, "../../src/work/auto-ack.ts");
    const autoAckSource = await Bun.file(autoAckPath).text();

    writeVfs(vfs, "/virtual/src/work/auto-ack.ts", autoAckSource);
    const code = vfs.readFileSync("/virtual/src/work/auto-ack.ts", "utf8") as string;
    const ast = ts.createSourceFile("auto-ack.ts", code, ts.ScriptTarget.Latest, true);

    const emittedSchemas = extractEmittedSchemas(ast);
    expect(emittedSchemas.length).toBeGreaterThan(0);
    for (const schema of emittedSchemas) {
      expect(schema).toBe("chatroom.task.accepted.v1");
      expect(schema).not.toBe("chatroom.task.status.v1");
    }
  });

  it("asserts reading can NEVER advance or change item.status via AST inspection", async () => {
    const vfs = new ChatVirtualFS();
    const readPath = resolve(import.meta.dir, "../../src/cli/commands/read.ts");
    const autoAckPath = resolve(import.meta.dir, "../../src/work/auto-ack.ts");

    const readSource = await Bun.file(readPath).text();
    const autoAckSource = await Bun.file(autoAckPath).text();

    writeVfs(vfs, "/virtual/src/cli/commands/read.ts", readSource);
    writeVfs(vfs, "/virtual/src/work/auto-ack.ts", autoAckSource);

    const readAst = ts.createSourceFile("read.ts", readSource, ts.ScriptTarget.Latest, true);
    const autoAckAst = ts.createSourceFile(
      "auto-ack.ts",
      autoAckSource,
      ts.ScriptTarget.Latest,
      true,
    );

    const readViolations = extractStatusAssignments(readAst);
    const autoAckViolations = extractStatusAssignments(autoAckAst);

    expect(readViolations).toEqual([]);
    expect(autoAckViolations).toEqual([]);
  });

  it("asserts reachable call expressions on read path contain no status emitters", async () => {
    const vfs = new ChatVirtualFS();
    const readPath = resolve(import.meta.dir, "../../src/cli/commands/read.ts");
    const autoAckPath = resolve(import.meta.dir, "../../src/work/auto-ack.ts");

    const readSource = await Bun.file(readPath).text();
    const autoAckSource = await Bun.file(autoAckPath).text();

    writeVfs(vfs, "/virtual/src/cli/commands/read.ts", readSource);
    writeVfs(vfs, "/virtual/src/work/auto-ack.ts", autoAckSource);

    const readAst = ts.createSourceFile("read.ts", readSource, ts.ScriptTarget.Latest, true);
    const autoAckAst = ts.createSourceFile(
      "auto-ack.ts",
      autoAckSource,
      ts.ScriptTarget.Latest,
      true,
    );

    const readCalls = extractReachableCallNames(readAst);
    const autoAckCalls = extractReachableCallNames(autoAckAst);

    const prohibitedPrefixes = ["advanceStatus", "transitionStatus", "updateStatus", "setStatus"];
    for (const callName of [...readCalls, ...autoAckCalls]) {
      for (const prefix of prohibitedPrefixes) {
        expect(callName.startsWith(prefix)).toBe(false);
      }
    }
  });

  it("asserts runtime reading preserves item status and never advances status", () => {
    const vfs = new ChatVirtualFS();
    const ports = createHealthPorts(vfs);
    const sampleStatuses = ["pending", "assigned", "todo", "blocked", "under_review"];
    for (const initialStatus of sampleStatuses) {
      const envelope: Envelope = {
        v: 1,
        id: `task-${initialStatus}`,
        room: "guard-room",
        seq: 1,
        ts: "2026-09-07T10:00:00.000Z",
        sender: {
          id: "manager-1",
          role: "manager",
          host: "localhost",
        },
        kind: "message",
        reply_to: null,
        mentions: ["reader-guard"],
        text: "Guard test task",
        body: {
          schema: "chatroom.task.new.v1",
          data: {
            task_id: `T-${initialStatus}`,
            assignee: "reader-guard",
            status: initialStatus,
          },
        },
        key_fingerprint: "guard-fp",
        sig: "guard-sig",
      };

      const result = processAutoAcknowledge("guard-room", "reader-guard", [envelope], ports);
      expect(result.length).toBe(1);

      const processed = result[0];
      expect(processed).toBeDefined();
      if (processed === undefined) {
        throw new Error("unreachable");
      }

      const processedData = processed.body.data as Record<string, unknown>;
      expect(processedData["status"]).toBe(initialStatus);
      expect(processedData["accepted_at"]).toBeDefined();
    }
  });
});
