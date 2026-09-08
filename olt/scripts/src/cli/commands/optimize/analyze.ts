import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import ts from "typescript";
import { HarnessError } from "../../../core/errors/index.ts";
import { assertFlags, boolFlag, textFlag, type CommandContext, type Flags } from "../../index.ts";

export interface PlannedSubmodule {
  readonly name: string;
  readonly estimatedSloc: number;
  readonly responsibility: string;
  readonly dependencies?: readonly string[];
}
export interface ExportedSymbol {
  readonly name: string;
  readonly type: string;
  readonly preMutationSignature: string;
  readonly postMutationSignature: string;
}
export interface InboundCaller {
  readonly file: string;
  readonly symbols: readonly string[];
}
export interface AnalysisResult {
  readonly targetPath: string;
  readonly slug: string;
  readonly markdown: string;
  readonly metrics: {
    readonly targetFile: string;
    readonly sloc: number;
    readonly cyclomaticComplexity: { readonly max: number; readonly avg: number };
    readonly anyCount: number;
    readonly compilerSuppressions: number;
    readonly testExecutionBaseline: string;
    readonly memoryFootprint: string;
  };
  readonly coupling: {
    readonly inboundConsumers: readonly InboundCaller[];
    readonly outboundDependencies: readonly string[];
    readonly circularDependencyCheck: string;
  };
  readonly decomposition: {
    readonly singleWorktreeIsolation: "CONFIRMED";
    readonly plannedSubmodules: readonly PlannedSubmodule[];
    readonly stubStrategy: string;
  };
  readonly publicApi: {
    readonly exportedSymbols: readonly ExportedSymbol[];
    readonly publicApiDelta: "EMPTY_SET";
  };
  readonly verification: {
    readonly existingTestLeases: string;
    readonly assertionDeletionGate: string;
    readonly additiveSpecTests: readonly string[];
    readonly staticCompilationGate: string;
  };
  readonly rollback: {
    readonly compilationFailureThreshold: string;
    readonly astMutationThreshold: string;
    readonly assertionDeletionThreshold: string;
    readonly atomicAbortAction: string;
  };
}
export type EmpiricalBaselineMetrics = AnalysisResult["metrics"];
export type CouplingMap = AnalysisResult["coupling"];
export type SubmoduleDecomposition = AnalysisResult["decomposition"];
export type PublicApiSurfaceLock = AnalysisResult["publicApi"];
export type VerificationSpec = AnalysisResult["verification"];
export type RollbackSpec = AnalysisResult["rollback"];

export interface AnalyzeOptions {
  readonly cwd?: string | undefined;
  readonly fileContent?: string | undefined;
  readonly files?: Readonly<Record<string, string>> | undefined;
  readonly plannedSubmodules?: readonly PlannedSubmodule[] | undefined;
  readonly inboundConsumers?: readonly InboundCaller[] | undefined;
  readonly outboundDependencies?: readonly string[] | undefined;
  readonly testFiles?: readonly string[] | undefined;
  readonly testDurationMs?: number | undefined;
  readonly memoryFootprint?: string | undefined;
}
export interface AnalyzeContext extends CommandContext {
  readonly files?: Readonly<Record<string, string>> | undefined;
  readonly writtenFiles?: Map<string, string> | undefined;
  readonly options?: AnalyzeOptions | undefined;
}

function clean(p: string): string {
  return p.replace(/\\/g, "/").replace(/^(\.\/)?(.*?)(?:\.[^.]+)?$/, "$2");
}

const getSlug = (p: string): string => basename(p, extname(p));
const esc = (v: string): string => v.replace(/\|/g, "\\|");

const DEF_ROLLBACK = {
  compilationFailureThreshold: "Compilation failure after 2 implementer repair cycles.",
  astMutationThreshold: "Any detected AST export table mutation (`optimize:check-ast` fails).",
  assertionDeletionThreshold: "Assertion deletion detected in existing test suite.",
};

const computeSloc = (c: string): number =>
  c.trim() ? c.split(/\r?\n/).filter((l) => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l)).length : 0;

function isBranch(n: ts.Node): boolean {
  const k = n.kind,
    op = (n as ts.BinaryExpression).operatorToken?.kind;
  return (
    (k >= ts.SyntaxKind.IfStatement && k <= ts.SyntaxKind.ForOfStatement) ||
    k === ts.SyntaxKind.CaseClause ||
    k === ts.SyntaxKind.CatchClause ||
    k === ts.SyntaxKind.ConditionalExpression ||
    (k === ts.SyntaxKind.BinaryExpression &&
      op !== undefined &&
      op >= ts.SyntaxKind.AmpersandAmpersandToken &&
      op <= ts.SyntaxKind.QuestionQuestionToken)
  );
}

function computeComplexity(src: ts.SourceFile): { max: number; avg: number } {
  const list: number[] = [];
  src.forEachChild(function visit(n) {
    if (ts.isFunctionLike(n as ts.Declaration)) {
      let c = 1;
      n.forEachChild(function walk(ch) {
        if (isBranch(ch)) c++;
        ch.forEachChild(walk);
      });
      list.push(c);
    }
    n.forEachChild(visit);
  });
  const avg = list.length
    ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10
    : 1;
  return { max: list.length ? Math.max(...list) : 1, avg };
}

function countAny(src: ts.SourceFile): number {
  let c = 0;
  function v(n: ts.Node) {
    if (n.kind === ts.SyntaxKind.AnyKeyword) c++;
    n.forEachChild(v);
  }
  v(src);
  return c;
}

function getDeclKind(s: ts.Statement): string | undefined {
  if (ts.isClassDeclaration(s)) return "class";
  if (ts.isInterfaceDeclaration(s)) return "interface";
  return ts.isEnumDeclaration(s) ? "enum" : undefined;
}

function extractSymbols(src: ts.SourceFile): readonly ExportedSymbol[] {
  const res: ExportedSymbol[] = [];
  const push = (name: string, type: string, sig: string) =>
    res.push({ name, type, preMutationSignature: sig, postMutationSignature: sig });
  for (const s of src.statements) {
    const exp =
      ts.canHaveModifiers(s) &&
      (ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
    if (exp) {
      const k = getDeclKind(s);
      if (ts.isFunctionDeclaration(s)) {
        const n = s.name?.text ?? "<anonymous>";
        push(
          n,
          "function",
          `${n}(${s.parameters.map((p) => p.getText(src)).join(", ")})${s.type ? `: ${s.type.getText(src)}` : ""}`,
        );
      } else if (k) {
        const n = (s as ts.NamedDeclaration).name?.getText(src) ?? "<anonymous>";
        push(n, k, `${k} ${n}`);
      } else if (ts.isTypeAliasDeclaration(s)) {
        push(
          s.name.text,
          "type",
          `type ${s.name.text} = ${s.type.getText(src).replace(/\s+/g, " ").slice(0, 50)}`,
        );
      } else if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          const n = d.name.getText(src);
          push(n, "const", `const ${n}: ${d.type?.getText(src) ?? "inferred"}`);
        }
      }
    } else if (ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause)) {
      for (const el of s.exportClause.elements)
        push(el.name.text, "export", `export ${el.name.text}`);
    }
  }
  return res;
}

function extractOutbound(src: ts.SourceFile): readonly string[] {
  return src.statements.flatMap((s) =>
    (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
    s.moduleSpecifier &&
    ts.isStringLiteral(s.moduleSpecifier)
      ? [s.moduleSpecifier.text]
      : [],
  );
}

export function detectCycle(
  nodes: readonly string[],
  getNeighbors: (n: string) => readonly string[],
): readonly string[] | null {
  const visited = new Set<string>(),
    stack = new Set<string>(),
    order: string[] = [];
  function dfs(curr: string): readonly string[] | null {
    visited.add(curr);
    stack.add(curr);
    order.push(curr);
    for (const n of getNeighbors(curr)) {
      if (!visited.has(n)) {
        const c = dfs(n);
        if (c) return c;
      } else if (stack.has(n)) return [...order.slice(order.indexOf(n)), n];
    }
    stack.delete(curr);
    order.pop();
    return null;
  }
  for (const n of nodes) {
    if (!visited.has(n)) {
      const c = dfs(n);
      if (c) return c;
    }
  }
  return null;
}

function defaultSubmodules(slug: string, sloc: number): readonly PlannedSubmodule[] {
  const mk = (n: string, s: number, r: string, d: string[] = []): PlannedSubmodule => ({
    name: `${slug}-${n}.ts`,
    estimatedSloc: s,
    responsibility: r,
    dependencies: d.map((x) => `${slug}-${x}.ts`),
  });
  const t =
    sloc <= 400
      ? Math.min(100, Math.max(10, Math.round(sloc * 0.25)))
      : Math.min(200, Math.max(10, Math.round(sloc * 0.2)));
  const tDesc = sloc <= 400 ? "Shared contracts and types" : "Type definitions and contracts";
  const tMod = mk("types", t, tDesc);
  if (sloc <= 400) {
    const c = Math.max(20, Math.min(350, Math.round(sloc * 0.75)));
    return [tMod, mk("core", c, "Core operational logic", ["types"])];
  }
  const e = Math.min(350, Math.max(20, Math.round(sloc * 0.45)));
  const h = Math.min(350, Math.max(20, sloc - t - e));
  return [
    tMod,
    mk("engine", e, "Core compute engine", ["types"]),
    mk("handlers", h, "Orchestration handlers", ["engine"]),
  ];
}

const fmtIn = (c: InboundCaller) => `  - \`${c.file}\`: imports \`[${c.symbols.join(", ")}]\``;
const fmtOut = (d: string) => `  - \`${d}\``;
const fmtSub = (s: PlannedSubmodule) =>
  `  - \`${s.name}\`: \`${s.estimatedSloc}\` SLOC — Responsibility: \`${s.responsibility}\``;
const fmtSym = (s: ExportedSymbol) =>
  `  | \`${esc(s.name)}\` | \`${esc(s.type)}\` | \`${esc(s.preMutationSignature)}\` | \`${esc(s.postMutationSignature)}\` |`;
const fmtSpec = (t: string) => `  - \`${t}\`: In-memory mock tests asserting I/O equivalence.`;

export function formatAnalysisMarkdown(r: Omit<AnalysisResult, "markdown">): string {
  const inStr = r.coupling.inboundConsumers.map(fmtIn).join("\n") || "  - (none detected)";
  const outStr = r.coupling.outboundDependencies.map(fmtOut).join("\n") || "  - (none)";
  const subStr = r.decomposition.plannedSubmodules.map(fmtSub).join("\n");
  const symStr =
    r.publicApi.exportedSymbols.map(fmtSym).join("\n") || "  | (none) | N/A | N/A | N/A |";
  const specStr = r.verification.additiveSpecTests.map(fmtSpec).join("\n");

  return `# Optimization Analysis: ${r.targetPath}\n\n## 1. Empirical Baseline Metrics\n- Target File: \`${r.metrics.targetFile}\`\n- Source Lines of Code (SLOC): \`${r.metrics.sloc}\`\n- Cyclomatic Complexity (Max / Avg): \`${r.metrics.cyclomaticComplexity.max} / ${r.metrics.cyclomaticComplexity.avg}\`\n- TypeScript \`any\` Count: \`${r.metrics.anyCount}\`\n- Compiler Suppressions (\`@ts-ignore\`, \`@ts-expect-error\`): \`${r.metrics.compilerSuppressions}\`\n- Unit Test Execution Baseline: \`${r.metrics.testExecutionBaseline}\`\n- Memory / Allocation Footprint: \`${r.metrics.memoryFootprint}\`\n\n## 2. Inbound & Outbound Coupling Map\n- Inbound Consumers (Callers):\n${inStr}\n- Outbound Dependencies:\n${outStr}\n- Circular Dependency Check: \`${r.coupling.circularDependencyCheck}\`\n\n## 3. Submodule Decomposition Topology\n- Single-Worktree Isolation: \`${r.decomposition.singleWorktreeIsolation}\`\n- Planned Submodules (All Projected <= 400 SLOC):\n${subStr}\n- Original Stub Strategy: \`${r.decomposition.stubStrategy}\`\n\n## 4. Public API Surface Lock\n- Invariant: Zero Public Interface Expansion & Zero Behavioral Delta\n- Exported Symbols Table:\n  | Symbol Name | Symbol Type | Pre-Mutation Type Signature | Post-Mutation Type Signature |\n  | :--- | :--- | :--- | :--- |\n${symStr}\n- Public API Delta: \`${r.publicApi.publicApiDelta}\`\n\n## 5. Verification & Test Gate Specification\n- Existing Test Leases: \`READ_ONLY\` (${r.verification.existingTestLeases})\n- Assertion Deletion Gate: \`${r.verification.assertionDeletionGate}\` (0 deletions allowed)\n- Additive Specification Tests:\n${specStr}\n- Static Compilation Gate: \`${r.verification.staticCompilationGate}\` (0 errors, 0 warnings).\n\n## 6. Rollback & Abort Thresholds\n- Compilation failure after 2 implementer repair cycles.\n- Any detected AST export table mutation (\`optimize:check-ast\` fails).\n- Assertion deletion detected in existing test suite.\n- Atomic Abort Action: \`${r.rollback.atomicAbortAction}\`\n`;
}

export function generateAnalysis(targetPath: string, options?: AnalyzeOptions): AnalysisResult {
  const content =
    options?.fileContent ??
    (options?.files ? options.files[targetPath] : undefined) ??
    (existsSync(resolve(targetPath)) ? readFileSync(resolve(targetPath), "utf-8") : undefined);
  if (content === undefined)
    throw new HarnessError("NOT_FOUND", `Target file not found: ${targetPath}`);

  const slug = getSlug(targetPath);
  const planned = options?.plannedSubmodules ?? defaultSubmodules(slug, computeSloc(content));
  const subMap = new Map(planned.map((s) => [clean(s.name), (s.dependencies ?? []).map(clean)]));
  const cycle = detectCycle(Array.from(subMap.keys()), (k) => subMap.get(k) ?? []);
  if (cycle !== null) {
    throw new HarnessError(
      "INVALID_STATE",
      `CIRCULAR_EXTRACTION_FAILURE: cyclic import detected in proposed submodules: ${cycle.join(" -> ")}`,
    );
  }

  const src = ts.createSourceFile(targetPath, content, ts.ScriptTarget.Latest, true);
  const outbound = options?.outboundDependencies ?? extractOutbound(src);

  if (options?.files !== undefined) {
    const dir = dirname(targetPath),
      norm = clean(targetPath);
    for (const dep of outbound) {
      const key = [join(dir, dep), `${join(dir, dep)}.ts`, dep, `${dep}.ts`]
        .map((p) => p.replace(/\\/g, "/"))
        .find((k) => options.files![k] !== undefined);
      if (key) {
        const back = extractOutbound(
          ts.createSourceFile(key, options.files[key]!, ts.ScriptTarget.Latest, true),
        );
        if (back.some((b) => clean(join(dirname(key), b)) === norm || clean(b) === norm)) {
          throw new HarnessError(
            "INVALID_STATE",
            `CIRCULAR_EXTRACTION_FAILURE: cyclic import detected between ${targetPath} and ${dep}`,
          );
        }
      }
    }
  }

  const res: Omit<AnalysisResult, "markdown"> = {
    targetPath,
    slug,
    metrics: {
      targetFile: targetPath,
      sloc: computeSloc(content),
      cyclomaticComplexity: computeComplexity(src),
      anyCount: countAny(src),
      compilerSuppressions: (content.match(/@ts-ignore|@ts-expect-error/g) ?? []).length,
      testExecutionBaseline:
        options?.testDurationMs !== undefined ? `${options.testDurationMs}ms` : "N/A",
      memoryFootprint: options?.memoryFootprint ?? "N/A",
    },
    coupling: {
      inboundConsumers: options?.inboundConsumers ?? [],
      outboundDependencies: outbound,
      circularDependencyCheck: "CLEAN (0 cycles detected)",
    },
    decomposition: {
      singleWorktreeIsolation: "CONFIRMED",
      plannedSubmodules: planned,
      stubStrategy: `${targetPath} retained as barrel re-exporting all symbols.`,
    },
    publicApi: { exportedSymbols: extractSymbols(src), publicApiDelta: "EMPTY_SET" },
    verification: {
      existingTestLeases: options?.testFiles?.length
        ? options.testFiles.map((f) => `\`${f}\``).join(", ")
        : `\`tests/${slug}.test.ts\``,
      assertionDeletionGate: `bun harness.ts optimize:check-tests --target ${dirname(targetPath)}`,
      additiveSpecTests: planned.map((s) => `${s.name.replace(/\.ts$/, "")}.spec.ts`),
      staticCompilationGate: "tsc --noEmit",
    },
    rollback: {
      ...DEF_ROLLBACK,
      atomicAbortAction: `bun harness.ts optimize:quarantine --plan ${slug}`,
    },
  };
  return { ...res, markdown: formatAnalysisMarkdown(res) };
}

export async function optimizeAnalyzeCommand(
  flags: Flags,
  context?: CommandContext,
): Promise<Record<string, unknown>> {
  assertFlags(flags, ["target", "out", "dry-run", "json"]);
  const targetPath = textFlag(flags, "target", true)!,
    slug = getSlug(targetPath);
  const outPath = textFlag(flags, "out", false) ?? `docs/optimization/${slug}/ANALYSIS.md`,
    dryRun = boolFlag(flags, "dry-run");

  const aCtx = context as AnalyzeContext | undefined;
  const files = aCtx?.files;
  const result = generateAnalysis(targetPath, {
    ...aCtx?.options,
    ...(files ? { files } : {}),
  });

  if (!dryRun) {
    if (aCtx?.writtenFiles) aCtx.writtenFiles.set(outPath, result.markdown);
    else {
      mkdirSync(dirname(resolve(outPath)), { recursive: true });
      writeFileSync(resolve(outPath), result.markdown, "utf-8");
    }
  }

  return {
    target: targetPath,
    targetPath,
    slug,
    out: outPath,
    dry_run: dryRun,
    written: !dryRun,
    markdown: result.markdown,
    analysis: result,
  };
}
