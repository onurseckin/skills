import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  COMMAND_REGISTRY,
  findCommand,
  type CommandSpec,
} from "../../../olt/scripts/src/cli/registry/index.ts";
import { origExists, origRead } from "../../../olt/scripts/src/testing/virtual-fs/handlers.ts";

const mockFs = {
  readFileSync: (p: string, enc: BufferEncoding = "utf-8"): string => origRead(p, enc),
  existsSync: (p: string): boolean => origExists(p),
};

export interface ExtractedHandlerFlags {
  readonly readFlags: readonly string[];
  readonly assertedFlags: readonly string[];
  readonly supportedFlags: readonly string[];
}

export interface DerivedCommandMapping {
  readonly commandName: string;
  readonly handlerFile: string;
  readonly handlerFn?: string;
  readonly registryFile: string;
}

export interface FlagMismatchInventoryItem {
  readonly commandName: string;
  readonly handlerFilePath: string;
  readonly registryFilePath: string;
  readonly missingInRegistry: readonly string[];
  readonly missingInHandler: readonly string[];
  readonly unresolvable: boolean;
}

export const MAX_MISMATCH_COMMANDS_BASELINE = 41;
export const MAX_TOTAL_MISMATCHES_BASELINE = 174;

const commandsDir = resolve(import.meta.dir, "../../../olt/scripts/src/cli/commands");

const SPECIFIC_HANDLERS: Readonly<Record<string, string>> = Object.fromEntries(
  "authority:decide=authority-ops.ts;doctor=diagnostics-ops.ts;doctor:verify=diagnostics-ops.ts;doctor:repair=diagnostics-ops.ts;doctor:certify=../../reporting/doctor/certify-command.ts;events:stream=stream-events.ts;events:trace=dag.ts;explain=explain-ops.ts;finding:file=finding-ops.ts;finding:get=inspection-ops.ts;report:get=inspection-ops.ts;evidence:get=inspection-ops.ts;evidence:screenshots=inspection-ops.ts;health=reporting/index.ts;install=install-ops.ts;installation-status=install-ops.ts;memory:query=memory-ops.ts;mind:bootstrap=mind-init.ts;mind:decline=mind-admit.ts;orphan:dispose=orphan-ops.ts;recover=diagnostics-ops.ts;report=reporting/report-unified.ts;report:dag=reporting/report-dag.ts;report:summary=summary-ops.ts;report:task=inspection-ops.ts;report:health=unified-reporting.ts;report:leases=unified-reporting.ts;report:decisions=unified-reporting.ts;report:usage=usage-report.ts;report:graph-json=graph-export.ts;run:exec=run-ops.ts;run:complete=run-ops.ts;sched:jitter=sched-ops.ts;task:heartbeat=task-claim.ts;task:validate-start=task-validation-start.ts;task:release=diagnostics-ops.ts;task:fail=task-queue-ops.ts;task:prune=task-queue-ops.ts;task:submit=task-submit.ts"
    .split(";")
    .map((s) => {
      const idx = s.indexOf("=");
      return [s.slice(0, idx), s.slice(idx + 1)] as const;
    }),
);

export function resolveRegistryFile(commandName: string, domain: string): string {
  if (commandName.startsWith("watchdog:")) return "authority.ts";
  if (commandName === "doctor:certify" || commandName === "health") return "diagnostics.ts";
  if (domain === "mind")
    return commandName.startsWith("mind:round-") ? "mind/cmds2.ts" : "mind/cmds1.ts";
  if (domain === "task") return "task/index.ts";
  return domain === "worktree" ? "workflow.ts" : `${domain}.ts`;
}

export function resolveHandlerModule(
  name: string,
  handlerName: string,
): { file: string; fn?: string } | undefined {
  const slug = `${name.replaceAll(":", "-")}.ts`;
  if (mockFs.existsSync(join(commandsDir, slug))) return { file: slug, fn: handlerName };
  if (/^(branch|critic|defect|factory|policy|sentinel|smart-task|summary):/.test(name)) {
    return { file: `${name.split(":")[0]!}-ops.ts`, fn: handlerName };
  }
  if (name.startsWith("worktree:")) {
    const f = name === "worktree:reclaim" ? "worktree-reclaim-ops.ts" : "worktree-ops.ts";
    return { file: f, fn: handlerName };
  }
  if (name.startsWith("orchestrator:")) return { file: "orchestrator-ops.ts", fn: handlerName };
  if (name.startsWith("notify:")) return { file: "notify-ops.ts", fn: handlerName };
  if (name.startsWith("mind:round-")) return { file: "mind-round.ts", fn: handlerName };
  if (name.startsWith("dag:")) {
    const f = name === "dag:check" ? "dag-ops/dag-check.ts" : "dag-ops/dag-heal.ts";
    return { file: f, fn: handlerName };
  }
  if (name.startsWith("agent:")) {
    if (name === "agent:register") return { file: "agent-registration.ts", fn: handlerName };
    if (name === "agent:define") return { file: "agent-brief.ts", fn: "agentDefineCommand" };
    return { file: "agent-ops.ts", fn: handlerName };
  }
  if (/^queue:(add|drain|status|seal|clean)$/.test(name)) {
    return { file: "todo/index.ts", fn: handlerName };
  }
  if (name.startsWith("queue:")) return { file: "queue.ts", fn: handlerName };
  if (name === "plan:claim") return { file: "plan-apply.ts", fn: handlerName };
  if (name.startsWith("plan:validate") || name === "plan:review") {
    return { file: "plan-validate.ts", fn: handlerName };
  }
  if (name.startsWith("plan:")) return { file: "plan.ts", fn: handlerName };
  if (name.startsWith("watchdog:")) {
    const act = name.split(":")[1]!.replace("phase-cleanup", "cleanup");
    return { file: `watchdog-ops/${act}.ts`, fn: handlerName };
  }
  if (SPECIFIC_HANDLERS[name]) return { file: SPECIFIC_HANDLERS[name]!, fn: handlerName };
  return undefined;
}

export function resolveCommandMapping(cmd: CommandSpec): DerivedCommandMapping | undefined {
  const resolved = resolveHandlerModule(cmd.name, cmd.handler.name);
  if (!resolved) return undefined;
  return {
    commandName: cmd.name,
    handlerFile: resolved.file,
    handlerFn: resolved.fn,
    registryFile: resolveRegistryFile(cmd.name, cmd.domain),
  };
}

export function deriveCommandMappings(): readonly DerivedCommandMapping[] {
  return COMMAND_REGISTRY.map(resolveCommandMapping).filter(
    (m): m is DerivedCommandMapping => m !== undefined,
  );
}

function findDecl(node: ts.Node, name: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  function search(n: ts.Node): void {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      found = n;
      return;
    }
    if (ts.isVariableStatement(n)) {
      for (const decl of n.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          found = decl.initializer;
          return;
        }
      }
    }
    ts.forEachChild(n, search);
  }
  search(node);
  return found;
}

export function extractHandlerFlags(
  sourceCode: string,
  fileName: string,
  targetFn?: string,
): ExtractedHandlerFlags {
  const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);
  const read = new Set<string>();
  const asserted = new Set<string>();
  const localArrays = new Map<string, readonly string[]>();

  function scanLocals(n: ts.Node): void {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isArrayLiteralExpression(n.initializer)
    ) {
      localArrays.set(
        n.name.text,
        n.initializer.elements.filter(ts.isStringLiteral).map((e) => e.text),
      );
    }
    ts.forEachChild(n, scanLocals);
  }
  scanLocals(sourceFile);

  const rootNode =
    targetFn && targetFn !== "handler" && targetFn !== ""
      ? (findDecl(sourceFile, targetFn) ?? sourceFile)
      : sourceFile;

  const visitedFns = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const fn = node.expression.text;
        if (/^(textFlag|boolFlag|listFlag|integerFlag|parseOptionalText|readFlag)$/.test(fn)) {
          const arg = node.arguments[1];
          if (arg !== undefined && ts.isStringLiteral(arg)) read.add(arg.text);
        } else if (fn === "actorFlag") {
          read.add("actor");
        } else if (fn === "assertFlags") {
          const arg = node.arguments[1];
          if (arg && ts.isArrayLiteralExpression(arg)) {
            for (const el of arg.elements) if (ts.isStringLiteral(el)) asserted.add(el.text);
          } else if (arg && ts.isIdentifier(arg)) {
            for (const item of localArrays.get(arg.text) ?? []) asserted.add(item);
          }
        } else if (targetFn && !visitedFns.has(fn)) {
          visitedFns.add(fn);
          const helper = findDecl(sourceFile, fn);
          if (helper) visit(helper);
        }
      } else if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Object" &&
        node.expression.name.text === "hasOwn" &&
        node.arguments.length >= 2 &&
        ts.isIdentifier(node.arguments[0]!) &&
        node.arguments[0]!.text === "flags" &&
        ts.isStringLiteral(node.arguments[1]!)
      ) {
        read.add(node.arguments[1]!.text);
      }
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "flags" &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      read.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(rootNode);
  return {
    readFlags: Array.from(read).sort(),
    assertedFlags: Array.from(asserted).sort(),
    supportedFlags: Array.from(new Set([...read, ...asserted])).sort(),
  };
}

const makeUnresolvable = (
  cmd: string,
  hFile: string,
  rFile: string,
): FlagMismatchInventoryItem => ({
  commandName: cmd,
  handlerFilePath: hFile,
  registryFilePath: rFile,
  missingInRegistry: [],
  missingInHandler: [],
  unresolvable: true,
});

export function collectFlagMismatches(
  mappings: readonly DerivedCommandMapping[] = deriveCommandMappings(),
): readonly FlagMismatchInventoryItem[] {
  const inventory: FlagMismatchInventoryItem[] = [];
  const mappedNames = new Set(mappings.map((m) => m.commandName));

  for (const cmd of COMMAND_REGISTRY) {
    if (!mappedNames.has(cmd.name)) {
      const reg = join("olt/scripts/src/cli/registry", resolveRegistryFile(cmd.name, cmd.domain));
      inventory.push(makeUnresolvable(cmd.name, "UNRESOLVABLE", reg));
    }
  }

  for (const mapping of mappings) {
    const spec = findCommand(mapping.commandName);
    if (!spec) continue;

    const sourcePath = join(commandsDir, mapping.handlerFile);
    const reg = join("olt/scripts/src/cli/registry", mapping.registryFile);
    const cmdPath = join("olt/scripts/src/cli/commands", mapping.handlerFile);
    if (!mockFs.existsSync(sourcePath)) {
      inventory.push(makeUnresolvable(mapping.commandName, cmdPath, reg));
      continue;
    }

    const sourceCode = mockFs.readFileSync(sourcePath, "utf-8");
    const extracted = extractHandlerFlags(sourceCode, mapping.handlerFile, mapping.handlerFn);

    const declaredFlags = spec.flags.map((f) => f.name).sort();
    const missingInHandler = declaredFlags.filter((f) => !extracted.supportedFlags.includes(f));
    const missingInRegistry = extracted.supportedFlags.filter((f) => !declaredFlags.includes(f));

    if (missingInHandler.length > 0 || missingInRegistry.length > 0) {
      inventory.push({
        commandName: mapping.commandName,
        handlerFilePath: cmdPath,
        registryFilePath: reg,
        missingInRegistry,
        missingInHandler,
        unresolvable: false,
      });
    }
  }

  return inventory;
}

describe("Registry Handler Flag Conformance AST Invariant", () => {
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

    const dead =
      "auto-promote:bool,promote:string,generate-tests:bool,output-tests:string,completed-file:string,dry-run:bool"
        .split(",")
        .map((s) => s.split(":") as [string, string]);

    for (const [name, type] of dead) {
      expect(extracted.readFlags).toContain(name);
      expect(extracted.assertedFlags).toContain(name);
      const regFlag = spec.flags.find((f) => f.name === name);
      expect(regFlag).toBeDefined();
      expect(regFlag?.type).toBe(type);
      expect(regFlag?.required).toBe(false);
    }
  });

  it("derives command-to-handler mapping across all registered commands with zero unresolvable", () => {
    const mappings = deriveCommandMappings();
    expect(mappings.length).toBe(COMMAND_REGISTRY.length);
    for (const m of mappings) {
      const fullPath = join(commandsDir, m.handlerFile);
      expect(mockFs.existsSync(fullPath)).toBe(true);
    }
  });

  it("asserts bidirectional flag conformance across derived CLI commands", () => {
    const mappings = deriveCommandMappings();
    const mismatches = collectFlagMismatches(mappings);

    if (process.env["FLAG_CONFORMANCE_DIAGNOSTIC"] === "1") {
      process.stdout.write(JSON.stringify(mismatches, null, 2));
      return;
    }

    if (process.env["FLAG_CONFORMANCE_STRICT"] === "1") {
      expect(mismatches).toEqual([]);
      return;
    }

    const audited =
      "defect:audit,meta-audit,task:abandon,quota:check,quota:freeze,test:summary,mind:candidate,mind:escalate,mind:halt,msg:send,msg:listen,msg:list,msg:health,role:list,role:profile,role:cheat-sheet,hygiene:audit,hygiene:fix";
    const auditedNames = new Set(audited.split(","));
    const auditedMismatches = mismatches.filter((m) => auditedNames.has(m.commandName));
    const mismatchCommandCount = mismatches.length;
    const totalMismatchCount = mismatches.reduce(
      (sum, m) => sum + m.missingInRegistry.length + m.missingInHandler.length,
      0,
    );
    expect(mismatchCommandCount).toBeLessThanOrEqual(MAX_MISMATCH_COMMANDS_BASELINE);
    expect(totalMismatchCount).toBeLessThanOrEqual(MAX_TOTAL_MISMATCHES_BASELINE);
    expect(auditedMismatches).toEqual([]);
  });

  it("asserts exact match between assertFlags and registry declaration for defect:audit and meta-audit", () => {
    const strictCommands = [
      ["defect:audit", "defect-audit.ts"],
      ["meta-audit", "meta-audit.ts"],
    ] as const;

    for (const [name, file] of strictCommands) {
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
