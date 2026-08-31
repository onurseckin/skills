import type { Violation } from "../core/index.ts";
import type { IndexedBlob } from "../inventory/index.ts";

const GENERATED_ROOT = "olt/references/cli-capabilities/";

function compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function finding(path: string, observed: string): Violation {
  return {
    rule: "generated_catalog",
    path,
    observed,
    detail: "Generated CLI catalog must reference every command exactly once.",
  };
}

function text(blob: IndexedBlob): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(blob.bytes);
}

function catalogFindings(byPath: ReadonlyMap<string, IndexedBlob>): readonly Violation[] {
  const manifest = byPath.get(`${GENERATED_ROOT}manifest.json`);
  const index = byPath.get(`${GENERATED_ROOT}index.jsonl`);
  if (manifest === undefined) return [];
  if (index === undefined) return [];
  let records: readonly unknown[];
  try {
    JSON.parse(text(manifest));
    records = text(index)
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [finding(GENERATED_ROOT, "malformed generated catalog")];
  }
  const targets = new Set<string>();
  const findings: Violation[] = [];
  for (const record of records) {
    const file =
      typeof record === "object" && record !== null
        ? (record as { file?: unknown }).file
        : undefined;
    if (typeof file !== "string") {
      findings.push(finding(GENERATED_ROOT, "invalid catalog reference"));
      continue;
    }
    if (file.length === 0) {
      findings.push(finding(GENERATED_ROOT, "invalid catalog reference"));
      continue;
    }
    if (file.startsWith("/")) {
      findings.push(finding(GENERATED_ROOT, "invalid catalog reference"));
      continue;
    }
    if (file.includes("..")) {
      findings.push(finding(GENERATED_ROOT, "invalid catalog reference"));
      continue;
    }
    if (targets.has(file)) {
      findings.push(finding(GENERATED_ROOT, `duplicate catalog reference: ${file}`));
    }
    targets.add(file);
    if (!byPath.has(`${GENERATED_ROOT}${file}`)) {
      findings.push(finding(GENERATED_ROOT, `stale catalog reference: ${file}`));
    }
  }
  for (const path of byPath.keys()) {
    if (
      path.startsWith(`${GENERATED_ROOT}commands/`) &&
      path.endsWith(".json") &&
      !path.endsWith("/index.json")
    ) {
      const relative = path.slice(GENERATED_ROOT.length);
      if (!targets.has(relative)) {
        findings.push(finding(GENERATED_ROOT, `orphan command file: ${relative}`));
      }
    }
  }
  return findings;
}

export function findGeneratedCatalogViolations(
  blobs: readonly IndexedBlob[],
): readonly Violation[] {
  const paths = new Set(blobs.map((blob) => blob.path));
  const byPath = new Map(blobs.map((blob) => [blob.path, blob]));
  const directories = new Set(
    blobs
      .map((blob) => blob.path)
      .filter((path) => path.startsWith(GENERATED_ROOT))
      .map((path) => path.slice(0, path.lastIndexOf("/"))),
  );
  const missing = [...directories]
    .filter((directory) => !paths.has(`${directory}/index.json`))
    .sort()
    .map((path) => ({
      rule: "generated_catalog" as const,
      path,
      observed: "missing index.json",
      detail: "Generated CLI directory requires a catalog index.",
    }));
  return [...missing, ...catalogFindings(byPath)].sort((left, right) => {
    const pathDiff = compare(left.path, right.path);
    if (pathDiff !== 0) return pathDiff;
    return compare(String(left.observed), String(right.observed));
  });
}
