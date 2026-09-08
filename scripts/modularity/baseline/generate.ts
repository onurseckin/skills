import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScanSource, Violation } from "../core/index.ts";
import { readHeadBlobs, readIndexedBlobs, readTreeBlobs } from "../inventory/index.ts";
import { checkModularity } from "../modularity-engine.ts";
import { assertNoPhantomPaths, type ModularityBaseline } from "../policy/index.ts";

export function compareViolations(a: Violation, b: Violation): number {
  if (a.rule !== b.rule) return a.rule.localeCompare(b.rule);
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  const obsA = String(a.observed);
  const obsB = String(b.observed);
  if (obsA !== obsB) return obsA.localeCompare(obsB);
  return a.detail.localeCompare(b.detail);
}

export function buildBaselineDocument(violations: readonly Violation[]): ModularityBaseline {
  const unique = new Map<string, Violation>();
  for (const v of violations) {
    unique.set(`${v.rule}:${v.path}:${v.observed}:${v.detail}`, v);
  }
  const sorted = [...unique.values()].sort(compareViolations);
  return {
    schema: "olt-modularity-baseline/v1",
    violations: sorted,
  };
}

export async function generateBaseline(
  repoRoot: string = resolve("."),
  source: ScanSource = "head",
): Promise<ModularityBaseline> {
  if (source === "tree") {
    const status = spawnSync("git", ["-C", repoRoot, "status", "--porcelain"], {
      encoding: "utf-8",
    });
    if (status.status !== 0) {
      const err = (status.stderr ?? "").trim();
      throw new Error(`Failed to check git status: ${err}`);
    }
    const dirty = (status.stdout ?? "").trim();
    if (dirty.length > 0) {
      throw new Error(
        `Cannot generate modularity baseline from dirty working tree with source="tree". Clean the working tree or use source="head". Dirty paths:\n${dirty}`,
      );
    }
  }
  const report = await checkModularity({
    mode: "strict",
    source,
    repoRoot,
  });
  const baseline = buildBaselineDocument(report.violations);
  const blobs =
    source === "head"
      ? await readHeadBlobs(repoRoot)
      : source === "index"
        ? await readIndexedBlobs(repoRoot)
        : await readTreeBlobs(repoRoot);
  assertNoPhantomPaths(baseline, blobs);
  return baseline;
}

export async function writeBaseline(
  repoRoot: string = resolve("."),
  source: ScanSource = "head",
  outputPath: string = "scripts/modularity/baseline/index.json",
): Promise<void> {
  const baseline = await generateBaseline(repoRoot, source);
  const json = `${JSON.stringify(baseline, null, 2)}\n`;
  const target = resolve(repoRoot, outputPath);
  writeFileSync(target, json, "utf-8");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const source: ScanSource = args.includes("--source=tree")
    ? "tree"
    : args.includes("--source=index")
      ? "index"
      : "head";
  await writeBaseline(resolve("."), source);
  process.stdout.write("Modularity baseline successfully generated.\n");
}
