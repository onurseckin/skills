import { describe, expect, it } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  generateAnalysis,
  optimizeAnalyzeCommand,
  type AnalyzeContext,
  type PlannedSubmodule,
} from "../../../../olt/scripts/src/cli/commands/optimize/analyze.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/index.ts";

const SAMPLE_MODULE = `
import { helper } from "./helper.ts";

export interface Config {
  readonly id: string;
  readonly retries: number;
}

export type Status = "idle" | "running" | "done";

export class Engine {
  public start(): void {}
}

export function compute(x: number, y: number): number {
  if (x > 0 && y > 0) {
    return x + y;
  }
  return 0;
}

export const VERSION: string = "1.0.0";
const internalConst = 42;
export { internalConst };
`;

const COMPLEX_MODULE = `
// @ts-ignore
const bad: any = 123;
// @ts-expect-error
const other: any = "foo";

export function evaluate(val: number): string {
  if (val > 10) {
    for (let i = 0; i < val; i++) {
      if (i % 2 === 0) return "even";
    }
  } else if (val < 0) {
    return val === -1 ? "negative-one" : "negative";
  }
  return "default";
}
`;

describe("optimize:analyze generator", () => {
  it("generates all 6 sections correctly adhering to mandatory schema", () => {
    const result = generateAnalysis("src/engine/runner.ts", {
      fileContent: SAMPLE_MODULE,
      testDurationMs: 42,
      memoryFootprint: "12MB",
      inboundConsumers: [{ file: "src/index.ts", symbols: ["Engine", "compute"] }],
      outboundDependencies: ["./helper.ts"],
      testFiles: ["tests/engine/runner.test.ts"],
    });

    expect(result.slug).toBe("runner");
    expect(result.targetPath).toBe("src/engine/runner.ts");

    // Section 1: Empirical Baseline Metrics
    expect(result.markdown).toContain("## 1. Empirical Baseline Metrics");
    expect(result.markdown).toContain("- Target File: `src/engine/runner.ts`");
    expect(result.markdown).toContain("- Source Lines of Code (SLOC): `");
    expect(result.markdown).toContain("- Cyclomatic Complexity (Max / Avg): `3 / 2`");
    expect(result.markdown).toContain("- TypeScript `any` Count: `0`");
    expect(result.markdown).toContain(
      "- Compiler Suppressions (`@ts-ignore`, `@ts-expect-error`): `0`",
    );
    expect(result.markdown).toContain("- Unit Test Execution Baseline: `42ms`");
    expect(result.markdown).toContain("- Memory / Allocation Footprint: `12MB`");

    // Section 2: Inbound & Outbound Coupling Map
    expect(result.markdown).toContain("## 2. Inbound & Outbound Coupling Map");
    expect(result.markdown).toContain("- Inbound Consumers (Callers):");
    expect(result.markdown).toContain("  - `src/index.ts`: imports `[Engine, compute]`");
    expect(result.markdown).toContain("- Outbound Dependencies:");
    expect(result.markdown).toContain("  - `./helper.ts`");
    expect(result.markdown).toContain("- Circular Dependency Check: `CLEAN (0 cycles detected)`");

    // Section 3: Submodule Decomposition Topology
    expect(result.markdown).toContain("## 3. Submodule Decomposition Topology");
    expect(result.markdown).toContain("- Single-Worktree Isolation: `CONFIRMED`");
    expect(result.markdown).toContain("- Planned Submodules (All Projected <= 400 SLOC):");
    expect(result.markdown).toContain(
      "- Original Stub Strategy: `src/engine/runner.ts retained as barrel re-exporting all symbols.`",
    );
    for (const sub of result.decomposition.plannedSubmodules) {
      expect(sub.estimatedSloc).toBeLessThanOrEqual(400);
      expect(result.markdown).toContain(
        `- \`${sub.name}\`: \`${sub.estimatedSloc}\` SLOC — Responsibility: \`${sub.responsibility}\``,
      );
    }

    // Section 4: Public API Surface Lock
    expect(result.markdown).toContain("## 4. Public API Surface Lock");
    expect(result.markdown).toContain(
      "- Invariant: Zero Public Interface Expansion & Zero Behavioral Delta",
    );
    expect(result.markdown).toContain(
      "| Symbol Name | Symbol Type | Pre-Mutation Type Signature | Post-Mutation Type Signature |",
    );
    expect(result.markdown).toContain("- Public API Delta: `EMPTY_SET`");

    const symbolNames = result.publicApi.exportedSymbols.map((s) => s.name);
    expect(symbolNames).toContain("Config");
    expect(symbolNames).toContain("Status");
    expect(symbolNames).toContain("Engine");
    expect(symbolNames).toContain("compute");
    expect(symbolNames).toContain("VERSION");
    expect(symbolNames).toContain("internalConst");

    for (const sym of result.publicApi.exportedSymbols) {
      expect(sym.preMutationSignature).toBe(sym.postMutationSignature);
    }

    // Section 5: Verification & Test Gate Specification
    expect(result.markdown).toContain("## 5. Verification & Test Gate Specification");
    expect(result.markdown).toContain(
      "- Existing Test Leases: `READ_ONLY` (`tests/engine/runner.test.ts`)",
    );
    expect(result.markdown).toContain(
      "- Assertion Deletion Gate: `bun harness.ts optimize:check-tests --target src/engine` (0 deletions allowed)",
    );
    expect(result.markdown).toContain("- Additive Specification Tests:");
    expect(result.markdown).toContain(
      "- Static Compilation Gate: `tsc --noEmit` (0 errors, 0 warnings).",
    );

    // Section 6: Rollback & Abort Thresholds
    expect(result.markdown).toContain("## 6. Rollback & Abort Thresholds");
    expect(result.markdown).toContain("- Compilation failure after 2 implementer repair cycles.");
    expect(result.markdown).toContain(
      "- Any detected AST export table mutation (`optimize:check-ast` fails).",
    );
    expect(result.markdown).toContain("- Assertion deletion detected in existing test suite.");
    expect(result.markdown).toContain(
      "- Atomic Abort Action: `bun harness.ts optimize:quarantine --plan runner`",
    );
  });

  it("accurately computes SLOC, complexity, any-count, and suppressions", () => {
    const result = generateAnalysis("src/complex.ts", {
      fileContent: COMPLEX_MODULE,
    });

    expect(result.metrics.anyCount).toBe(2);
    expect(result.metrics.compilerSuppressions).toBe(2);
    expect(result.metrics.cyclomaticComplexity.max).toBeGreaterThanOrEqual(4);
    expect(result.metrics.testExecutionBaseline).toBe("N/A");
    expect(result.metrics.memoryFootprint).toBe("N/A");
  });

  it("decomposes files exceeding 400 SLOC into planned submodules all <= 400 SLOC", () => {
    const longContent = Array.from({ length: 500 }, (_, i) => `export const val_${i} = ${i};`).join(
      "\n",
    );
    const result = generateAnalysis("src/big-file.ts", { fileContent: longContent });

    expect(result.decomposition.plannedSubmodules.length).toBe(3);
    for (const sub of result.decomposition.plannedSubmodules) {
      expect(sub.estimatedSloc).toBeLessThanOrEqual(400);
      expect(sub.estimatedSloc).toBeGreaterThan(0);
    }
  });

  it("aborts with CIRCULAR_EXTRACTION_FAILURE when proposed submodules have cyclic import", () => {
    const cyclicSubmodules: readonly PlannedSubmodule[] = [
      { name: "sub_a.ts", estimatedSloc: 50, responsibility: "Part A", dependencies: ["sub_b.ts"] },
      { name: "sub_b.ts", estimatedSloc: 60, responsibility: "Part B", dependencies: ["sub_a.ts"] },
    ];

    expect(() => {
      generateAnalysis("src/module.ts", {
        fileContent: "export const a = 1;",
        plannedSubmodules: cyclicSubmodules,
      });
    }).toThrow(HarnessError);

    try {
      generateAnalysis("src/module.ts", {
        fileContent: "export const a = 1;",
        plannedSubmodules: cyclicSubmodules,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(HarnessError);
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_STATE");
      expect(hErr.message).toContain("CIRCULAR_EXTRACTION_FAILURE");
      expect(hErr.message).toContain("sub_a -> sub_b -> sub_a");
    }
  });

  it("aborts with CIRCULAR_EXTRACTION_FAILURE on multi-node cycle", () => {
    const multiCycle: readonly PlannedSubmodule[] = [
      { name: "mod1.ts", estimatedSloc: 50, responsibility: "M1", dependencies: ["mod2.ts"] },
      { name: "mod2.ts", estimatedSloc: 50, responsibility: "M2", dependencies: ["mod3.ts"] },
      { name: "mod3.ts", estimatedSloc: 50, responsibility: "M3", dependencies: ["mod1.ts"] },
    ];

    expect(() => {
      generateAnalysis("src/module.ts", {
        fileContent: "export const a = 1;",
        plannedSubmodules: multiCycle,
      });
    }).toThrow(/CIRCULAR_EXTRACTION_FAILURE/);
  });

  it("aborts with CIRCULAR_EXTRACTION_FAILURE on cyclic in-memory file dependencies", () => {
    const inMemFiles: Record<string, string> = {
      "src/service.ts": 'import { helper } from "./helper.ts";\nexport const s = 1;',
      "src/helper.ts": 'import { service } from "./service.ts";\nexport const h = 2;',
    };

    expect(() => {
      generateAnalysis("src/service.ts", {
        files: inMemFiles,
      });
    }).toThrow(HarnessError);

    try {
      generateAnalysis("src/service.ts", { files: inMemFiles });
    } catch (err) {
      const hErr = err as HarnessError;
      expect(hErr.code).toBe("INVALID_STATE");
      expect(hErr.message).toContain("CIRCULAR_EXTRACTION_FAILURE");
    }
  });

  it("handles empty files gracefully", () => {
    const result = generateAnalysis("src/empty.ts", { fileContent: "" });
    expect(result.metrics.sloc).toBe(0);
    expect(result.metrics.anyCount).toBe(0);
    expect(result.publicApi.exportedSymbols.length).toBe(0);
    expect(result.markdown).toContain("| (none) | N/A | N/A | N/A |");
  });

  it("throws NOT_FOUND when target file does not exist", () => {
    expect(() => generateAnalysis("src/non-existent-probe.ts")).toThrow(HarnessError);
    try {
      generateAnalysis("src/non-existent-probe.ts");
    } catch (err) {
      expect((err as HarnessError).code).toBe("NOT_FOUND");
    }
  });

  it("reads target file from disk when not in memory files", () => {
    const res = generateAnalysis("package.json");
    expect(res.slug).toBe("package");
    expect(res.metrics.sloc).toBeGreaterThan(0);
  });

  it("detects cyclic dependency without .ts extension in imports", () => {
    const files: Record<string, string> = {
      "src/alpha.ts": 'import { beta } from "./beta";\nexport const a = 1;',
      "src/beta.ts": 'import { alpha } from "./alpha";\nexport const b = 2;',
    };
    expect(() => generateAnalysis("src/alpha.ts", { files })).toThrow(
      /CIRCULAR_EXTRACTION_FAILURE/,
    );
  });

  it("passes circular dependency check when local imports have no cycles", () => {
    const files: Record<string, string> = {
      "src/service.ts": 'import { helper } from "./helper.ts";\nexport const s = 1;',
      "src/helper.ts": "export const helper = 2;",
    };
    const res = generateAnalysis("src/service.ts", { files });
    expect(res.coupling.circularDependencyCheck).toBe("CLEAN (0 cycles detected)");
  });
});

describe("optimizeAnalyzeCommand CLI", () => {
  it("executes dry-run without writing to disk/store", async () => {
    const writtenFiles = new Map<string, string>();
    const flags: Flags = { target: "src/sample.ts", "dry-run": true };
    const context: AnalyzeContext = {
      files: { "src/sample.ts": "export const hello = 'world';" },
      writtenFiles,
    };

    const output = await optimizeAnalyzeCommand(flags, context);

    expect(output.dry_run).toBe(true);
    expect(output.written).toBe(false);
    expect(output.slug).toBe("sample");
    expect(output.out).toBe("docs/optimization/sample/ANALYSIS.md");
    expect(typeof output.markdown).toBe("string");
    expect(writtenFiles.size).toBe(0);
  });

  it("writes analysis markdown when not in dry-run mode", async () => {
    const writtenFiles = new Map<string, string>();
    const flags: Flags = { target: "src/core.ts" };
    const context: AnalyzeContext = {
      files: { "src/core.ts": "export class Engine {}" },
      writtenFiles,
    };

    const output = await optimizeAnalyzeCommand(flags, context);

    expect(output.dry_run).toBe(false);
    expect(output.written).toBe(true);
    expect(writtenFiles.size).toBe(1);
    expect(writtenFiles.has("docs/optimization/core/ANALYSIS.md")).toBe(true);
    expect(writtenFiles.get("docs/optimization/core/ANALYSIS.md")).toContain(
      "# Optimization Analysis: src/core.ts",
    );
  });

  it("supports custom --out path", async () => {
    const writtenFiles = new Map<string, string>();
    const flags: Flags = { target: "src/foo.ts", out: "custom/docs/REPORT.md" };
    const context: AnalyzeContext = {
      files: { "src/foo.ts": "export function foo(): void {}" },
      writtenFiles,
    };

    const output = await optimizeAnalyzeCommand(flags, context);

    expect(output.out).toBe("custom/docs/REPORT.md");
    expect(writtenFiles.has("custom/docs/REPORT.md")).toBe(true);
  });

  it("aborts and writes 0 files when cyclic extraction occurs in CLI command", async () => {
    const writtenFiles = new Map<string, string>();
    const cyclicSubmodules: readonly PlannedSubmodule[] = [
      { name: "sub_a.ts", estimatedSloc: 50, responsibility: "Part A", dependencies: ["sub_b.ts"] },
      { name: "sub_b.ts", estimatedSloc: 60, responsibility: "Part B", dependencies: ["sub_a.ts"] },
    ];
    const flags: Flags = { target: "src/cyclic.ts" };
    const context: AnalyzeContext = {
      files: { "src/cyclic.ts": "export const x = 1;" },
      writtenFiles,
      options: { plannedSubmodules: cyclicSubmodules },
    };

    let thrownError: HarnessError | undefined;
    try {
      await optimizeAnalyzeCommand(flags, context);
    } catch (err) {
      thrownError = err as HarnessError;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError?.code).toBe("INVALID_STATE");
    expect(thrownError?.message).toContain("CIRCULAR_EXTRACTION_FAILURE");
    expect(writtenFiles.size).toBe(0);
  });

  it("throws INVALID_ARGUMENT when --target flag is missing", async () => {
    const flags: Flags = {};
    let thrownError: HarnessError | undefined;
    try {
      await optimizeAnalyzeCommand(flags);
    } catch (err) {
      thrownError = err as HarnessError;
    }
    expect(thrownError).toBeDefined();
    expect(thrownError?.code).toBe("INVALID_ARGUMENT");
  });

  it("writes to filesystem when writtenFiles map is not provided in context", async () => {
    const vfs = new VirtualMemoryFS();
    const session = createVirtualFSSession(vfs);
    const tmpOut = "/virtual/analysis-out.md";
    try {
      const flags: Flags = { target: "src/disk.ts", out: tmpOut };
      const context: AnalyzeContext = {
        files: { "src/disk.ts": "export const a = 1;" },
      };
      const output = await optimizeAnalyzeCommand(flags, context);
      expect(output.written).toBe(true);
      expect(vfs.existsSync(tmpOut)).toBe(true);
    } finally {
      session.cleanup();
    }
  });
});
