import { describe, expect, test } from "bun:test";
import {
  buildBaselineDocument,
  compareViolations,
  generateBaseline,
} from "../../../scripts/modularity/baseline/generate.ts";
import type { Violation } from "../../../scripts/modularity/core/index.ts";
import { readHeadBlobs } from "../../../scripts/modularity/inventory/index.ts";
import {
  assertNoPhantomPaths,
  loadBaseline,
  type ModularityBaseline,
} from "../../../scripts/modularity/policy/index.ts";

describe("modularity baseline generator", () => {
  test("compareViolations orders violations deterministically", () => {
    const v1: Violation = {
      rule: "dependency_cycle",
      path: "a.ts",
      observed: "a.ts,b.ts",
      detail: "cycle",
    };
    const v2: Violation = {
      rule: "directory_fanout",
      path: "a",
      observed: 12,
      limit: 10,
      detail: "fanout",
    };
    const v3: Violation = {
      rule: "dependency_cycle",
      path: "b.ts",
      observed: "b.ts,c.ts",
      detail: "cycle",
    };

    expect(compareViolations(v1, v2)).toBeLessThan(0);
    expect(compareViolations(v2, v1)).toBeGreaterThan(0);
    expect(compareViolations(v1, v3)).toBeLessThan(0);
    expect(compareViolations(v1, v1)).toBe(0);
  });

  test("buildBaselineDocument deduplicates and attaches schema", () => {
    const v1: Violation = {
      rule: "line_limit",
      path: "foo.ts",
      observed: 500,
      limit: 400,
      detail: "too long",
    };
    const v2: Violation = { ...v1 };

    const doc = buildBaselineDocument([v1, v2]);
    expect(doc.schema).toBe("olt-modularity-baseline/v1");
    expect(doc.violations).toHaveLength(1);
    expect(doc.violations[0]).toEqual(v1);
  });

  test("readHeadBlobs reads blobs faithfully from git HEAD", async () => {
    const blobs = await readHeadBlobs(".");
    expect(blobs.length).toBeGreaterThan(1000);
    const packageJsonBlob = blobs.find((b) => b.path === "package.json");
    expect(packageJsonBlob).toBeDefined();
    expect(packageJsonBlob?.oid).toMatch(/^[0-9a-f]{40}$/);
    const content = new TextDecoder().decode(packageJsonBlob?.bytes);
    expect(content).toContain('"name": "@onurseckin/skills"');
  });

  test("generateBaseline with source=tree rejects dirty working tree", async () => {
    await expect(generateBaseline(".", "tree")).rejects.toThrow(
      /Cannot generate modularity baseline from dirty working tree with source="tree"/,
    );
  });

  test("assertNoPhantomPaths validates file and directory existence", () => {
    const mockBlobs = [
      { path: "src/core/a.ts" },
      { path: "src/core/b.ts" },
      { path: "src/index.ts" },
    ];

    const validBaseline: ModularityBaseline = {
      schema: "olt-modularity-baseline/v1",
      violations: [
        { rule: "line_limit", path: "src/core/a.ts", observed: 450, limit: 400, detail: "long" },
        { rule: "directory_fanout", path: "src/core", observed: 15, limit: 10, detail: "fanout" },
        {
          rule: "dependency_cycle",
          path: "src/core/a.ts",
          observed: "src/core/a.ts,src/core/b.ts",
          detail: "cycle",
        },
      ],
    };
    expect(() => assertNoPhantomPaths(validBaseline, mockBlobs)).not.toThrow();

    const phantomFileBaseline: ModularityBaseline = {
      schema: "olt-modularity-baseline/v1",
      violations: [
        { rule: "line_limit", path: "src/core/ghost.ts", observed: 500, detail: "long" },
      ],
    };
    expect(() => assertNoPhantomPaths(phantomFileBaseline, mockBlobs)).toThrow(
      /phantom path\(s\) not found in audited blob set: "src\/core\/ghost\.ts"/,
    );

    const phantomDirBaseline: ModularityBaseline = {
      schema: "olt-modularity-baseline/v1",
      violations: [
        { rule: "directory_fanout", path: "src/phantom-dir", observed: 20, detail: "fanout" },
      ],
    };
    expect(() => assertNoPhantomPaths(phantomDirBaseline, mockBlobs)).toThrow(
      /phantom path\(s\) not found in audited blob set: "src\/phantom-dir"/,
    );

    const phantomCycleBaseline: ModularityBaseline = {
      schema: "olt-modularity-baseline/v1",
      violations: [
        {
          rule: "dependency_cycle",
          path: "src/core/a.ts",
          observed: "src/core/a.ts,src/core/nonexistent.ts",
          detail: "cycle",
        },
      ],
    };
    expect(() => assertNoPhantomPaths(phantomCycleBaseline, mockBlobs)).toThrow(
      /phantom path\(s\) not found in audited blob set: cycle node "src\/core\/nonexistent\.ts"/,
    );
  });

  test("VACUITY PROOF: assertNoPhantomPaths rejects old baseline with 6 phantom task.ts entries", async () => {
    const headBlobs = await readHeadBlobs(".");

    const oldPhantomTaskViolations: readonly Violation[] = [
      {
        rule: "facade_bypass",
        path: "olt/scripts/src/cli/registry/task.ts",
        observed: "olt/scripts/src/cli/registry/types.ts",
        detail: "Cross-directory import must target the destination index.ts facade.",
      },
      {
        rule: "facade_bypass",
        path: "olt/scripts/src/cli/registry/task.ts",
        observed: "olt/scripts/src/cli/commands/task-check.ts",
        detail: "Cross-directory import must target the destination index.ts facade.",
      },
      {
        rule: "facade_bypass",
        path: "olt/scripts/src/cli/registry/task.ts",
        observed: "olt/scripts/src/cli/commands/task-ops.ts",
        detail: "Cross-directory import must target the destination index.ts facade.",
      },
      {
        rule: "facade_bypass",
        path: "olt/scripts/src/cli/registry/task.ts",
        observed: "olt/scripts/src/cli/registry/types.ts",
        detail: "Cross-directory import must target the destination index.ts facade.",
      },
      {
        rule: "facade_bypass",
        path: "olt/scripts/src/cli/registry/task.ts",
        observed: "olt/scripts/src/cli/registry/types.ts",
        detail: "Cross-directory import must target the destination index.ts facade.",
      },
      {
        rule: "line_limit",
        path: "olt/scripts/src/cli/registry/task.ts",
        observed: 423,
        limit: 400,
        detail: "File exceeds the 400 physical-line limit.",
      },
    ];

    const corruptedBaseline: ModularityBaseline = {
      schema: "olt-modularity-baseline/v1",
      violations: oldPhantomTaskViolations,
    };

    expect(() => assertNoPhantomPaths(corruptedBaseline, headBlobs)).toThrow(
      /phantom path\(s\) not found in audited blob set: "olt\/scripts\/src\/cli\/registry\/task\.ts"/,
    );
  });

  test("CLEAN BASELINE PROVENANCE: actual repo baseline has zero phantom paths against HEAD", async () => {
    const headBlobs = await readHeadBlobs(".");
    const baseline = await loadBaseline(".", "scripts/modularity/baseline/index.json");
    expect(() => assertNoPhantomPaths(baseline, headBlobs)).not.toThrow();
  });
});
